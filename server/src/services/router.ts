import { getGlobalModels, getUserFallbackConfig, getUserApiKeys, getUserSetting } from '../db/index.js';
import { ENV } from '../env.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { canMakeRequest, canUseTokens, isOnCooldown } from './ratelimit.js';
import type { BaseProvider } from '../providers/base.js';

export interface RouteResult {
  provider: BaseProvider;
  modelId: string;
  modelDbId: string;
  apiKey: string;
  keyId: string;
  platform: string;
  displayName: string;
}

// Round-robin index per user-platform-model key
const roundRobinIndex = new Map<string, number>();

// Cache smart routing setting
let isSmartRoutingEnabled = true;

// ── Dynamic priority: track 429s per model and demote accordingly ──
const rateLimitPenalties = new Map<string, { count: number; lastHit: number; penalty: number }>();

const PENALTY_PER_429 = 3;
const MAX_PENALTY = 10;
const DECAY_INTERVAL_MS = 2 * 60 * 1000;
const DECAY_AMOUNT = 1;

export function recordRateLimitHit(modelDbId: string) {
  const existing = rateLimitPenalties.get(modelDbId);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastHit = now;
    existing.penalty = Math.min(existing.penalty + PENALTY_PER_429, MAX_PENALTY);
  } else {
    rateLimitPenalties.set(modelDbId, { count: 1, lastHit: now, penalty: PENALTY_PER_429 });
  }
}

export function recordSuccess(modelDbId: string) {
  const existing = rateLimitPenalties.get(modelDbId);
  if (existing) {
    existing.penalty = Math.max(0, existing.penalty - 1);
    if (existing.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
    }
  }
}

function getPenalty(modelDbId: string): number {
  const entry = rateLimitPenalties.get(modelDbId);
  if (!entry) return 0;

  const now = Date.now();
  const elapsed = now - entry.lastHit;
  const decaySteps = Math.floor(elapsed / DECAY_INTERVAL_MS);
  if (decaySteps > 0) {
    entry.penalty = Math.max(0, entry.penalty - (decaySteps * DECAY_AMOUNT));
    entry.lastHit = now;
    if (entry.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
      return 0;
    }
  }

  return entry.penalty;
}

export function getAllPenalties(): Array<{ modelDbId: string; count: number; penalty: number }> {
  const result: Array<{ modelDbId: string; count: number; penalty: number }> = [];
  for (const [modelDbId, entry] of rateLimitPenalties) {
    const penalty = getPenalty(modelDbId);
    if (penalty > 0) {
      result.push({ modelDbId, count: entry.count, penalty });
    }
  }
  return result.sort((a, b) => b.penalty - a.penalty);
}

function isToolCapable(platform: string, modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (platform === 'google' || id.includes('gemini')) return true;
  if (id.includes('gpt-4o') || id.includes('gpt-4.1') || id.includes('gpt-5')) return true;
  if (id.includes('gpt-oss')) return true;
  if (id.includes('llama-3.3') || id.includes('llama-v3p3') || id.includes('llama3.3')) return true;
  if (id.includes('llama-4') || id.includes('llama4')) return true;
  if (platform === 'mistral' && (id.includes('large') || id.includes('codestral') || id.includes('medium') || id.includes('devstral') || id.includes('magistral'))) return true;
  if (id.includes('deepseek-v3') || id.includes('deepseek/deepseek-v3') || id.includes('deepseek-v3.1') || id.includes('deepseek-v3.2')) return true;
  if (id.includes('qwen3-coder') || id.includes('qwen-3-coder')) return true;
  if (id.includes('qwen3') || id.includes('qwen-3')) return true;
  if (id.includes('minimax') || id.includes('m2.5') || id.includes('m2.7') || id.includes('m3-free')) return true;
  if (id.includes('kimi-k2') || id.includes('kimi_k2')) return true;
  if (id.includes('glm-4') || id.includes('glm4')) return true;
  if (id.includes('nemotron-3-super') || id.includes('nemotron-super')) return true;
  if (platform === 'sambanova' && (id.includes('deepseek') || id.includes('llama-4') || id.includes('gpt-oss'))) return true;
  if (platform === 'groq' && (id.includes('gpt-oss') || id.includes('compound'))) return true;
  if (platform === 'cloudflare' && (
    id.includes('llama-3.3') || id.includes('llama-4') ||
    id.includes('kimi-k2') || id.includes('gpt-oss') || id.includes('glm-4')
  )) return true;
  if (platform === 'cerebras' && id.includes('qwen')) return true;
  return false;
}

export async function routeRequest(
  uid: string,
  estimatedTokens = 1000,
  estimatedInputTokens = 0,
  skipKeys?: Set<string>,
  preferredModelDbId?: string,
  requiresTools?: boolean
): Promise<RouteResult> {
  const globalModels = await getGlobalModels();
  const fallbackConfig = await getUserFallbackConfig(uid);

  const modelMap = new Map(globalModels.map(m => [m.id, m]));

  const smartRoutingVal = await getUserSetting(uid, 'smart_routing');
  isSmartRoutingEnabled = (smartRoutingVal ?? ENV.SMART_ROUTING_ENABLED) === 'true';

  const sortedChain = fallbackConfig.map(entry => {
    let effectivePriority = entry.priority + getPenalty(entry.modelDbId);
    
    if (isSmartRoutingEnabled && !preferredModelDbId) {
      const model = modelMap.get(entry.modelDbId);
      if (model) {
        if (estimatedInputTokens < 500 && model.speedRank <= 5) {
          effectivePriority -= 50;
        } else if (estimatedInputTokens > 5000 && model.intelligenceRank <= 10) {
          effectivePriority -= 50;
        }
      }
    }
    
    return { ...entry, effectivePriority };
  }).sort((a, b) => a.effectivePriority - b.effectivePriority);

  if (preferredModelDbId) {
    const idx = sortedChain.findIndex(e => e.modelDbId === preferredModelDbId);
    if (idx > 0) {
      const [preferred] = sortedChain.splice(idx, 1);
      sortedChain.unshift(preferred);
    }
  }

  const userKeys = await getUserApiKeys(uid);

  for (const entry of sortedChain) {
    if (!entry.enabled) continue;

    const model = modelMap.get(entry.modelDbId);
    if (!model || !model.enabled) continue;

    if (model.contextWindow && estimatedInputTokens > model.contextWindow * 0.9) {
      continue;
    }

    if (requiresTools && !isToolCapable(model.platform, model.modelId)) {
      continue;
    }

    const provider = getProvider(model.platform as any);
    if (!provider) continue;

    const platformKeys = userKeys.filter(k => k.platform === model.platform && k.enabled && k.status !== 'invalid');
    if (platformKeys.length === 0) continue;

    const limits = {
      rpm: model.rpmLimit,
      rpd: model.rpdLimit,
      tpm: model.tpmLimit,
      tpd: model.tpdLimit,
    };

    const rrKey = `${uid}:${model.platform}:${model.modelId}`;
    let idx = roundRobinIndex.get(rrKey) ?? 0;

    for (let attempt = 0; attempt < platformKeys.length; attempt++) {
      const key = platformKeys[idx % platformKeys.length];
      idx++;

      const skipId = `${model.platform}:${model.modelId}:${key.id}`;
      if (skipKeys?.has(skipId)) continue;

      if (isOnCooldown(model.platform, model.modelId, key.id)) continue;

      if (!canMakeRequest(model.platform, model.modelId, key.id, limits)) continue;
      if (!canUseTokens(model.platform, model.modelId, key.id, estimatedTokens, limits)) continue;

      roundRobinIndex.set(rrKey, idx);
      const decryptedKey = decrypt(key.encrypted_key, key.iv, key.auth_tag);

      return {
        provider,
        modelId: model.modelId,
        modelDbId: model.id,
        apiKey: decryptedKey,
        keyId: key.id,
        platform: model.platform,
        displayName: model.displayName,
      };
    }

    roundRobinIndex.set(rrKey, idx);
  }

  const err = new Error('All models exhausted. Add more API keys or wait for rate limits to reset.') as any;
  err.status = 429;
  throw err;
}
