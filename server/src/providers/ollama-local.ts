import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform, ChatToolCall } from '@freellmapi/shared/types.js';
import { BaseProvider, CompletionOptions } from './base.js';
import { getSetting } from '../db/index.js';
import { ENV } from '../env.js';

export class OllamaLocalProvider extends BaseProvider {
  platform: Platform = 'ollama-local';
  name = 'Ollama Local';

  async validateKey(apiKey: string): Promise<boolean> {
    const baseUrl = getSetting('ollama_local_url') || ENV.OLLAMA_LOCAL_URL || 'http://localhost:11434';
    try {
      const res = await this.fetchWithTimeout(`${baseUrl}/api/tags`, {}, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  private buildPayload(messages: ChatMessage[], modelId: string, options?: CompletionOptions, stream = false) {
    const ollamaOptions: any = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.top_p !== undefined) ollamaOptions.top_p = options.top_p;
    if (options?.max_tokens !== undefined) ollamaOptions.num_predict = options.max_tokens;

    const payload: any = {
      model: modelId,
      messages: messages.map(m => {
        const msg: any = { role: m.role, content: m.content || '' };
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            function: {
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments || '{}')
            }
          }));
        }
        return msg;
      }),
      stream,
      options: ollamaOptions
    };

    if (options?.tools && options.tools.length > 0) {
      payload.tools = options.tools.map(t => t.function);
    }
    
    return payload;
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const baseUrl = getSetting('ollama_local_url') || ENV.OLLAMA_LOCAL_URL || 'http://localhost:11434';
    const payload = this.buildPayload(messages, modelId, options, false);

    const res = await this.fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 120000);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error: ${res.status} ${text}`);
    }

    const data = await res.json() as any;

    let tool_calls: ChatToolCall[] | undefined = undefined;
    if (data.message?.tool_calls) {
      tool_calls = data.message.tool_calls.map((tc: any, i: number) => ({
        id: `call_${Date.now()}_${i}`,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
        }
      }));
    }

    return {
      id: this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: data.message?.content || '',
          tool_calls
        },
        finish_reason: data.done_reason || 'stop'
      }],
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      }
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const baseUrl = getSetting('ollama_local_url') || ENV.OLLAMA_LOCAL_URL || 'http://localhost:11434';
    const payload = this.buildPayload(messages, modelId, options, true);

    const res = await this.fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 120000);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama stream error: ${res.status} ${text}`);
    }

    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const id = this.makeId();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          const data = JSON.parse(line);
          
          let tool_calls: ChatToolCall[] | undefined = undefined;
          if (data.message?.tool_calls) {
            tool_calls = data.message.tool_calls.map((tc: any, i: number) => ({
              id: `call_${Date.now()}_${i}`,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
              }
            }));
          }

          yield {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                content: data.message?.content || '',
                tool_calls
              },
              finish_reason: data.done ? (data.done_reason || 'stop') : null
            }]
          };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
