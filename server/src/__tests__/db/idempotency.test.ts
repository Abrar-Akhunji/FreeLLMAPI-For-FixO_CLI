import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getGlobalModels } from '../../db/index.js';
import { hasProvider } from '../../providers/index.js';
import { firestore } from '../../lib/firebaseAdmin.js';

describe('Migration idempotency (Firestore Catalog)', () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    if ('data' in firestore) {
      (firestore as any).data = {};
    }
    await initDb();
  });

  it('initDb seeds global models idempotently', async () => {
    const modelsBefore = await getGlobalModels();
    expect(modelsBefore.length).toBeGreaterThan(0);

    // Run initDb again - should not duplicate or change count
    await initDb();

    const modelsAfter = await getGlobalModels();
    expect(modelsAfter.length).toBe(modelsBefore.length);
  });

  it('UNIQUE(platform, model_id) constraint holds — no duplicate catalog rows', async () => {
    const models = await getGlobalModels();
    const seen = new Set<string>();
    const dups: string[] = [];

    for (const m of models) {
      const key = `${m.platform}:${m.modelId}`;
      if (seen.has(key)) {
        dups.push(key);
      } else {
        seen.add(key);
      }
    }

    expect(dups).toEqual([]);
  });

  it('all enabled catalog platforms have a registered provider', async () => {
    const models = await getGlobalModels();
    const enabledPlatforms = Array.from(new Set(models.filter(m => m.enabled).map(m => m.platform)));

    const missing = enabledPlatforms.filter(p => !hasProvider(p as any));
    expect(missing).toEqual([]);
  });
});
