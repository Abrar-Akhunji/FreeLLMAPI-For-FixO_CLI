/**
 * HTTP client for the FreeLLMAPI proxy server.
 * Supports both regular and streaming (SSE) chat completions.
 * Includes retry with exponential backoff for transient errors.
 */
import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatToolDefinition,
  ChatToolChoice,
  TokenUsage,
} from '@freellmapi/shared/types.js';

/* ──────────────────────── Constants ──────────────────────── */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1500;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503]);
const BASE_URL = process.env.FIXO_API_URL || 'https://api.your-freellmapi-website.com/v1';

const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

/* ──────────────────────── Interfaces ──────────────────────── */

export interface ChatOptions {
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResult {
  content: string | null;
  tool_calls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> | null;
  usage: TokenUsage;
  model: string;
  finish_reason: string | null;
}

export interface StreamChunk {
  type: 'content' | 'tool_call_start' | 'tool_call_delta' | 'done';
  content?: string;
  tool_call?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  };
  usage?: TokenUsage;
  model?: string;
  finish_reason?: string | null;
}

/* ──────────────────────── AgentClient ──────────────────────── */

export class AgentClient {
  private baseUrl: string;
  private apiKey: string;
  private verbose: boolean;

  constructor(apiKey: string, apiUrl?: string, verbose = false) {
    this.baseUrl = process.env.FIXO_API_URL || apiUrl || BASE_URL;
    this.apiKey = apiKey;
    this.verbose = verbose;
  }

  /* ─── Non-streaming chat ─── */

  async chat(
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const hasTools = options.tools && Array.isArray(options.tools) && options.tools.length > 0;
    const bodyObj: Record<string, any> = {
      model,
      messages,
      stream: false,
      ...options,
    };
    if (hasTools) {
      bodyObj.x_requires_tools = true;
    }
    const body = JSON.stringify(bodyObj);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        };
        if (hasTools) {
          headers['X-Requires-Tools'] = 'true';
        }
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body,
        });

        // Non-retryable errors
        if (response.status === 413) {
          throw new Error(
            `Context too large (413). Reduce pinned files or use a model with a larger context window.`,
          );
        }
        if (response.status === 404) {
          throw new Error(
            `Model not found (404). Try a different model with /model <name>.`,
          );
        }

        // Retryable errors
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
          if (attempt < MAX_RETRIES) {
            console.log(
              `${colors.yellow}⚠  [API] Error ${response.status}. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})${colors.reset}`,
            );
            await sleep(delayMs);
            continue;
          }
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as ChatCompletionResponse;
        const choice = data.choices[0];

        return {
          content: choice?.message?.content ?? null,
          tool_calls: choice?.message?.tool_calls ?? null,
          usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          model: data.model,
          finish_reason: choice?.finish_reason ?? null,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry non-retryable errors
        if (
          lastError.message.includes('413') ||
          lastError.message.includes('404')
        ) {
          throw lastError;
        }

        // Retry network errors
        const isNetworkError =
          lastError.message.includes('ECONNREFUSED') ||
          lastError.message.includes('ECONNRESET') ||
          lastError.message.includes('fetch failed') ||
          lastError.message.includes('ETIMEDOUT');

        if (isNetworkError && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(
            `${colors.yellow}⚠  [Network] ${lastError.message.slice(0, 60)}. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})${colors.reset}`,
          );
          await sleep(delayMs);
          continue;
        }

        if (attempt >= MAX_RETRIES) break;
        if (!isNetworkError) throw lastError;
      }
    }

    throw lastError ?? new Error('All retry attempts exhausted.');
  }

  /* ─── Streaming chat (SSE) ─── */

  async *chatStream(
    messages: ChatMessage[],
    model: string,
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk> {
    const hasTools = options.tools && Array.isArray(options.tools) && options.tools.length > 0;
    const bodyObj: Record<string, any> = {
      model,
      messages,
      stream: true,
      ...options,
    };
    if (hasTools) {
      bodyObj.x_requires_tools = true;
    }
    const body = JSON.stringify(bodyObj);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        };
        if (hasTools) {
          headers['X-Requires-Tools'] = 'true';
        }
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body,
        });

        if (response.status === 413) {
          throw new Error(
            `Context too large (413). Reduce pinned files or use a model with a larger context window.`,
          );
        }
        if (response.status === 404) {
          throw new Error(
            `Model not found (404). Try a different model with /model <name>.`,
          );
        }

        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
          if (attempt < MAX_RETRIES) {
            console.log(
              `${colors.yellow}⚠  [API] Error ${response.status}. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})${colors.reset}`,
            );
            await sleep(delayMs);
            continue;
          }
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`API error (${response.status}): ${errorText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null — streaming not supported.');
        }

        // Parse SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let accumulatedModel = model;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === ':') continue; // Skip comments and empty lines

            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);

            if (data === '[DONE]') {
              yield {
                type: 'done',
                usage: accumulatedUsage,
                model: accumulatedModel,
              };
              return;
            }

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              if (chunk.model) accumulatedModel = chunk.model;
              if ((chunk as any).usage) {
                accumulatedUsage = (chunk as any).usage;
              }

              const choice = chunk.choices?.[0];
              if (!choice) continue;

              // Content delta
              if (choice.delta?.content) {
                yield {
                  type: 'content',
                  content: choice.delta.content,
                };
              }

              // Tool call deltas
              if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const idx = (tc as any).index ?? 0;
                  if (tc.id) {
                    yield {
                      type: 'tool_call_start',
                      tool_call: {
                        index: idx,
                        id: tc.id,
                        function: {
                          name: tc.function?.name ?? '',
                          arguments: tc.function?.arguments ?? '',
                        },
                      },
                    };
                  } else {
                    yield {
                      type: 'tool_call_delta',
                      tool_call: {
                        index: idx,
                        function: {
                          arguments: tc.function?.arguments ?? '',
                        },
                      },
                    };
                  }
                }
              }

              // Finish reason
              if (choice.finish_reason) {
                yield {
                  type: 'done',
                  finish_reason: choice.finish_reason,
                  usage: accumulatedUsage,
                  model: accumulatedModel,
                };
              }
            } catch {
              // Skip malformed JSON chunks
              if (this.verbose) {
                console.log(`${colors.gray}[stream] Skipped malformed chunk: ${data.slice(0, 80)}${colors.reset}`);
              }
            }
          }
        }

        // Stream ended without [DONE]
        yield {
          type: 'done',
          usage: accumulatedUsage,
          model: accumulatedModel,
        };
        return; // Success — don't retry
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          lastError.message.includes('413') ||
          lastError.message.includes('404')
        ) {
          throw lastError;
        }

        const isNetworkError =
          lastError.message.includes('ECONNREFUSED') ||
          lastError.message.includes('ECONNRESET') ||
          lastError.message.includes('fetch failed') ||
          lastError.message.includes('ETIMEDOUT');

        if (isNetworkError && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
          console.log(
            `${colors.yellow}⚠  [Network] ${lastError.message.slice(0, 60)}. Retrying in ${(delayMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})${colors.reset}`,
          );
          await sleep(delayMs);
          continue;
        }

        if (attempt >= MAX_RETRIES) break;
        if (!isNetworkError) throw lastError;
      }
    }

    throw lastError ?? new Error('All streaming retry attempts exhausted.');
  }

  /* ─── Health probe ─── */

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(4000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/* ──────────────────────── Helpers ──────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
