import { firestore } from '../lib/firebaseAdmin.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { getUserApiKeys, updateUserApiKeyStatus, toggleUserApiKey } from '../db/index.js';
import type { Platform, KeyStatus } from '@freellmapi/shared/types.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

// Track consecutive failures per key: "uid_keyId" -> count
const failureCount = new Map<string, number>();

export async function checkKeyHealth(uid: string, keyId: string): Promise<KeyStatus> {
  try {
    const doc = await firestore.collection('users').doc(uid).collection('api_keys').doc(keyId).get();
    if (!doc.exists) return 'error';
    const row = doc.data() as any;

    const provider = getProvider(row.platform as Platform);
    if (!provider) return 'error';

    const apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
    const isValid = await provider.validateKey(apiKey);

    const status: KeyStatus = isValid ? 'healthy' : 'invalid';
    await updateUserApiKeyStatus(uid, keyId, status);

    const failureKey = `${uid}_${keyId}`;
    if (isValid) {
      failureCount.delete(failureKey);
    } else {
      const count = (failureCount.get(failureKey) ?? 0) + 1;
      failureCount.set(failureKey, count);

      if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
        await toggleUserApiKey(uid, keyId, false);
        console.log(`[Health] Auto-disabled key ${keyId} for user ${uid} after ${count} consecutive failures`);
      }
    }

    return status;
  } catch (err: any) {
    console.error(`[Health] Key ${keyId} transport error for user ${uid}:`, err.message);
    await updateUserApiKeyStatus(uid, keyId, 'error');
    return 'error';
  }
}

export async function checkAllKeys(): Promise<void> {
  console.log('[Health] Fetching all users to check keys...');
  const usersSnapshot = await firestore.collection('users').get();
  
  let checkedCount = 0;
  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const keys = await getUserApiKeys(uid);
    const enabledKeys = keys.filter(k => k.enabled);

    for (const key of enabledKeys) {
      await checkKeyHealth(uid, key.id);
      checkedCount++;
    }
  }

  console.log(`[Health] Check complete. Validated ${checkedCount} keys.`);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(): void {
  if (intervalId) return;
  console.log(`[Health] Starting health checker (every ${CHECK_INTERVAL_MS / 1000}s)`);
  intervalId = setInterval(() => {
    checkAllKeys().catch(err => console.error('[Health] Check failed:', err));
  }, CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
