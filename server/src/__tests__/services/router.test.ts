import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getGlobalModels, firestore } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { routeRequest } from '../../services/router.js';

async function setupApiKey(platform: string, key: string, status = 'healthy', enabled = true) {
  const { encrypted, iv, authTag } = encrypt(key);
  const docRef = firestore.collection('users').doc('test-user-uid').collection('api_keys').doc();
  await docRef.set({
    platform,
    label: 'test',
    encrypted_key: encrypted,
    iv,
    auth_tag: authTag,
    status,
    enabled,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null
  });
}

async function setFallbackPriorities(priorities: { platform: string, priority: number }[]) {
  const models = await getGlobalModels();
  const chain = models.map(m => {
    const override = priorities.find(p => p.platform === m.platform);
    return {
      modelDbId: m.id,
      priority: override ? override.priority : m.intelligenceRank,
      enabled: m.enabled
    };
  });
  await firestore.collection('users').doc('test-user-uid').collection('fallback_config').doc('default').set({ chain });
}

describe('Router', () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    await initDb();
  });

  beforeEach(async () => {
    if ('data' in firestore) {
      const keys = Object.keys((firestore as any).data);
      for (const k of keys) {
        if (!k.startsWith('global_models/')) {
          delete (firestore as any).data[k];
        }
      }
    }
    // Disable smart routing for test user
    const { setUserSetting } = await import('../../db/index.js');
    await setUserSetting('test-user-uid', 'smart_routing', 'false');
  });

  it('should throw when no keys are configured', async () => {
    await expect(routeRequest('test-user-uid')).rejects.toThrow(/exhausted/i);
  });

  it('should route to highest priority model with available key', async () => {
    await setupApiKey('groq', 'test-groq-key');
    const result = await routeRequest('test-user-uid');
    expect(result.platform).toBe('groq');
    expect(result.apiKey).toBe('test-groq-key');
  });

  it('should prefer higher-priority model when keys exist for multiple platforms', async () => {
    await setupApiKey('google', 'test-google-key');
    await setupApiKey('groq', 'test-groq-key');

    // Default intelligence ranks: Google (e.g. gemini-2.5-flash / gemini-2.5-pro) wins over groq
    const result = await routeRequest('test-user-uid');
    expect(result.platform).toBe('google');
  });

  it('should skip disabled keys', async () => {
    await setupApiKey('google', 'test-google-key', 'healthy', false);
    await setupApiKey('groq', 'test-groq-key');

    const result = await routeRequest('test-user-uid');
    expect(result.platform).toBe('groq');
  });

  it('should skip invalid keys', async () => {
    await setupApiKey('google', 'invalid-key', 'invalid');
    await setupApiKey('groq', 'test-groq-key');

    const result = await routeRequest('test-user-uid');
    expect(result.platform).toBe('groq');
  });

  it('should skip non-tool-capable models when requiresTools is true', async () => {
    await setupApiKey('cohere', 'test-cohere-key');
    await setupApiKey('groq', 'test-groq-key');

    // Give cohere higher priority
    await setFallbackPriorities([
      { platform: 'cohere', priority: 1 },
      { platform: 'groq', priority: 2 }
    ]);

    // Without requiresTools, Cohere should be routed
    const normalResult = await routeRequest('test-user-uid');
    expect(normalResult.platform).toBe('cohere');

    // With requiresTools, Cohere should be skipped and Groq selected
    const toolResult = await routeRequest('test-user-uid', 1000, 0, undefined, undefined, true);
    expect(toolResult.platform).toBe('groq');
  });
});
