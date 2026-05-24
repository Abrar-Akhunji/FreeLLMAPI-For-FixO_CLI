import fs from 'fs/promises';
import path from 'path';

// Allowed files for symbol extraction
const SEARCH_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.gemini', 'repo-assets']);

export interface CodeSymbol {
  name: string;
  type: 'class' | 'interface' | 'struct' | 'function' | 'method';
  file: string;
  line: number;
  snippet: string;
}

export interface IndexStatus {
  isIndexing: boolean;
  totalFiles: number;
  totalSymbols: number;
  lastIndexedAt: string | null;
  durationMs: number;
}

// In-memory index data stores
let workspaceSymbols: CodeSymbol[] = [];
let indexStatus: IndexStatus = {
  isIndexing: false,
  totalFiles: 0,
  totalSymbols: 0,
  lastIndexedAt: null,
  durationMs: 0,
};

const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Normalizes and cleans line snippets.
 */
function cleanSnippet(line: string): string {
  return line.trim().slice(0, 160);
}

/**
 * Extracts symbols from a single file based on its extension.
 */
async function parseFileSymbols(filePath: string, relativePath: string): Promise<CodeSymbol[]> {
  const symbols: CodeSymbol[] = [];
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const ext = path.extname(filePath).toLowerCase();

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      // 1. Classes
      let match = line.match(/\bclass\s+(\w+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'class', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 2. Interfaces
      match = line.match(/\binterface\s+(\w+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'interface', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 3. Standard Functions
      match = line.match(/\bfunction\s+(\w+)\s*\(/);
      if (match) {
        symbols.push({ name: match[1], type: 'function', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 4. Arrow Functions
      match = line.match(/\bconst\s+(\w+)\s*=\s*(?:\([^)]*\)|[^\s=]+)\s*=>/);
      if (match) {
        symbols.push({ name: match[1], type: 'function', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
    }

    if (ext === '.py') {
      // 1. Classes
      let match = line.match(/\bclass\s+(\w+)(?:\([^)]*\))?:/);
      if (match) {
        symbols.push({ name: match[1], type: 'class', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 2. Functions / Methods
      match = line.match(/\bdef\s+(\w+)\s*\(/);
      if (match) {
        const isMethod = line.startsWith('    ') || line.startsWith('\t');
        symbols.push({ name: match[1], type: isMethod ? 'method' : 'function', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
    }

    if (ext === '.go') {
      // 1. Functions
      let match = line.match(/\bfunc\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/);
      if (match) {
        symbols.push({ name: match[1], type: 'function', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 2. Structs
      match = line.match(/\btype\s+(\w+)\s+struct/);
      if (match) {
        symbols.push({ name: match[1], type: 'struct', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 3. Interfaces
      match = line.match(/\btype\s+(\w+)\s+interface/);
      if (match) {
        symbols.push({ name: match[1], type: 'interface', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
    }

    if (ext === '.rs') {
      // 1. Functions
      let match = line.match(/\bfn\s+(\w+)\s*\(/);
      if (match) {
        symbols.push({ name: match[1], type: 'function', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 2. Structs
      match = line.match(/\bstruct\s+(\w+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'struct', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
      // 3. Traits (Interfaces)
      match = line.match(/\btrait\s+(\w+)/);
      if (match) {
        symbols.push({ name: match[1], type: 'interface', file: relativePath, line: lineNum, snippet: cleanSnippet(line) });
        return;
      }
    }
  });

  return symbols;
}

/**
 * Builds the structural workspace index asynchronously.
 */
export async function buildWorkspaceIndex(): Promise<IndexStatus> {
  if (indexStatus.isIndexing) return indexStatus;

  const startTime = Date.now();
  indexStatus.isIndexing = true;

  const symbolsList: CodeSymbol[] = [];
  let fileCount = 0;

  async function walk(dir: string) {
    const files = await fs.readdir(dir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(file.name)) continue;
        await walk(fullPath);
      } else if (file.isFile()) {
        const ext = path.extname(file.name).toLowerCase();
        if (SEARCH_EXTENSIONS.has(ext)) {
          fileCount++;
          const relativePath = path.relative(WORKSPACE_ROOT, fullPath);
          try {
            const fileSymbols = await parseFileSymbols(fullPath, relativePath);
            symbolsList.push(...fileSymbols);
          } catch (err) {
            console.error(`Error parsing file symbols for ${relativePath}:`, err);
          }
        }
      }
    }
  }

  try {
    await walk(WORKSPACE_ROOT);
    workspaceSymbols = symbolsList;
    
    indexStatus = {
      isIndexing: false,
      totalFiles: fileCount,
      totalSymbols: symbolsList.length,
      lastIndexedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
    
    console.log(`[Workspace Indexer] Finished. Indexed ${fileCount} files, extracted ${symbolsList.length} symbols in ${indexStatus.durationMs}ms`);
  } catch (err) {
    console.error('Fatal error during indexing walk:', err);
    indexStatus.isIndexing = false;
  }

  return indexStatus;
}

/**
 * Retrieves the current indexing status.
 */
export function getIndexStatus(): IndexStatus {
  return indexStatus;
}

/**
 * Fuzzy search matches using tf-idf style keyword matching weights.
 */
export function queryIndex(queryText: string): CodeSymbol[] {
  if (!queryText) return [];

  const cleanQuery = queryText.toLowerCase().trim();
  const scored = workspaceSymbols.map(sym => {
    let score = 0;
    const symNameLower = sym.name.toLowerCase();
    const snippetLower = sym.snippet.toLowerCase();
    const fileLower = sym.file.toLowerCase();

    // 1. Exact Symbol Name Match
    if (symNameLower === cleanQuery) {
      score += 100;
    }
    // 2. Substring Symbol Name Match
    else if (symNameLower.includes(cleanQuery)) {
      score += 50;
      // Bonus if it starts with query
      if (symNameLower.startsWith(cleanQuery)) score += 20;
    }
    
    // 3. Substring Snippet / Code Match
    if (snippetLower.includes(cleanQuery)) {
      score += 15;
    }

    // 4. File Path Match
    if (fileLower.includes(cleanQuery)) {
      score += 20;
    }

    return { sym, score };
  });

  // Filter out zero matches and sort descending
  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.sym)
    .slice(0, 20); // Return top 20 best results
}
