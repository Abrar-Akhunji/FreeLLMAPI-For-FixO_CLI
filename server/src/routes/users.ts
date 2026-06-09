import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getUserClientKeys, createClientKey, deleteClientKey } from '../db/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { sanitizeParams } from '../middleware/sanitizeParams.js';

export const usersRouter = Router();

usersRouter.use(authMiddleware);

const userKeySchema = z.object({
  name: z.string().min(1).transform(val => val.replace(/[<>]/g, '')),
  role: z.enum(['admin', 'member']).default('member'),
  daily_quota: z.number().nullable().default(null)
});

usersRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const clientKeys = await getUserClientKeys(uid);
    res.json(clientKeys);
  } catch (error) {
    console.error('Error fetching client keys:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

usersRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = userKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  
  try {
    const uid = req.user!.uid;
    const { rawKey, keyPrefix } = await createClientKey(uid, parsed.data.name, parsed.data.daily_quota);
    
    const clientKeys = await getUserClientKeys(uid);
    const createdKey = clientKeys.find(k => k.keyPrefix === keyPrefix);

    res.status(201).json({
      id: createdKey ? createdKey.id : '',
      name: parsed.data.name,
      role: parsed.data.role,
      daily_quota: parsed.data.daily_quota,
      key: rawKey
    });
  } catch (err: any) {
    console.error('Error creating client key:', err);
    res.status(500).json({ error: { message: 'Failed to create client key' } });
  }
});

usersRouter.delete('/:id', sanitizeParams, async (req: AuthenticatedRequest, res: Response) => {
  const keyId = req.params.id as string;
  if (!keyId) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }
  try {
    const uid = req.user!.uid;
    const success = await deleteClientKey(uid, keyId);
    if (!success) {
      res.status(404).json({ error: { message: 'Client key not found' } });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting client key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
