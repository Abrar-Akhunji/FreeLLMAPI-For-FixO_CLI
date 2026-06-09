import crypto from 'crypto';
import { firestore } from './firebaseAdmin.js';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;

function parseHexKey(value: string, source: 'env' | 'db'): Buffer {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

/**
 * Initialize encryption key from env, Firestore, or generate a new one.
 * Must be called after Firebase Admin is initialized.
 */
export async function initEncryptionKey(): Promise<void> {
  // 1. Check env var
  const envKey = process.env.ENCRYPTION_KEY;
  
  if (process.env.NODE_ENV === 'production') {
    if (!envKey || envKey === 'your-64-char-hex-key-here') {
      throw new Error(
        'ENCRYPTION_KEY must be configured in production environment. ' +
        'Please generate a secure 64-character hex key (32 bytes) and set it in your environment variables.'
      );
    }
    cachedKey = parseHexKey(envKey, 'env');
    return;
  }

  if (envKey && envKey !== 'your-64-char-hex-key-here') {
    cachedKey = parseHexKey(envKey, 'env');
    return;
  }

  // 2. Check Firestore for persisted key
  const globalSettingsRef = firestore.collection('global_settings').doc('encryption');
  const doc = await globalSettingsRef.get();
  if (doc.exists) {
    const data = doc.data();
    if (data && data.value) {
      cachedKey = parseHexKey(data.value, 'db');
      return;
    }
  }

  // 3. Generate and persist
  cachedKey = crypto.randomBytes(KEY_BYTES);
  await globalSettingsRef.set({ value: cachedKey.toString('hex') });
}

function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    throw new Error('Encryption key not initialized. Call initEncryptionKey() first.');
  }
  return cachedKey;
}

export function encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
