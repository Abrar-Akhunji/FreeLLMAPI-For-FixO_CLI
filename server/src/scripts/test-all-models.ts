/**
 * Probe every enabled model with a minimal request to find broken model IDs.
 * Usage: npx tsx src/scripts/test-all-models.ts
 */
import { initDb, getGlobalModels, firestore } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';
import { getProvider } from '../providers/index.js';

async function run() {
  await initDb();
  const allModels = await getGlobalModels();
  const enabledModels = allModels.filter(m => m.enabled);

  // For each platform, find any active api key across any user
  const platformKeys: Record<string, { encrypted_key: string; iv: string; auth_tag: string }> = {};

  const usersSnapshot = await firestore.collection('users').get();
  for (const userDoc of usersSnapshot.docs) {
    const keysSnapshot = await userDoc.ref.collection('api_keys').where('enabled', '==', true).get();
    for (const keyDoc of keysSnapshot.docs) {
      const data = keyDoc.data();
      if (!platformKeys[data.platform]) {
        platformKeys[data.platform] = {
          encrypted_key: data.encrypted_key,
          iv: data.iv,
          auth_tag: data.auth_tag
        };
      }
    }
  }

  const results: any[] = [];
  for (const model of enabledModels) {
    const key = platformKeys[model.platform];
    if (!key) {
      results.push({ model, ok: false, ms: 0, error: 'no active key found for platform' });
      continue;
    }
    const apiKey = decrypt(key.encrypted_key, key.iv, key.auth_tag);
    const provider = getProvider(model.platform as any);
    if (!provider) {
      results.push({ model, ok: false, ms: 0, error: 'no provider' });
      continue;
    }

    const start = Date.now();
    try {
      const res = await provider.chatCompletion(apiKey, [{ role: 'user', content: 'hi' }], model.modelId, { max_tokens: 5 });
      const reply = res.choices?.[0]?.message?.content?.slice(0, 40) ?? '';
      results.push({ model, ok: true, ms: Date.now() - start, reply });
    } catch (err: any) {
      results.push({ model, ok: false, ms: Date.now() - start, error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  console.log('\n=== Results ===\n');
  const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
  for (const r of results) {
    const status = r.ok ? '✓' : '✗';
    console.log(`${status} ${pad(r.model.platform, 12)} ${pad(r.model.modelId, 52)} ${String(r.ms).padStart(5)}ms  ${r.ok ? `"${r.reply}"` : r.error}`);
  }
  const okCount = results.filter(r => r.ok).length;
  console.log(`\n${okCount}/${results.length} models working\n`);
  process.exit(0);
}

run().catch(console.error);
