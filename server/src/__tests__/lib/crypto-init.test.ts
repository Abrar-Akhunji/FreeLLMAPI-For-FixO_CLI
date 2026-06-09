import { describe, it, expect, beforeEach } from 'vitest';
import { initEncryptionKey, encrypt, decrypt } from '../../lib/crypto.js';
import { firestore } from '../../lib/firebaseAdmin.js';

describe('initEncryptionKey — input validation', () => {
  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    // Clear mock firestore data
    if ('data' in firestore) {
      (firestore as any).data = {};
    }
  });

  it('accepts a valid 64-char hex env key', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    await expect(initEncryptionKey()).resolves.not.toThrow();
    // Round-trip a value to confirm the key actually works.
    const enc = encrypt('hello');
    expect(decrypt(enc.encrypted, enc.iv, enc.authTag)).toBe('hello');
  });

  it('throws on too-short env key (typo guard)', async () => {
    process.env.ENCRYPTION_KEY = 'abc';
    await expect(initEncryptionKey()).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\).+expected 64 hex chars/);
  });

  it('throws on too-long env key', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(80);
    await expect(initEncryptionKey()).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\)/);
  });

  it('throws on non-hex env key of correct length', async () => {
    process.env.ENCRYPTION_KEY = 'g'.repeat(64); // g is not hex
    await expect(initEncryptionKey()).rejects.toThrow(/Invalid ENCRYPTION_KEY \(env\)/);
  });

  it('still treats the placeholder as "not set" and falls through to DB / generation', async () => {
    process.env.ENCRYPTION_KEY = 'your-64-char-hex-key-here';
    await expect(initEncryptionKey()).resolves.not.toThrow();
    // Fell through to generation — DB now has a key.
    const row = (firestore as any).data['global_settings/docs/encryption'];
    expect(row).toBeDefined();
    expect(row.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws on a corrupted DB-stored key', async () => {
    (firestore as any).data['global_settings/docs/encryption'] = { value: 'not-hex' };
    await expect(initEncryptionKey()).rejects.toThrow(/Invalid ENCRYPTION_KEY \(db\)/);
  });

  it('generates a fresh key on a virgin DB and persists it', async () => {
    await initEncryptionKey();
    const row = (firestore as any).data['global_settings/docs/encryption'];
    expect(row).toBeDefined();
    expect(row.value).toMatch(/^[0-9a-f]{64}$/);
  });
});
