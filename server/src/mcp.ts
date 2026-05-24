import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { queryIndex, buildWorkspaceIndex, getIndexStatus } from './services/indexer.js';

// Define the root workspace path safely
const WORKSPACE_ROOT = path.resolve(process.cwd());

/**
 * Validates and resolves the target path, ensuring it remains strictly inside the workspace root.
 */
function getSafePath(inputPath: string): string {
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(WORKSPACE_ROOT, inputPath);

  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Access denied: Path '${inputPath}' lies outside the allowed workspace directory.`
    );
  }
  return resolved;
}

// Instantiate the MCP Server
const server = new Server(
  {
    name: 'freellmapi-workspace-agent',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list of tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_codebase_summary',
        description: 'Generates a high-level visual tree structure of the workspace files, ignoring build artifacts and dependency folders.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_directory',
        description: 'Lists all files and subdirectories inside a specific directory inside the workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative or absolute directory path (defaults to root workspace directory).',
            },
          },
        },
      },
      {
        name: 'read_file',
        description: 'Reads the complete plain text content of a file in the workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative or absolute file path to read.',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Writes/creates a file in the workspace, creating any necessary parent directories automatically.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative or absolute path of the file to create or overwrite.',
            },
            content: {
              type: 'string',
              description: 'Text content to write into the file.',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'grep_search',
        description: 'Recursively searches for matching substrings or regex expressions in all text files inside the workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The query text or keyword to search for.',
            },
            path: {
              type: 'string',
              description: 'Target directory to search inside (defaults to root workspace directory).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'semantic_search',
        description: 'Searches the pre-computed AST workspace index for classes, interfaces, structs, and functions using natural language or fuzzy symbol matches. Exceedingly fast and token-efficient.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Fuzzy symbol name, function name, class name, or natural language query (e.g. "auth service", "UserModel").',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Helper to log tool call lifecycles to Express server
async function logToolCall(payload: {
  id: string;
  tool: string;
  arguments: any;
  status: 'started' | 'completed' | 'failed';
  error?: string;
  originalContent?: string;
  newContent?: string;
}) {
  const port = process.env.PORT || 3001;
  try {
    await fetch(`http://localhost:${port}/api/mcp/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[MCP Logger Error] Failed to log tool call:', err);
  }
}

// Register tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolCallId = randomUUID();

  // Send started log
  await logToolCall({
    id: toolCallId,
    tool: name,
    arguments: args,
    status: 'started',
  });

  try {
    let originalContent: string | undefined;
    let newContent: string | undefined;

    if (name === 'write_file') {
      const rawPath = args?.path as string;
      if (rawPath) {
        try {
          const safePath = getSafePath(rawPath);
          originalContent = await fs.readFile(safePath, 'utf-8');
        } catch {
          originalContent = '';
        }
      }
      newContent = args?.content as string;
    }

    let result;
    switch (name) {
      case 'get_codebase_summary': {
        const lines: string[] = ['Root workspace: ' + path.basename(WORKSPACE_ROOT)];
        const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.gemini', 'package-lock.json']);

        async function walk(dir: string, depth = 1) {
          if (depth > 4) return; // Prevent excessive recursion depth
          const files = await fs.readdir(dir, { withFileTypes: true });

          // Sort directories first, then files
          const sorted = files.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

          for (const file of sorted) {
            if (ignoreDirs.has(file.name)) continue;
            const prefix = '  '.repeat(depth) + '├── ';

            if (file.isDirectory()) {
              lines.push(`${prefix}📁 ${file.name}/`);
              await walk(path.join(dir, file.name), depth + 1);
            } else {
              lines.push(`${prefix}📄 ${file.name}`);
            }
          }
        }

        await walk(WORKSPACE_ROOT);
        result = {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
            },
          ],
        };
        break;
      }

      case 'list_directory': {
        const rawPath = (args?.path as string) || '.';
        const safePath = getSafePath(rawPath);

        const files = await fs.readdir(safePath, { withFileTypes: true });
        const results = [];

        for (const file of files) {
          const fullPath = path.join(safePath, file.name);
          let sizeBytes = 0;
          if (file.isFile()) {
            const stat = await fs.stat(fullPath);
            sizeBytes = stat.size;
          }

          results.push({
            name: file.name,
            type: file.isDirectory() ? 'directory' : 'file',
            sizeBytes: file.isFile() ? sizeBytes : undefined,
            path: path.relative(WORKSPACE_ROOT, fullPath),
          });
        }

        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
        break;
      }

      case 'read_file': {
        const rawPath = args?.path as string;
        if (!rawPath) {
          throw new McpError(ErrorCode.InvalidParams, 'Parameter "path" is required.');
        }

        const safePath = getSafePath(rawPath);
        const stats = await fs.stat(safePath);
        if (!stats.isFile()) {
          throw new McpError(ErrorCode.InvalidParams, `'${rawPath}' is a directory, not a file.`);
        }

        const content = await fs.readFile(safePath, 'utf-8');
        result = {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
        break;
      }

      case 'write_file': {
        const rawPath = args?.path as string;
        const content = args?.content as string;
        if (!rawPath || content === undefined) {
          throw new McpError(ErrorCode.InvalidParams, 'Parameters "path" and "content" are required.');
        }

        const safePath = getSafePath(rawPath);

        // Auto-create parent directories if they don't exist
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, content, 'utf-8');

        result = {
          content: [
            {
              type: 'text',
              text: `Successfully wrote file at: ${path.relative(WORKSPACE_ROOT, safePath)}`,
            },
          ],
        };
        break;
      }

      case 'grep_search': {
        const query = args?.query as string;
        const rawPath = (args?.path as string) || '.';
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'Parameter "query" is required.');
        }

        const safePath = getSafePath(rawPath);
        const results: { file: string; line: number; content: string }[] = [];
        const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.gemini']);

        async function search(dir: string) {
          const files = await fs.readdir(dir, { withFileTypes: true });

          for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
              if (ignoreDirs.has(file.name)) continue;
              await search(fullPath);
            } else if (file.isFile()) {
              // Read only standard text files (rough exclusion of binary formats)
              const ext = path.extname(file.name).toLowerCase();
              const skipExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.db', '.zip', '.tar', '.gz']);
              if (skipExts.has(ext)) continue;

              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');

              lines.forEach((line, index) => {
                if (line.includes(query)) {
                  results.push({
                    file: path.relative(WORKSPACE_ROOT, fullPath),
                    line: index + 1,
                    content: line.trim(),
                  });
                }
              });
            }
          }
        }

        await search(safePath);

        result = {
          content: [
            {
              type: 'text',
              text: results.length > 0
                ? JSON.stringify(results, null, 2)
                : `No occurrences of "${query}" found.`,
            },
          ],
        };
        break;
      }

      case 'semantic_search': {
        const query = args?.query as string;
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'Parameter "query" is required.');
        }

        // Try to query the index. If no index exists, trigger an initial build
        let status = getIndexStatus();
        if (status.totalSymbols === 0 && !status.isIndexing && !status.lastIndexedAt) {
          console.error('[MCP Server] Workspace index is empty. Performing initial workspace index scan...');
          await buildWorkspaceIndex();
        }

        const results = queryIndex(query);
        result = {
          content: [
            {
              type: 'text',
              text: results.length > 0
                ? JSON.stringify(results, null, 2)
                : `No symbols found matching "${query}" in workspace AST index.`,
            },
          ],
        };
        break;
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool request: ${name}`
        );
    }

    // Send completed log
    await logToolCall({
      id: toolCallId,
      tool: name,
      arguments: args,
      status: 'completed',
      originalContent,
      newContent,
    });

    return result;
  } catch (error: any) {
    // Send failed log
    await logToolCall({
      id: toolCallId,
      tool: name,
      arguments: args,
      status: 'failed',
      error: error.message || String(error),
    });

    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool "${name}": ${error.message || error}`,
        },
      ],
      isError: true,
    };
  }
});

// Start listening over Stdio Transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('FreeLLMAPI Workspace Agent MCP Server running on STDIO');
}

run().catch((error) => {
  console.error('Fatal error starting MCP Server:', error);
  process.exit(1);
});
