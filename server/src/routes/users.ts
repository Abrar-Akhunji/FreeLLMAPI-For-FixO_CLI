import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getUserKeys, createUserKey, deleteUserKey, getUnifiedApiKey } from '../db/index.js';
import crypto from 'crypto';

export const usersRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !crypto.timingSafeEqual(Buffer.from(token.padEnd(64)), Buffer.from(getUnifiedApiKey().padEnd(64)))) {
    res.status(401).json({ error: { message: 'Admin key required' } });
    return;
  }
  next();
}

usersRouter.use(requireAdmin);

const userKeySchema = z.object({
  name: z.string().min(1),
  role: z.enum(['admin', 'member']).default('member'),
  daily_quota: z.number().nullable().default(null)
});

usersRouter.get('/', (req: Request, res: Response) => {
  res.json(getUserKeys());
});

usersRouter.post('/', (req: Request, res: Response) => {
  const parsed = userKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  
  try {
    const { id, rawKey } = createUserKey(parsed.data.name, parsed.data.daily_quota);
    res.status(201).json({ id, name: parsed.data.name, role: parsed.data.role, daily_quota: parsed.data.daily_quota, key: rawKey });
  } catch (err: any) {
    res.status(500).json({ error: { message: 'Failed to create user key' } });
  }
});

usersRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }
  const result = deleteUserKey(id);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'User not found' } });
    return;
  }
  res.json({ success: true });
});
