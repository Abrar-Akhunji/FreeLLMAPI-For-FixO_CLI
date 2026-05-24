#!/usr/bin/env node
/**
 * FixO CLI — Entry Point
 *
 * Boot sequence:
 * 1. Load global config (~/.fixocli/config.json)
 * 2. If first run → run setup wizard
 * 3. Load project config (.freellmapi.yml) if present
 * 4. Ensure proxy server is running on the configured port
 * 5. Launch interactive REPL
 */
import fs from 'fs';
import path from 'path';
import { loadConfig, saveConfig, getDefaultConfig, type FreeLLMConfig } from './config.js';
import { runSetupWizard } from './setup-wizard.js';
import { startREPL } from './ui/prompt.js';
import type { ProjectConfig } from './types.js';

/* ──────────────────────── ANSI Colors ──────────────────────── */

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/* ──────────────────────── CLI Args ──────────────────────── */

function parseArgs(): {
  help: boolean;
  version: boolean;
  verbose: boolean;
  model?: string;
  port?: number;
  task?: string;
} {
  const args = process.argv.slice(2);
  const result = {
    help: false,
    version: false,
    verbose: false,
    model: undefined as string | undefined,
    port: undefined as number | undefined,
    task: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--version':
      case '-v':
        result.version = true;
        break;
      case '--verbose':
      case '-V':
        result.verbose = true;
        break;
      case '--model':
      case '-m':
        result.model = args[++i];
        break;
      case '--port':
      case '-p':
        result.port = parseInt(args[++i], 10);
        break;
      case '--task':
      case '-t':
        result.task = args.slice(i + 1).join(' ');
        i = args.length; // consume rest
        break;
      default:
        // If no flag, treat rest as task
        if (!arg.startsWith('-')) {
          result.task = args.slice(i).join(' ');
          i = args.length;
        }
        break;
    }
  }

  return result;
}

function printHelpMessage(): void {
  console.log(`
${c.cyan}${c.bold}FixO CLI${c.reset} — Autonomous Free Multi-Provider LLM Coding Tool

${c.bold}USAGE${c.reset}
  fixo                           Start interactive REPL
  fixo "fix the bug"             Run a one-shot task
  fixo --help                    Show this help

${c.bold}OPTIONS${c.reset}
  -h, --help          Show help
  -v, --version       Show version
  -V, --verbose       Enable verbose/debug output
  -m, --model <name>  Set the model (default: auto)
  -p, --port <port>   Proxy server port (default: 3001)
  -t, --task <text>   Run a one-shot task

${c.bold}INTERACTIVE COMMANDS${c.reset}
  /help               Show all commands
  /model [name]       Change or show model
  /select [file]      Pin a file for context
  /diff               Show git diff
  /undo               Undo last AI change
  /clear              Clear conversation
  /stats              Show usage statistics
  /exit               Exit

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Start interactive mode${c.reset}
  fixo

  ${c.dim}# One-shot task${c.reset}
  fixo "add input validation to user.ts"

  ${c.dim}# Use a specific model${c.reset}
  fixo -m gemini-2.5-flash "explain this codebase"
  `);
}

/* ──────────────────────── Project Config ──────────────────────── */

function loadProjectConfig(cwd: string): ProjectConfig | undefined {
  const yamlPath = path.join(cwd, '.freellmapi.yml');
  const yamlAltPath = path.join(cwd, '.freellmapi.yaml');

  let configPath: string | undefined;
  if (fs.existsSync(yamlPath)) configPath = yamlPath;
  else if (fs.existsSync(yamlAltPath)) configPath = yamlAltPath;

  if (!configPath) return undefined;

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple YAML parser for our subset (avoid requiring js-yaml at runtime)
    const config: ProjectConfig = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      switch (key) {
        case 'model':
          config.model = value;
          break;
        case 'checkCommand':
          config.checkCommand = value;
          break;
        case 'autoCommit':
          config.autoCommit = value === 'true';
          break;
        case 'systemPrompt':
          // Multi-line: collect all subsequent indented lines
          config.systemPrompt = value.startsWith('|')
            ? collectMultilineValue(content, line)
            : value;
          break;
      }
    }

    return config;
  } catch {
    return undefined;
  }
}

function collectMultilineValue(fullContent: string, startLine: string): string {
  const lines = fullContent.split('\n');
  const startIdx = lines.indexOf(startLine);
  if (startIdx === -1) return '';

  const result: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('  ') || line.startsWith('\t')) {
      result.push(line.trim());
    } else if (line.trim() === '') {
      result.push('');
    } else {
      break;
    }
  }
  return result.join('\n').trim();
}

/* ──────────────────────── Main ──────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelpMessage();
    process.exit(0);
  }

  if (args.version) {
    try {
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`fixo-cli v${pkg.version}`);
    } catch {
      console.log('fixo-cli v1.0.0');
    }
    process.exit(0);
  }

  // ──── Step 1: Load config ────
  let config = loadConfig();

  // ──── Step 2: First-run wizard ────
  if (!config._firstRunComplete || !config.freellmapi_api_key || !config.apiUrl) {
    config = await runSetupWizard();
    saveConfig(config);
  }

  // ──── Step 3: Load project config ────
  const cwd = process.cwd();
  const projectConfig = loadProjectConfig(cwd);

  // ──── Apply CLI overrides ────
  const model = args.model ?? projectConfig?.model ?? config.defaultModel;
  const verbose = args.verbose;

  // ──── Step 4: Launch ────
  if (args.task) {
    // One-shot mode: run task and exit
    const { SingleAgent } = await import('./agent/single-agent.js');
    const { ConversationManager } = await import('./agent/conversation.js');
    const agent = new SingleAgent(verbose);
    const conversation = new ConversationManager();

    const result = await agent.runStreaming(
      {
        task: args.task,
        model: model ?? 'auto',
        cwd,
        verbose,
        selectedFiles: [],
        systemPromptOverride: projectConfig?.systemPrompt,
        checkCommand: projectConfig?.checkCommand,
      },
      conversation,
    );

    // Print final stats
    console.log(
      `\n${c.dim}${result.tokensUsed.total_tokens} tokens · ${result.toolCallCount} tool calls · ${(result.durationMs / 1000).toFixed(1)}s${c.reset}`,
    );

    process.exit(result.success ? 0 : 1);
  }

  // Interactive REPL mode
  await startREPL({
    config,
    projectConfig,
    cwd,
    verbose,
  });
}

// ──── Run ────
main().catch((error) => {
  console.error(`${c.red}Fatal error: ${error.message ?? error}${c.reset}`);
  process.exit(1);
});
