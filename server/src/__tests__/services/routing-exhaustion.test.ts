import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { routeRequest } from '../../services/router.js';
import * as ratelimit from '../../services/ratelimit.js';
import { initDb, firestore } from '../../db/index.js';

// Mock ratelimit to control quota availability
vi.mock('../../services/ratelimit.js', async () => {
  const actual = await vi.importActual('../../services/ratelimit.js');
  return {
    ...actual,
    canMakeRequest: vi.fn(),
    canUseTokens: vi.fn(),
    isOnCooldown: vi.fn(() => false),
  };
});

// Mock crypto to avoid IV errors
vi.mock('../../lib/crypto.js', async () => {
  const actual = await vi.importActual('../../lib/crypto.js');
  return {
    ...actual,
    decrypt: vi.fn(() => 'mocked-api-key'),
  };
});

describe('Routing Key Exhaustion', () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    await initDb();
  });

  beforeEach(async () => {
    if ('data' in firestore) {
      (firestore as any).data = {};
    }

    const proModel = {
      id: 'google_gemini-1.5-pro',
      platform: 'google',
      modelId: 'gemini-1.5-pro',
      displayName: 'Pro',
      intelligenceRank: 1,
      speedRank: 1,
      enabled: true,
      contextWindow: 128000
    };
    const flashModel = {
      id: 'google_gemini-1.5-flash',
      platform: 'google',
      modelId: 'gemini-1.5-flash',
      displayName: 'Flash',
      intelligenceRank: 2,
      speedRank: 2,
      enabled: true,
      contextWindow: 128000
    };

    await firestore.collection('global_models').doc(proModel.id).set(proModel);
    await firestore.collection('global_models').doc(flashModel.id).set(flashModel);

    await firestore.collection('users').doc('test-user-uid').collection('fallback_config').doc('config').set({
      chain: [
        { modelDbId: proModel.id, priority: 1, enabled: true },
        { modelDbId: flashModel.id, priority: 2, enabled: true }
      ]
    });

    await firestore.collection('users').doc('test-user-uid').collection('api_keys').doc('key-a-id').set({
      platform: 'google', label: 'Key A', encrypted_key: 'enc', iv: 'iv', auth_tag: 'tag', status: 'healthy', enabled: true
    });
    await firestore.collection('users').doc('test-user-uid').collection('api_keys').doc('key-b-id').set({
      platform: 'google', label: 'Key B', encrypted_key: 'enc', iv: 'iv', auth_tag: 'tag', status: 'healthy', enabled: true
    });

    vi.clearAllMocks();
  });

  it('should skip exhausted Key B and use functional Key A for the same high-priority model', async () => {
    const keyAId = 'key-a-id';
    const keyBId = 'key-b-id';

    (ratelimit.canMakeRequest as any).mockImplementation((platform: string, modelId: string, keyId: string) => {
      if (keyId === keyBId) return false;
      if (keyId === keyAId) return true;
      return true;
    });
    (ratelimit.canUseTokens as any).mockReturnValue(true);

    const result = await routeRequest('test-user-uid', 100);

    expect(result.modelId).toBe('gemini-1.5-pro');
    expect(result.keyId).toBe(keyAId);
    expect(ratelimit.canMakeRequest).toHaveBeenCalled();
  });

  it('should throw 429 when every key on every model is exhausted', async () => {
    (ratelimit.canMakeRequest as any).mockReturnValue(false);
    await expect(routeRequest('test-user-uid', 100)).rejects.toThrow(/All models exhausted/);
  });

  it('should fall back to Flash when Pro is exhausted but Flash has quota', async () => {
    (ratelimit.canMakeRequest as any).mockImplementation((platform: string, modelId: string) => {
      if (modelId === 'gemini-1.5-pro') return false;
      if (modelId === 'gemini-1.5-flash') return true;
      return true;
    });
    (ratelimit.canUseTokens as any).mockReturnValue(true);

    const result = await routeRequest('test-user-uid', 100);
    expect(result.modelId).toBe('gemini-1.5-flash');
  });
});
