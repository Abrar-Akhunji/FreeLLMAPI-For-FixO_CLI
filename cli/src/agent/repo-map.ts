/**
 * Generates an efficient thin map of the workspace.
 * Instead of sending the full codebase content to the LLM (~8000 tokens),
 * this produces a compact directory tree + export signatures (~500 tokens).
 * The model can then selectively read specific files via the read_file tool.
 */
import fs from 'fs';
import path from 'path';

/* ──────────────────────── Config ──────────────────────── */

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', 'coverage', '.turbo',
  '.vercel', '.output', '.cache', '.parcel-cache', 'vendor',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock',
  'pnpm-lock.yaml', 'bun.lockb', '.env', '.env.local',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs',
  '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cpp',
  '.h', '.cs', '.vue', '.svelte',
]);

const MAX_DEPTH = 4;
const MAX_FILES = 200;

/* ──────────────────────── Types ──────────────────────── */

interface TreeEntry {
  name: string;
  isDir: boolean;
  children?: TreeEntry[];
  sizeBytes?: number;
  exports?: string[];
}

/* ──────────────────────── Main ──────────────────────── */

/**
 * Build a compact repo map string suitable for LLM context injection.
 * Returns ~200-500 tokens of structured information about the workspace.
 */
export function buildRepoMap(cwd: string, additionalExcludes?: string[]): string {
  const excludes = new Set([...IGNORE_DIRS, ...(additionalExcludes ?? [])]);
  const tree = scanDirectory(cwd, excludes, 0);

  if (!tree) return '(empty workspace)';

  const lines: string[] = ['## Workspace Structure'];
  renderTree(tree, '', lines, true);

  // Count stats
  let fileCount = 0;
  let dirCount = 0;
  countEntries(tree, { files: 0, dirs: 0 }, (stats) => {
    fileCount = stats.files;
    dirCount = stats.dirs;
  });

  lines.push('');
  lines.push(`_${fileCount} files, ${dirCount} directories_`);

  return lines.join('\n');
}

/* ──────────────────────── Tree Scanner ──────────────────────── */

function scanDirectory(
  dirPath: string,
  excludes: Set<string>,
  depth: number,
): TreeEntry | null {
  if (depth > MAX_DEPTH) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const children: TreeEntry[] = [];
  let filesSeen = 0;

  // Sort: directories first, then files, alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    // Hardcoded global structural blacklist to prevent token explosion
    const blacklist = ['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'package-lock.json', 'yarn.lock'];
    if (blacklist.includes(entry.name)) continue;

    if (excludes.has(entry.name)) continue;
    if (IGNORE_FILES.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.isFile()) continue;

    if (entry.isDirectory()) {
      const subtree = scanDirectory(
        path.join(dirPath, entry.name),
        excludes,
        depth + 1,
      );
      if (subtree) {
        children.push(subtree);
      }
    } else if (entry.isFile()) {
      if (filesSeen >= MAX_FILES) continue;
      filesSeen++;

      const ext = path.extname(entry.name);
      const filePath = path.join(dirPath, entry.name);
      let sizeBytes: number | undefined;

      try {
        const stat = fs.statSync(filePath);
        sizeBytes = stat.size;
      } catch {
        // Ignore stat errors
      }

      const treeEntry: TreeEntry = {
        name: entry.name,
        isDir: false,
        sizeBytes,
      };

      // Extract export signatures from code files (fast, regex-based)
      if (CODE_EXTENSIONS.has(ext) && sizeBytes && sizeBytes < 100_000) {
        const exports = extractExports(filePath, ext);
        if (exports.length > 0) {
          treeEntry.exports = exports;
        }
      }

      children.push(treeEntry);
    }
  }

  if (children.length === 0) return null;

  return {
    name: path.basename(dirPath),
    isDir: true,
    children,
  };
}

/* ──────────────────────── Export Extraction ──────────────────────── */

function extractExports(filePath: string, ext: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const exports: string[] = [];

    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      // Match: export function name, export class name, export const name, export interface name, export type name
      const patterns = [
        /export\s+(?:async\s+)?function\s+(\w+)/g,
        /export\s+class\s+(\w+)/g,
        /export\s+(?:const|let|var)\s+(\w+)/g,
        /export\s+interface\s+(\w+)/g,
        /export\s+type\s+(\w+)/g,
        /export\s+enum\s+(\w+)/g,
        /export\s+default\s+(?:class|function)\s+(\w+)/g,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          exports.push(match[1]);
        }
      }
    } else if (ext === '.py') {
      // Match: def name, class name (top-level only)
      const patterns = [
        /^def\s+(\w+)/gm,
        /^class\s+(\w+)/gm,
      ];
      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          exports.push(match[1]);
        }
      }
    } else if (ext === '.go') {
      // Match: func Name (capitalized = exported)
      const pattern = /^func\s+([A-Z]\w*)/gm;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        exports.push(match[1]);
      }
    }

    // Deduplicate
    return [...new Set(exports)].slice(0, 15); // Max 15 per file
  } catch {
    return [];
  }
}

/* ──────────────────────── Tree Rendering ──────────────────────── */

function renderTree(entry: TreeEntry, prefix: string, lines: string[], isRoot: boolean): void {
  if (isRoot) {
    lines.push(`📁 ${entry.name}/`);
  }

  if (!entry.children) return;

  for (let i = 0; i < entry.children.length; i++) {
    const child = entry.children[i];
    const isLast = i === entry.children.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    if (child.isDir) {
      lines.push(`${prefix}${connector}📁 ${child.name}/`);
      renderTree(child, nextPrefix, lines, false);
    } else {
      let line = `${prefix}${connector}${child.name}`;

      // Append compact export list
      if (child.exports && child.exports.length > 0) {
        const exportStr = child.exports.slice(0, 8).join(', ');
        const suffix = child.exports.length > 8 ? ', …' : '';
        line += `  → {${exportStr}${suffix}}`;
      }

      lines.push(line);
    }
  }
}

/* ──────────────────────── Helpers ──────────────────────── */

function countEntries(
  entry: TreeEntry,
  stats: { files: number; dirs: number },
  callback: (stats: { files: number; dirs: number }) => void,
): void {
  if (entry.isDir) {
    stats.dirs++;
    if (entry.children) {
      for (const child of entry.children) {
        countEntries(child, stats, () => {});
      }
    }
  } else {
    stats.files++;
  }
  callback(stats);
}
