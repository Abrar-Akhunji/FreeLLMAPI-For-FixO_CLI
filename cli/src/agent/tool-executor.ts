/**
 * Tool definitions and executor for the single-agent tool-calling loop.
 * Provides: read_file, write_file, run_command, search_code, list_dir
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { ChatToolDefinition } from '@freellmapi/shared/types.js';

/* ──────────────────────── ANSI Colors ──────────────────────── */

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
};

/* ──────────────────────── Tool Definitions ──────────────────────── */

export const TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the full text contents of a file at the given path. Use this to understand existing code before making changes. Returns the file contents as a string.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The file path to read, relative to the workspace root or absolute.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file. Creates the file and any parent directories if they do not exist. Overwrites existing content entirely.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The file path to write, relative to the workspace root or absolute.',
          },
          content: {
            type: 'string',
            description: 'The full file content to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command and return its stdout and stderr output. Use this to run tests, build projects, install dependencies, or verify changes. Commands run in the workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.',
          },
          cwd: {
            type: 'string',
            description:
              'Working directory for the command (optional, defaults to workspace root).',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description:
        'Search for a text or regex pattern in workspace files. Returns matching lines with file paths and line numbers. Use this to find where functions, classes, or variables are defined or used.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search pattern (plain text or regex).',
          },
          path: {
            type: 'string',
            description:
              'Directory or file to search in (optional, defaults to workspace root).',
          },
          file_pattern: {
            type: 'string',
            description:
              'Glob pattern to filter files, e.g., "*.ts" or "*.py" (optional).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'List files and directories at the given path. Returns names, types (file/dir), and sizes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The directory path to list (optional, defaults to workspace root).',
          },
        },
        required: [],
      },
    },
  },
];

/* ──────────────────────── Tool Executor ──────────────────────── */

export interface ToolCallEvent {
  tool: string;
  args: Record<string, string>;
  result: string;
  isWrite: boolean;
  affectedPath?: string;
}

/**
 * Execute a tool call and return its result string.
 * Also logs the operation to the terminal with colored output.
 */
export async function executeTool(
  name: string,
  args: Record<string, string>,
  cwd: string,
  verbose: boolean = false,
): Promise<ToolCallEvent> {
  const event: ToolCallEvent = {
    tool: name,
    args,
    result: '',
    isWrite: false,
  };

  try {
    switch (name) {
      case 'read_file':
        event.result = executeReadFile(args.path, cwd);
        event.affectedPath = resolvePath(args.path, cwd);
        logToolCall('📖', 'Read', shortenPath(args.path, cwd));
        break;

      case 'write_file':
        event.result = executeWriteFile(args.path, args.content, cwd);
        event.isWrite = true;
        event.affectedPath = resolvePath(args.path, cwd);
        logToolCall('✏️', 'Write', shortenPath(args.path, cwd));
        break;

      case 'run_command':
        logToolCall('⚙️', 'Run', truncate(args.command, 60));
        event.result = executeRunCommand(args.command, args.cwd || cwd);
        break;

      case 'search_code':
        logToolCall('🔍', 'Search', `"${truncate(args.query, 40)}" in ${args.path ?? '.'}`);
        event.result = executeSearchCode(args.query, args.path, args.file_pattern, cwd);
        break;

      case 'list_dir':
        logToolCall('📂', 'List', args.path ?? '.');
        event.result = executeListDir(args.path, cwd);
        break;

      default:
        event.result = `Error: Unknown tool "${name}"`;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    event.result = `Error: ${msg}`;
    console.log(`  ${colors.red}✗ ${name} failed: ${truncate(msg, 80)}${colors.reset}`);
  }

  return event;
}

/* ──────────────────────── Tool Implementations ──────────────────────── */

function executeReadFile(filePath: string, cwd: string): string {
  const resolved = resolvePath(filePath, cwd);

  if (!fs.existsSync(resolved)) {
    return `Error: File not found: ${filePath}`;
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return `Error: "${filePath}" is a directory, not a file. Use list_dir instead.`;
  }

  // Skip binary files
  if (stat.size > 500_000) {
    return `Error: File is too large (${(stat.size / 1024).toFixed(0)} KB). Read a smaller file or search for specific content.`;
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  return content;
}

function executeWriteFile(filePath: string, content: string, cwd: string): string {
  const resolved = resolvePath(filePath, cwd);

  // Security: prevent writes outside workspace
  const normalizedCwd = path.resolve(cwd);
  const normalizedTarget = path.resolve(resolved);
  if (!normalizedTarget.startsWith(normalizedCwd)) {
    return `Error: Cannot write outside workspace directory. Target: ${filePath}`;
  }

  // Create parent directories
  const parentDir = path.dirname(resolved);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  fs.writeFileSync(resolved, content, 'utf-8');

  return existed
    ? `File updated: ${filePath}`
    : `File created: ${filePath}`;
}

function executeRunCommand(command: string, cwd: string): string {
  // Security: block dangerous commands
  const dangerous = ['rm -rf /', 'rm -rf ~', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /'];
  for (const pattern of dangerous) {
    if (command.includes(pattern)) {
      return `Error: Blocked dangerous command: ${command}`;
    }
  }

  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 60_000, // 60 second timeout
      maxBuffer: 1024 * 1024, // 1MB max output
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    return output || '(command completed with no output)';
  } catch (error: any) {
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';
    const code = error.status ?? 'unknown';
    return `Command exited with code ${code}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`.trim();
  }
}

function executeSearchCode(
  query: string,
  searchPath: string | undefined,
  filePattern: string | undefined,
  cwd: string,
): string {
  const targetDir = searchPath ? resolvePath(searchPath, cwd) : cwd;

  // Try ripgrep first, fall back to grep
  let command = '';
  const escapedQuery = query.replace(/"/g, '\\"');

  try {
    // Check if rg (ripgrep) is available
    execSync('which rg', { encoding: 'utf-8', stdio: 'pipe' });
    command = `rg -n --no-heading --color never "${escapedQuery}"`;
    if (filePattern) {
      command += ` -g "${filePattern}"`;
    }
    command += ` "${targetDir}"`;
  } catch {
    // Fall back to grep
    command = `grep -rn "${escapedQuery}" "${targetDir}"`;
    if (filePattern) {
      command += ` --include="${filePattern}"`;
    }
  }

  command += ' 2>/dev/null | head -50';

  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 512 * 1024,
      cwd,
    });

    if (!output.trim()) {
      return `No matches found for "${query}"`;
    }

    // Make paths relative to workspace
    const lines = output.trim().split('\n').map((line) => {
      if (line.startsWith(cwd)) {
        return line.slice(cwd.length + 1);
      }
      return line;
    });

    return lines.join('\n');
  } catch {
    return `No matches found for "${query}"`;
  }
}

function executeListDir(dirPath: string | undefined, cwd: string): string {
  const resolved = dirPath ? resolvePath(dirPath, cwd) : cwd;

  if (!fs.existsSync(resolved)) {
    return `Error: Directory not found: ${dirPath ?? '.'}`;
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return `Error: "${dirPath}" is a file, not a directory. Use read_file instead.`;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (error) {
    return `Error: Cannot read directory: ${error instanceof Error ? error.message : String(error)}`;
  }

  // Filter and sort
  const filtered = entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
    .filter((e) => e.name !== 'node_modules')
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const lines: string[] = [];
  for (const entry of filtered) {
    if (entry.isDirectory()) {
      lines.push(`📁 ${entry.name}/`);
    } else {
      let size = '';
      try {
        const s = fs.statSync(path.join(resolved, entry.name));
        size = formatSize(s.size);
      } catch {
        // Ignore
      }
      lines.push(`   ${entry.name}${size ? `  (${size})` : ''}`);
    }
  }

  return lines.join('\n') || '(empty directory)';
}

/* ──────────────────────── Helpers ──────────────────────── */

function resolvePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function shortenPath(filePath: string, cwd: string): string {
  const resolved = resolvePath(filePath, cwd);
  if (resolved.startsWith(cwd)) {
    return resolved.slice(cwd.length + 1) || filePath;
  }
  return filePath;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function logToolCall(icon: string, action: string, detail: string): void {
  console.log(`  ${colors.dim}${icon} ${action}: ${detail}${colors.reset}`);
}
