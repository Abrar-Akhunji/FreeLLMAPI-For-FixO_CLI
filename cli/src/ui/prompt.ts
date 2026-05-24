/**
 * Interactive REPL shell for FixO CLI.
 * Provides command handling, file pinning, model selection,
 * and routes user input to the SingleAgent.
 */
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import { SingleAgent } from '../agent/single-agent.js';
import { ConversationManager } from '../agent/conversation.js';
import { GitManager } from '../git/git-manager.js';
import type { AgentContext, ProjectConfig } from '../types.js';
import type { FreeLLMConfig } from '../config.js';

/* ──────────────────────── ANSI Colors ──────────────────────── */

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  bgCyan: '\x1b[46m',
  white: '\x1b[37m',
};

/* ──────────────────────── Welcome Banner ──────────────────────── */

function printWelcome(): void {
  console.log('');
  console.log(`${c.cyan}╔══════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset}  🚀 Welcome to FixO CLI!                 ${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}║${c.reset}  Powered by FreeLLMAPI Backend Engine    ${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}╚══════════════════════════════════════════╝${c.reset}`);
  console.log('');
  console.log(`${c.dim}Commands:${c.reset}`);
  console.log(`${c.dim}  /help      Show all commands        /model     Change model${c.reset}`);
  console.log(`${c.dim}  /diff      Show git diff            /undo      Undo last change${c.reset}`);
  console.log(`${c.dim}  /clear     Clear conversation       /exit      Exit${c.reset}`);
  console.log(`${c.dim}  /select    Pin files for context    /stats     Show usage stats${c.reset}`);
  console.log(`${c.dim}  Or type any task to start coding!${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(70)}${c.reset}`);
}

function printHelp(): void {
  console.log('');
  console.log(`${c.bold}${c.cyan}FixO CLI Commands${c.reset}`);
  console.log('');
  console.log(`  ${c.cyan}/help${c.reset}         Show this help`);
  console.log(`  ${c.cyan}/model${c.reset} [name]  Change or show current model`);
  console.log(`  ${c.cyan}/select${c.reset} [file] Pin a file for agent context`);
  console.log(`  ${c.cyan}/unselect${c.reset}      Clear all pinned files`);
  console.log(`  ${c.cyan}/diff${c.reset}          Show git diff of workspace`);
  console.log(`  ${c.cyan}/undo${c.reset}          Undo last auto-committed change`);
  console.log(`  ${c.cyan}/clear${c.reset}         Clear conversation history`);
  console.log(`  ${c.cyan}/stats${c.reset}         Show token usage statistics`);
  console.log(`  ${c.cyan}/log${c.reset}           Show recent git commits`);
  console.log(`  ${c.cyan}/exit${c.reset}          Exit FixO CLI`);
  console.log('');
  console.log(`${c.dim}  Shell commands: prefix with ! (e.g., !npm test, !ls -la)${c.reset}`);
  console.log(`${c.dim}  File paths:     mention files and they'll be highlighted${c.reset}`);
  console.log(`${c.dim}  Binary hooks:   run commands via 'fixo <task>' or 'fixo-cli <task>'${c.reset}`);
  console.log('');
}

/* ──────────────────────── Prompt Builder ──────────────────────── */

function buildPromptString(cwd: string, model: string, branch: string): string {
  const dirName = path.basename(cwd);
  const branchPart = branch ? ` ${c.magenta}${branch}${c.reset}` : '';
  const modelPart = `${c.gray}${model}${c.reset}`;
  return `\n${c.blue}📂 ${dirName}${c.reset}${branchPart}  ${modelPart}\n${c.green}❯${c.reset} `;
}

/* ──────────────────────── File Path Formatting ──────────────────────── */

function formatInputPaths(input: string): string {
  // Replace absolute paths with just the filename highlighted
  return input.replace(/(?:\/[\w.-]+)+/g, (match) => {
    const basename = path.basename(match);
    return `${c.cyan}${c.bold}${basename}${c.reset}`;
  });
}

/* ──────────────────────── Stats Tracker ──────────────────────── */

interface SessionStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalToolCalls: number;
  totalTasks: number;
  totalDurationMs: number;
}

/* ──────────────────────── REPL ──────────────────────── */

export interface PromptOptions {
  config: FreeLLMConfig;
  projectConfig?: ProjectConfig;
  cwd: string;
  verbose: boolean;
}

export async function startREPL(options: PromptOptions): Promise<void> {
  const { config, projectConfig, cwd, verbose } = options;

  // ──── Initialize components ────
  const agent = new SingleAgent(verbose);
  const conversation = new ConversationManager();
  const git = new GitManager(cwd);
  const branch = git.isGitRepo() ? git.getCurrentBranch() : '';

  let currentModel = projectConfig?.model ?? config.defaultModel ?? 'auto';
  let selectedFiles: string[] = [];

  const stats: SessionStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalToolCalls: 0,
    totalTasks: 0,
    totalDurationMs: 0,
  };

  // ──── Print welcome ────
  printWelcome();

  if (projectConfig?.systemPrompt) {
    console.log(`${c.dim}📋 Project config loaded (.freellmapi.yml)${c.reset}`);
  }

  // ──── Create readline interface ────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line: string) => {
      const commands = [
        '/help', '/model', '/select', '/unselect', '/diff',
        '/undo', '/clear', '/stats', '/log', '/exit',
      ];
      if (line.startsWith('/')) {
        const matches = commands.filter((cmd) => cmd.startsWith(line));
        return [matches, line];
      }
      return [[], line];
    },
  });

  // ──── REPL loop ────
  const promptForInput = (): void => {
    const currentBranch = git.isGitRepo() ? git.getCurrentBranch() : '';
    rl.question(
      buildPromptString(cwd, currentModel, currentBranch),
      async (input) => {
        const trimmed = input.trim();

        if (!trimmed) {
          promptForInput();
          return;
        }

        try {
          await handleInput(trimmed);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`\n${c.red}✗ Error: ${msg}${c.reset}`);

          // Actionable error suggestions
          if (msg.includes('ECONNREFUSED')) {
            console.log(`${c.dim}  → Proxy server is down. Restart with: npm run dev${c.reset}`);
          } else if (msg.includes('413')) {
            console.log(`${c.dim}  → Reduce context: /unselect to clear pinned files${c.reset}`);
          } else if (msg.includes('429')) {
            console.log(`${c.dim}  → Rate limited. Wait a moment or add more API keys.${c.reset}`);
          }
        }

        promptForInput();
      },
    );
  };

  // ──── Input handler ────
  async function handleInput(input: string): Promise<void> {
    // ─── Slash commands ───
    if (input.startsWith('/')) {
      const [cmd, ...args] = input.split(/\s+/);

      switch (cmd) {
        case '/exit':
        case '/quit':
          console.log(`\n${c.dim}👋 Goodbye!${c.reset}`);
          rl.close();
          process.exit(0);

        case '/help':
          printHelp();
          return;

        case '/model': {
          if (args.length === 0) {
            console.log(`\n${c.dim}Current model: ${c.cyan}${currentModel}${c.reset}`);
            return;
          }
          currentModel = args.join(' ');
          console.log(`\n${c.green}✓ Model set to: ${c.bold}${currentModel}${c.reset}`);
          return;
        }

        case '/select': {
          if (args.length === 0) {
            if (selectedFiles.length === 0) {
              console.log(`\n${c.dim}No files selected. Usage: /select <file-path>${c.reset}`);
            } else {
              console.log(`\n${c.dim}Selected files:${c.reset}`);
              for (const f of selectedFiles) {
                console.log(`  ${c.cyan}${path.basename(f)}${c.reset} ${c.dim}(${f})${c.reset}`);
              }
            }
            return;
          }
          let rawPath = args.join(' ');
          if ((rawPath.startsWith("'") && rawPath.endsWith("'")) ||
              (rawPath.startsWith('"') && rawPath.endsWith('"'))) {
            rawPath = rawPath.slice(1, -1);
          }
          const filePath = path.resolve(cwd, rawPath);
          if (!fs.existsSync(filePath)) {
            console.log(`\n${c.red}✗ File not found: ${rawPath}${c.reset}`);
            return;
          }
          if (!selectedFiles.includes(filePath)) {
            selectedFiles.push(filePath);
          }
          console.log(`\n${c.green}✓ Pinned: ${c.bold}${path.basename(filePath)}${c.reset}`);
          return;
        }

        case '/unselect':
          selectedFiles = [];
          console.log(`\n${c.green}✓ All pinned files cleared${c.reset}`);
          return;

        case '/diff':
          console.log(`\n${git.getDiff()}`);
          return;

        case '/undo': {
          rl.pause();
          const confirmed = await p.confirm({
            message: 'Are you sure you want to completely discard the last automated agent commit and restore all files?',
            initialValue: false,
          });
          rl.resume();
          if (p.isCancel(confirmed) || !confirmed) {
            console.log(`\n${c.yellow}  ⚠ Undo cancelled.${c.reset}`);
            return;
          }
          git.undoLastCommit();
          return;
        }

        case '/clear':
          conversation.clear();
          console.log(`\n${c.green}✓ Conversation cleared${c.reset}`);
          return;

        case '/log':
          console.log(`\n${git.getRecentCommits(10)}`);
          return;

        case '/stats':
          printStats(stats);
          return;

        default:
          console.log(`\n${c.yellow}Unknown command: ${cmd}. Type /help for available commands.${c.reset}`);
          return;
      }
    }

    // ─── Shell commands (! prefix) ───
    if (input.startsWith('!')) {
      const cmd = input.slice(1).trim();
      if (!cmd) return;
      console.log(`${c.dim}⚙️ Running: ${cmd}${c.reset}`);
      try {
        const { execSync } = await import('child_process');
        const output = execSync(cmd, {
          cwd,
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        if (output.trim()) console.log(output);
      } catch (error: any) {
        if (error.stdout) console.log(error.stdout);
        if (error.stderr) console.error(`${c.red}${error.stderr}${c.reset}`);
      }
      return;
    }

    // ─── Agent task ───
    // Format any paths in the input for display
    const displayInput = formatInputPaths(input);
    if (displayInput !== input) {
      // Re-display with highlighted paths
      process.stdout.write(`\x1b[1A\x1b[2K`); // Move up and clear line
      const currentBranch = git.isGitRepo() ? git.getCurrentBranch() : '';
      console.log(
        `${buildPromptString(cwd, currentModel, currentBranch).trim()} ${displayInput}`,
      );
    }

    // Extract any file paths from input for automatic pinning
    const pathsInInput = extractFilePaths(input, cwd);

    const context: AgentContext = {
      task: input,
      model: currentModel,
      cwd,
      verbose,
      selectedFiles: [...selectedFiles, ...pathsInInput],
      systemPromptOverride: projectConfig?.systemPrompt,
      checkCommand: projectConfig?.checkCommand,
    };

    // Run the agent
    const result = await agent.runStreaming(context, conversation);

    // Print result summary
    console.log('');
    const tokenInfo = `${c.dim}${result.tokensUsed.total_tokens} tokens · ${result.toolCallCount} tool calls · ${(result.durationMs / 1000).toFixed(1)}s${c.reset}`;
    console.log(tokenInfo);

    // Auto-commit if enabled
    if (
      config.preferences.autoCommit &&
      (projectConfig?.autoCommit !== false) &&
      result.modifiedFiles.length > 0
    ) {
      git.autoCommit(input, result.modifiedFiles);
    }

    // Update stats
    stats.totalPromptTokens += result.tokensUsed.prompt_tokens;
    stats.totalCompletionTokens += result.tokensUsed.completion_tokens;
    stats.totalToolCalls += result.toolCallCount;
    stats.totalTasks++;
    stats.totalDurationMs += result.durationMs;
  }

  // Start the loop
  promptForInput();
}

/* ──────────────────────── Helpers ──────────────────────── */

function extractFilePaths(input: string, cwd: string): string[] {
  const paths: string[] = [];
  // Match quoted paths or paths with extensions
  const patterns = [
    /'([^']+\.\w+)'/g,
    /"([^"]+\.\w+)"/g,
    /\b([\w./\\-]+\.\w{1,10})\b/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
      const filePath = path.resolve(cwd, match[1]);
      if (fs.existsSync(filePath) && !paths.includes(filePath)) {
        paths.push(filePath);
      }
    }
  }

  return paths;
}

function printStats(stats: SessionStats): void {
  const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
  const avgDuration = stats.totalTasks > 0
    ? (stats.totalDurationMs / stats.totalTasks / 1000).toFixed(1)
    : '0';

  // Rough cost estimation: $3/M input + $15/M output tokens (average across providers)
  const estimatedCost =
    (stats.totalPromptTokens / 1_000_000) * 3 +
    (stats.totalCompletionTokens / 1_000_000) * 15;

  console.log('');
  console.log(`${c.cyan}${c.bold}📊 Session Statistics${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(40)}${c.reset}`);
  console.log(`  Tasks completed:     ${c.bold}${stats.totalTasks}${c.reset}`);
  console.log(`  Tool calls:          ${c.bold}${stats.totalToolCalls}${c.reset}`);
  console.log(`  Input tokens:        ${c.bold}${stats.totalPromptTokens.toLocaleString()}${c.reset}`);
  console.log(`  Output tokens:       ${c.bold}${stats.totalCompletionTokens.toLocaleString()}${c.reset}`);
  console.log(`  Total tokens:        ${c.bold}${totalTokens.toLocaleString()}${c.reset}`);
  console.log(`  Avg task duration:   ${c.bold}${avgDuration}s${c.reset}`);
  console.log(`  Cost savings:        ${c.green}${c.bold}~$${estimatedCost.toFixed(2)} saved${c.reset} ${c.dim}(free models!)${c.reset}`);
  console.log('');
}
