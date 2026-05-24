import type { ChatMessage, Platform } from '@freellmapi/shared/types.js';
import type { CompletionOptions } from '../providers/base.js';
import { getSetting } from '../db/index.js';
import { ENV } from '../env.js';

export function translatePrompt(
  messages: ChatMessage[],
  platform: Platform,
  modelId: string,
  contextWindow: number | null,
  estimatedInputTokens: number,
  options: CompletionOptions,
): { messages: ChatMessage[]; options: CompletionOptions } {
  const isEnabled = (getSetting('prompt_translation') ?? ENV.PROMPT_TRANSLATION_ENABLED) === 'true';
  
  if (!isEnabled) {
    return { messages, options };
  }

  let translatedMessages = [...messages];
  let translatedOptions = { ...options };

  // 1. Max-token clamping
  if (contextWindow && translatedOptions.max_tokens) {
    const headroom = contextWindow - estimatedInputTokens - 100;
    if (headroom < translatedOptions.max_tokens) {
      translatedOptions.max_tokens = Math.max(1, headroom);
    }
  }

  // 2. System role handling for models that don't support system well
  const needsSystemMerge = platform === 'cohere' || (platform === 'cloudflare' && modelId.includes('llama-3'));
  if (needsSystemMerge) {
    const systemMsgs = translatedMessages.filter(m => m.role === 'system');
    if (systemMsgs.length > 0) {
      const combinedSystem = systemMsgs.map(m => m.content).join('\n\n');
      const firstUserIdx = translatedMessages.findIndex(m => m.role === 'user');
      if (firstUserIdx >= 0) {
        translatedMessages[firstUserIdx] = {
          ...translatedMessages[firstUserIdx],
          content: `[System Instructions]\n${combinedSystem}\n\n[User Message]\n${translatedMessages[firstUserIdx].content}`
        };
      } else {
        translatedMessages.push({ role: 'user', content: `[System Instructions]\n${combinedSystem}` });
      }
      translatedMessages = translatedMessages.filter(m => m.role !== 'system');
    }
  }

  // 3. Thinking tag management
  const isReasoningModel = modelId.toLowerCase().includes('r1') || modelId.toLowerCase().includes('reasoning') || modelId.toLowerCase().includes('think');
  
  let toolCallCounter = 1;

  translatedMessages = translatedMessages.map(msg => {
    let newMsg = { ...msg };

    if (newMsg.role === 'assistant' && newMsg.content) {
      if (!isReasoningModel) {
        // Strip out thinking tags to avoid confusing non-reasoning models
        newMsg.content = newMsg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }
    }

    // 4. Tool call ID backfill (some providers drop it)
    if (newMsg.role === 'assistant' && newMsg.tool_calls) {
      newMsg.tool_calls = newMsg.tool_calls.map(tc => {
        if (!tc.id) {
          tc = { ...tc, id: `call_${Date.now()}_${toolCallCounter++}` };
        }
        return tc;
      });
    }

    return newMsg;
  });

  return { messages: translatedMessages, options: translatedOptions };
}
