import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getUserApiKeys, addUserApiKey, deleteUserApiKey, toggleUserApiKey } from '../db/index.js';
import { decrypt, maskKey } from '../lib/crypto.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { sanitizeParams } from '../middleware/sanitizeParams.js';

export const keysRouter = Router();

keysRouter.use(authMiddleware);

const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'zen', 'ollama-local'
] as const;

const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().min(1),
  label: z.string().transform(val => val.replace(/[<>]/g, '')).optional(),
});

// List all keys (masked)
keysRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const rows = await getUserApiKeys(uid);

    const keys = rows.map(row => {
      let maskedKey = '****';
      try {
        const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
        maskedKey = maskKey(realKey);
      } catch {
        maskedKey = '[decrypt failed]';
      }
      return {
        id: row.id,
        platform: row.platform,
        label: row.label,
        maskedKey,
        status: row.status,
        enabled: row.enabled,
        createdAt: row.createdAt,
        lastCheckedAt: row.lastCheckedAt,
      };
    });

    res.json(keys);
  } catch (error) {
    console.error('Error listing keys:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Add a key
keysRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const { platform, key, label } = parsed.data;
    const newKey = await addUserApiKey(uid, platform, key, label ?? '');

    res.status(201).json({
      id: newKey.id,
      platform,
      label: label ?? '',
      maskedKey: maskKey(key),
      status: 'unknown',
      enabled: true,
    });
  } catch (error) {
    console.error('Error adding key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Delete a key
keysRouter.delete('/:id', sanitizeParams, async (req: AuthenticatedRequest, res: Response) => {
  const keyId = req.params.id as string;
  if (!keyId) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const success = await deleteUserApiKey(uid, keyId);
    if (!success) {
      res.status(404).json({ error: { message: 'Key not found' } });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Toggle enable/disable
keysRouter.patch('/:id', sanitizeParams, async (req: AuthenticatedRequest, res: Response) => {
  const keyId = req.params.id as string;
  if (!keyId) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const success = await toggleUserApiKey(uid, keyId, enabled);
    if (!success) {
      res.status(404).json({ error: { message: 'Key not found' } });
      return;
    }
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error toggling key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
