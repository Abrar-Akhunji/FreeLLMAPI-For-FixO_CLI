import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getModelAliases, createModelAlias, deleteModelAlias } from '../db/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { sanitizeParams } from '../middleware/sanitizeParams.js';

export const aliasesRouter = Router();

aliasesRouter.use(authMiddleware);

const aliasSchema = z.object({
  alias: z.string().min(1).transform(val => val.replace(/[<>]/g, '')),
  targetModelDbId: z.string().nullable(),
});

aliasesRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const aliases = await getModelAliases(uid);
    res.json(aliases);
  } catch (error) {
    console.error('Error fetching aliases:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

aliasesRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = aliasSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  try {
    const uid = req.user!.uid;
    const id = await createModelAlias(uid, parsed.data.alias, parsed.data.targetModelDbId);
    res.status(201).json({ id, ...parsed.data });
  } catch (err: any) {
    if (err.message?.includes('already exists')) {
      res.status(400).json({ error: { message: 'Alias already exists' } });
    } else {
      console.error('Error creating alias:', err);
      res.status(500).json({ error: { message: 'Failed to create alias' } });
    }
  }
});

aliasesRouter.delete('/:id', sanitizeParams, async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params.id as string;
  if (!id) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }
  try {
    const uid = req.user!.uid;
    const success = await deleteModelAlias(uid, id);
    if (!success) {
      res.status(404).json({ error: { message: 'Alias not found' } });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting alias:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
