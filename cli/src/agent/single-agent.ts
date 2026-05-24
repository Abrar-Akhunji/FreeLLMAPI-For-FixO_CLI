/**
 * Single-Agent with Tool Calling — replaces the 7-stage pipeline.
 * One agent, 5 tools, 2–3 LLM calls for most tasks instead of 6+.
 *
 * Architecture:
 *   User Input → Complexity Check → Agentic Tool Loop → Result
 *   (trivial queries skip the tool loop entirely)
 */
import type { ChatMessage, TokenUsage } from '@freellmapi/shared/types.js';
import { AgentClient, type ChatResult, type StreamChunk } from './agent-client.js';
import { ConversationManager } from './conversation.js';
import { TOOL_DEFINITIONS, executeTool, type ToolCallEvent } from './tool-executor.js';
import { buildRepoMap } from './repo-map.js';
import type { AgentContext, AgentResult } from '../types.js';
import { loadConfig } from '../config.js';

/* ──────────────────────── Constants ──────────────────────── */

const MAX_TOOL_CALLS = 25;
const MAX_TOOL_RESULT_LENGTH = 30_000;

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

/* ──────────────────────── Trivial Query Detection ──────────────────────── */

const TRIVIAL_PATTERNS = [
  /^(hi|hey|hello|howdy|yo|sup|greetings|hola|namaste)/i,
  /^(thanks|thank you|thx|ty|cheers)/i,
  /^(what can you do|who are you|help me|how does this work)/i,
  /^(good morning|good evening|good night|gm|gn)/i,
  /^(ok|okay|sure|great|nice|cool|awesome|perfect|got it)/i,
  /^(bye|goodbye|see you|later|exit|quit)/i,
];

function isTrivialQuery(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 3) return true;
  if (trimmed.length > 100) return false; // Long inputs are usually tasks

  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/* ──────────────────────── System Prompt ──────────────────────── */

function buildSystemPrompt(
  repoMap: string,
  context: AgentContext,
): string {
  const parts: string[] = [
    `You are FixO CLI, an autonomous AI coding agent. You help developers by reading, writing, and modifying code files in their workspace.`,
    ``,
    `## Capabilities`,
    `You have access to these tools:`,
    `- **read_file(path)** — Read a file's contents`,
    `- **write_file(path, content)** — Create or overwrite a file`,
    `- **run_command(command)** — Execute a shell command (npm test, git status, etc.)`,
    `- **search_code(query)** — Search for patterns in the codebase`,
    `- **list_dir(path)** — List directory contents`,
    ``,
    `## Guidelines`,
    `1. ALWAYS read existing files before modifying them to understand current code.`,
    `2. Write complete file contents — never use placeholders like "// ... rest of the file".`,
    `3. After making changes, run the verification command if one is configured.`,
    `4. Keep your text responses concise. Focus on what you did and why.`,
    `5. If the task is ambiguous, ask a clarifying question instead of guessing.`,
    `6. Preserve existing code comments and formatting unless asked to change them.`,
    ``,
    `## Workspace`,
    `Working directory: ${context.cwd}`,
  ];

  // Add pinned files info
  if (context.selectedFiles.length > 0) {
    parts.push(`Pinned files: ${context.selectedFiles.join(', ')}`);
  }

  // Add verification command
  if (context.checkCommand) {
    parts.push(`Verification command: \`${context.checkCommand}\``);
  }

  // Add project-specific system prompt
  if (context.systemPromptOverride) {
    parts.push(``, `## Project Instructions`, context.systemPromptOverride);
  }

  // Add repo map
  parts.push(``, repoMap);

  return parts.join('\n');
}

/* ──────────────────────── SingleAgent ──────────────────────── */

export class SingleAgent {
  private client: AgentClient;
  private verbose: boolean;

  constructor(verbose = false) {
    const config = loadConfig();
    this.client = new AgentClient(config.freellmapi_api_key || '', config.apiUrl, verbose);
    this.verbose = verbose;
  }

  /**
   * Run a task using the single-agent tool-calling loop.
   */
  async run(
    context: AgentContext,
    conversation: ConversationManager,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let toolCallCount = 0;
    const modifiedFiles: string[] = [];

    // ──── Trivial query shortcut ────
    if (isTrivialQuery(context.task)) {
      return this.handleTrivialQuery(context, conversation, startTime);
    }

    // ──── Build context ────
    const repoMap = buildRepoMap(context.cwd);
    const systemPrompt = buildSystemPrompt(repoMap, context);

    // ──── Assemble messages ────
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversation.getMessages(),
      { role: 'user', content: context.task },
    ];

    // ──── Agentic tool-calling loop ────
    console.log(`\n${colors.cyan}${colors.bold}🤖 Agent working...${colors.reset}`);

    while (toolCallCount < MAX_TOOL_CALLS) {
      // Make the LLM call
      const result = await this.client.chat(messages, context.model, {
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      });

      // Accumulate token usage
      totalUsage.prompt_tokens += result.usage.prompt_tokens;
      totalUsage.completion_tokens += result.usage.completion_tokens;
      totalUsage.total_tokens += result.usage.total_tokens;

      // ──── No tool calls → final answer ────
      if (!result.tool_calls || result.tool_calls.length === 0) {
        const response = result.content ?? '';
        conversation.addTurn(context.task, response);

        return {
          success: true,
          response,
          modifiedFiles,
          tokensUsed: totalUsage,
          toolCallCount,
          durationMs: Date.now() - startTime,
        };
      }

      // ──── Has tool calls → execute them ────
      // Add assistant message with tool_calls to history
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls,
      };
      messages.push(assistantMsg);

      // Print any thinking text
      if (result.content) {
        console.log(`${colors.dim}${result.content}${colors.reset}`);
      }

      // Execute each tool call
      for (const toolCall of result.tool_calls) {
        let parsedArgs: Record<string, string>;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          parsedArgs = { error: 'Failed to parse tool arguments' };
        }

        const event = await executeTool(
          toolCall.function.name,
          parsedArgs,
          context.cwd,
          this.verbose,
        );

        // Track file writes
        if (event.isWrite && event.affectedPath) {
          if (!modifiedFiles.includes(event.affectedPath)) {
            modifiedFiles.push(event.affectedPath);
          }
        }

        // Truncate very long tool results to save context tokens
        let toolResult = event.result;
        if (toolResult.length > MAX_TOOL_RESULT_LENGTH) {
          toolResult =
            toolResult.slice(0, MAX_TOOL_RESULT_LENGTH) +
            `\n\n... (truncated, ${toolResult.length} total characters)`;
        }

        // Add tool result to messages
        const toolMsg: ChatMessage = {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        };
        messages.push(toolMsg);

        toolCallCount++;
      }
    }

    // ──── Safety limit reached ────
    console.log(
      `${colors.yellow}⚠  Reached tool call limit (${MAX_TOOL_CALLS}). Stopping.${colors.reset}`,
    );

    conversation.addTurn(
      context.task,
      `Task processed with ${toolCallCount} tool calls. Some actions may be incomplete due to the call limit.`,
    );

    return {
      success: true,
      response: `Completed with ${toolCallCount} tool calls. Check the modified files.`,
      modifiedFiles,
      tokensUsed: totalUsage,
      toolCallCount,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Handle a simple conversational query with no tools — just a direct response.
   */
  private async handleTrivialQuery(
    context: AgentContext,
    conversation: ConversationManager,
    startTime: number,
  ): Promise<AgentResult> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are FixO CLI, a friendly AI coding assistant. Respond briefly and helpfully. If the user hasn't asked a specific coding question, introduce yourself and mention you can help with reading, writing, and modifying code files in their workspace.`,
      },
      ...conversation.getMessages(),
      { role: 'user', content: context.task },
    ];

    const result = await this.client.chat(messages, context.model);
    const response = result.content ?? "Hi! I'm FixO CLI. I can help you with coding tasks — just describe what you need.";

    conversation.addTurn(context.task, response);

    return {
      success: true,
      response,
      modifiedFiles: [],
      tokensUsed: result.usage,
      toolCallCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Stream a task with real-time output.
   * For tool-calling tasks, the loop still uses non-streaming calls
   * for tool interactions but streams the final response.
   */
  async runStreaming(
    context: AgentContext,
    conversation: ConversationManager,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let toolCallCount = 0;
    const modifiedFiles: string[] = [];

    // ──── Trivial query → stream directly ────
    if (isTrivialQuery(context.task)) {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You are FixO CLI, a friendly AI coding assistant. Respond briefly and helpfully.`,
        },
        ...conversation.getMessages(),
        { role: 'user', content: context.task },
      ];

      const fullResponse = await this.streamResponse(messages, context.model, totalUsage);
      conversation.addTurn(context.task, fullResponse);

      return {
        success: true,
        response: fullResponse,
        modifiedFiles: [],
        tokensUsed: totalUsage,
        toolCallCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // ──── Complex task → tool loop ────
    const repoMap = buildRepoMap(context.cwd);
    const systemPrompt = buildSystemPrompt(repoMap, context);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversation.getMessages(),
      { role: 'user', content: context.task },
    ];

    console.log(`\n${colors.cyan}${colors.bold}🤖 Agent working...${colors.reset}`);

    while (toolCallCount < MAX_TOOL_CALLS) {
      // Use non-streaming for tool calls (we need to parse tool_calls JSON)
      const result = await this.client.chat(messages, context.model, {
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      });

      totalUsage.prompt_tokens += result.usage.prompt_tokens;
      totalUsage.completion_tokens += result.usage.completion_tokens;
      totalUsage.total_tokens += result.usage.total_tokens;

      // No tool calls → stream final response
      if (!result.tool_calls || result.tool_calls.length === 0) {
        const response = result.content ?? '';

        // Print the response (already received in non-streaming mode)
        if (response) {
          console.log(`\n${response}`);
        }

        conversation.addTurn(context.task, response);

        return {
          success: true,
          response,
          modifiedFiles,
          tokensUsed: totalUsage,
          toolCallCount,
          durationMs: Date.now() - startTime,
        };
      }

      // Execute tool calls (same as non-streaming)
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content,
        tool_calls: result.tool_calls,
      };
      messages.push(assistantMsg);

      if (result.content) {
        console.log(`${colors.dim}${result.content}${colors.reset}`);
      }

      for (const toolCall of result.tool_calls) {
        let parsedArgs: Record<string, string>;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          parsedArgs = { error: 'Failed to parse tool arguments' };
        }

        const event = await executeTool(
          toolCall.function.name,
          parsedArgs,
          context.cwd,
          this.verbose,
        );

        if (event.isWrite && event.affectedPath) {
          if (!modifiedFiles.includes(event.affectedPath)) {
            modifiedFiles.push(event.affectedPath);
          }
        }

        let toolResult = event.result;
        if (toolResult.length > MAX_TOOL_RESULT_LENGTH) {
          toolResult =
            toolResult.slice(0, MAX_TOOL_RESULT_LENGTH) +
            `\n\n... (truncated, ${toolResult.length} total characters)`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });

        toolCallCount++;
      }
    }

    console.log(
      `${colors.yellow}⚠  Tool call limit reached (${MAX_TOOL_CALLS}).${colors.reset}`,
    );

    conversation.addTurn(
      context.task,
      `Task processed with ${toolCallCount} tool calls.`,
    );

    return {
      success: true,
      response: `Completed with ${toolCallCount} tool calls.`,
      modifiedFiles,
      tokensUsed: totalUsage,
      toolCallCount,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Stream a text-only response to the terminal.
   */
  private async streamResponse(
    messages: ChatMessage[],
    model: string,
    usage: TokenUsage,
  ): Promise<string> {
    let fullText = '';

    for await (const chunk of this.client.chatStream(messages, model)) {
      if (chunk.type === 'content' && chunk.content) {
        process.stdout.write(chunk.content);
        fullText += chunk.content;
      }
      if (chunk.type === 'done' && chunk.usage) {
        usage.prompt_tokens += chunk.usage.prompt_tokens;
        usage.completion_tokens += chunk.usage.completion_tokens;
        usage.total_tokens += chunk.usage.total_tokens;
      }
    }

    if (fullText) {
      process.stdout.write('\n');
    }

    return fullText;
  }

  /** Proxy health check passthrough. */
  async ping(): Promise<boolean> {
    return this.client.ping();
  }
}
