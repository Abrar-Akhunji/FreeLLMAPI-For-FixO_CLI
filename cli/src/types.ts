/**
 * CLI-specific type definitions extending the shared types.
 */
import type { ChatMessage, ChatToolDefinition } from '@freellmapi/shared/types.js';

/** Runtime context for a single agent invocation. */
export interface AgentContext {
  /** The user's task or prompt. */
  task: string;
  /** Target LLM model ID (or "auto" for smart routing). */
  model: string;
  /** Working directory for file operations. */
  cwd: string;
  /** Whether to print verbose API debug logs. */
  verbose: boolean;
  /** Pinned/selected files for context focus. */
  selectedFiles: string[];
  /** Project-level system prompt override (from .freellmapi.yml). */
  systemPromptOverride?: string;
  /** Custom build/test verification command. */
  checkCommand?: string;
}

/** Result of a single agent run. */
export interface AgentResult {
  /** Whether the task was completed successfully. */
  success: boolean;
  /** Text response to display to the user. */
  response: string;
  /** List of files that were modified during this run. */
  modifiedFiles: string[];
  /** Total token usage for this run. */
  tokensUsed: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Number of tool calls made during this run. */
  toolCallCount: number;
  /** Duration in milliseconds. */
  durationMs: number;
}

/** Project-level configuration from .freellmapi.yml */
export interface ProjectConfig {
  model?: string;
  checkCommand?: string;
  autoCommit?: boolean;
  systemPrompt?: string;
  include?: string[];
  exclude?: string[];
}
