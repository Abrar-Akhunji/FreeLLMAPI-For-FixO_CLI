import { Router } from 'express';
import type { Response } from 'express';
import { getGlobalModels, getUserFallbackConfig, getUserApiKeys } from '../db/index.js';
import { hasProvider } from '../providers/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const modelsRouter = Router();

modelsRouter.use(authMiddleware);

modelsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const globalModels = await getGlobalModels();
    const fallbackConfig = await getUserFallbackConfig(uid);
    const userKeys = await getUserApiKeys(uid);

    const fallbackMap = new Map(fallbackConfig.map(f => [f.modelDbId, f]));

    const keyCountMap = new Map<string, number>();
    for (const key of userKeys) {
      if (key.enabled) {
        keyCountMap.set(key.platform, (keyCountMap.get(key.platform) || 0) + 1);
      }
    }

    const result = globalModels.map(m => {
      const fb = fallbackMap.get(m.id);
      return {
        id: m.id,
        platform: m.platform,
        modelId: m.modelId,
        displayName: m.displayName,
        intelligenceRank: m.intelligenceRank,
        speedRank: m.speedRank,
        sizeLabel: m.sizeLabel,
        rpmLimit: m.rpmLimit,
        rpdLimit: m.rpdLimit,
        tpmLimit: m.tpmLimit,
        tpdLimit: m.tpdLimit,
        monthlyTokenBudget: m.monthlyTokenBudget,
        contextWindow: m.contextWindow,
        enabled: m.enabled,
        priority: fb ? fb.priority : m.intelligenceRank,
        fallbackEnabled: fb ? fb.enabled : m.enabled,
        hasProvider: hasProvider(m.platform as any),
        keyCount: keyCountMap.get(m.platform) ?? 0,
      };
    });

    result.sort((a, b) => a.priority - b.priority);

    res.json(result);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
