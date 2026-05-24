import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getModelAliases, createModelAlias, deleteModelAlias, getUnifiedApiKey } from '../db/index.js';
import crypto from 'crypto';

export const aliasesRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !crypto.timingSafeEqual(Buffer.from(token.padEnd(64)), Buffer.from(getUnifiedApiKey().padEnd(64)))) {
    res.status(401).json({ error: { message: 'Admin key required' } });
    return;
  }
  next();
}

aliasesRouter.use(requireAdmin);

const aliasSchema = z.object({
  alias: z.string().min(1),
  targetModelDbId: z.number().nullable(),
});

aliasesRouter.get('/', (req: Request, res: Response) => {
  res.json(getModelAliases());
});

aliasesRouter.post('/', (req: Request, res: Response) => {
  const parsed = aliasSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const id = createModelAlias(parsed.data.alias, parsed.data.targetModelDbId);
    res.status(201).json({ id, ...parsed.data });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      res.status(400).json({ error: { message: 'Alias already exists' } });
    } else {
      res.status(500).json({ error: { message: 'Failed to create alias' } });
    }
  }
});

aliasesRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }
  const result = deleteModelAlias(id);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Alias not found' } });
    return;
  }
  res.json({ success: true });
});
