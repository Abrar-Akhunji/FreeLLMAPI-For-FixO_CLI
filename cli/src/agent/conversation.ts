/**
 * ConversationManager — manages multi-turn chat context for the FixO CLI agent.
 *
 * Keeps a rolling window of conversation history within a configurable token
 * budget.  Oldest turns are pruned automatically when the budget is exceeded,
 * but the two most-recent user/assistant pairs are always retained.
 */

import type { ChatMessage } from '@freellmapi/shared/types.js';

/** Default maximum token budget for conversation history. */
const DEFAULT_MAX_TOKEN_BUDGET = 28_000;

/** Minimum number of individual messages to keep (2 turn-pairs = 4 messages). */
const MIN_MESSAGES_TO_KEEP = 4;

export class ConversationManager {
  private history: ChatMessage[] = [];
  private maxTokenBudget: number;

  constructor(maxTokenBudget: number = DEFAULT_MAX_TOKEN_BUDGET) {
    this.maxTokenBudget = maxTokenBudget;
  }

  // ---------------------------------------------------------------------------
  // Token estimation
  // ---------------------------------------------------------------------------

  /**
   * Approximate token count for a piece of text.
   * Uses the common ~4-characters-per-token heuristic.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate tokens consumed by a single message, accounting for both its
   * `content` and any attached `tool_calls`.
   */
  private estimateMessageTokens(message: ChatMessage): number {
    const contentTokens = this.estimateTokens(message.content ?? '');
    const toolCallTokens = this.estimateTokens(
      JSON.stringify(message.tool_calls ?? []),
    );
    return contentTokens + toolCallTokens;
  }

  /**
   * Calculate the total estimated token count across the entire history.
   */
  private getTotalTokens(): number {
    return this.history.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      0,
    );
  }

  // ---------------------------------------------------------------------------
  // Mutation helpers
  // ---------------------------------------------------------------------------

  /**
   * Add a user message and the corresponding assistant response as a single
   * conversational turn, then prune if the budget is exceeded.
   */
  addTurn(userMessage: string, assistantResponse: string): void {
    this.history.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantResponse },
    );
    this.pruneToFitBudget();
  }

  /**
   * Add a raw {@link ChatMessage} (useful for tool-call results or other
   * non-standard messages), then prune if the budget is exceeded.
   */
  addMessage(message: ChatMessage): void {
    this.history.push(message);
    this.pruneToFitBudget();
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Return a shallow copy of all messages for injection into the LLM context. */
  getMessages(): ChatMessage[] {
    return [...this.history];
  }

  /** Number of complete user/assistant turn pairs in the history. */
  getTurnCount(): number {
    return Math.floor(this.history.length / 2);
  }

  // ---------------------------------------------------------------------------
  // Pruning
  // ---------------------------------------------------------------------------

  /**
   * Remove the oldest user/assistant pairs (indices 0 & 1) until the total
   * token estimate fits within {@link maxTokenBudget}.
   *
   * The two most-recent turn pairs ({@link MIN_MESSAGES_TO_KEEP} messages) are
   * **never** removed, even if they alone exceed the budget.
   */
  pruneToFitBudget(): void {
    while (
      this.getTotalTokens() > this.maxTokenBudget &&
      this.history.length > MIN_MESSAGES_TO_KEEP
    ) {
      // Remove the oldest pair (user + assistant) at indices 0,1.
      this.history.splice(0, 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Clear all conversation history. */
  clear(): void {
    this.history = [];
  }

  // ---------------------------------------------------------------------------
  // Serialisation — session persistence / recovery
  // ---------------------------------------------------------------------------

  /** Export a deep copy of the raw history for external persistence. */
  exportHistory(): ChatMessage[] {
    return this.history.map((msg) => ({ ...msg }));
  }

  /**
   * Import a previously-exported history, replacing the current one.
   * Automatically prunes to fit the current token budget after import.
   */
  importHistory(messages: ChatMessage[]): void {
    this.history = messages.map((msg) => ({ ...msg }));
    this.pruneToFitBudget();
  }
}
