import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getGlobalModels, getUserFallbackConfig, updateUserFallbackConfig, getUserApiKeys, getUserRequests } from '../db/index.js';
import { getAllPenalties } from '../services/router.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const fallbackRouter = Router();

fallbackRouter.use(authMiddleware);

// Get fallback chain (with dynamic penalties)
fallbackRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const globalModels = await getGlobalModels();
    const fallbackConfig = await getUserFallbackConfig(uid);
    const userKeys = await getUserApiKeys(uid);

    const keyCountMap = new Map<string, number>();
    for (const key of userKeys) {
      if (key.enabled) {
        keyCountMap.set(key.platform, (keyCountMap.get(key.platform) || 0) + 1);
      }
    }

    const penalties = getAllPenalties();
    const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

    const modelMap = new Map(globalModels.map(m => [m.id, m]));

    const result = fallbackConfig.map(f => {
      const m = modelMap.get(f.modelDbId);
      const penalty = penaltyMap.get(f.modelDbId);

      return {
        modelDbId: f.modelDbId,
        priority: f.priority,
        effectivePriority: f.priority + (penalty?.penalty ?? 0),
        penalty: penalty?.penalty ?? 0,
        rateLimitHits: penalty?.count ?? 0,
        enabled: f.enabled,
        platform: m ? m.platform : 'unknown',
        modelId: m ? m.modelId : 'unknown',
        displayName: m ? m.displayName : 'unknown',
        intelligenceRank: m ? m.intelligenceRank : 99,
        speedRank: m ? m.speedRank : 99,
        sizeLabel: m ? m.sizeLabel : 'unknown',
        rpmLimit: m ? m.rpmLimit : null,
        rpdLimit: m ? m.rpdLimit : null,
        monthlyTokenBudget: m ? m.monthlyTokenBudget : 'unknown',
        keyCount: m ? (keyCountMap.get(m.platform) ?? 0) : 0,
      };
    });

    result.sort((a, b) => a.priority - b.priority);
    res.json(result);
  } catch (error) {
    console.error('Error fetching fallback config:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

const updateSchema = z.array(z.object({
  modelDbId: z.string(),
  priority: z.number(),
  enabled: z.boolean(),
}));

// Update fallback chain (full replace)
fallbackRouter.put('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  try {
    const uid = req.user!.uid;
    await updateUserFallbackConfig(uid, parsed.data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating fallback config:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

const SORT_PRESETS: Record<string, string> = {
  intelligence: 'intelligenceRank',
  speed: 'speedRank',
};

// Sort preset
fallbackRouter.post('/sort/:preset', async (req: AuthenticatedRequest, res: Response) => {
  const preset = String(req.params.preset);
  const sortKey = SORT_PRESETS[preset];
  if (!sortKey && preset !== 'budget') {
    res.status(400).json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const globalModels = await getGlobalModels();

    if (preset === 'budget') {
      const budgetOrder = (s: string) => {
        switch (s) {
          case '~120M': return 1;
          case '~50-100M': return 2;
          case '~30M': return 3;
          case '~18-45M': return 4;
          case '~18M': return 5;
          case '~15M': return 6;
          case '~12M': return 7;
          case '~6M': return 8;
          case '~5-10M': return 9;
          case '~4M': return 10;
          default: return 11;
        }
      };
      globalModels.sort((a, b) => budgetOrder(a.monthlyTokenBudget) - budgetOrder(b.monthlyTokenBudget));
    } else {
      globalModels.sort((a, b) => {
        const valA = (a as any)[sortKey] ?? 99;
        const valB = (b as any)[sortKey] ?? 99;
        return valA - valB;
      });
    }

    const newChain = globalModels.map((m, index) => ({
      modelDbId: m.id,
      priority: index + 1,
      enabled: m.enabled
    }));

    await updateUserFallbackConfig(uid, newChain);
    res.json({ success: true, preset });
  } catch (error) {
    console.error('Error sorting fallback config:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Token usage per model for the stacked bar
fallbackRouter.get('/token-usage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const globalModels = await getGlobalModels();
    const fallbackConfig = await getUserFallbackConfig(uid);
    const userKeys = await getUserApiKeys(uid);

    const platformSet = new Set(userKeys.filter(k => k.enabled).map(k => k.platform));

    const fallbackMap = new Map(fallbackConfig.map(f => [f.modelDbId, f]));
    const enabledModels = globalModels.filter(m => m.enabled && fallbackMap.get(m.id)?.enabled);

    function parseBudget(s: string): number {
      const m = s.match(/~?([\d.]+)(?:-([\d.]+))?([MK])?/);
      if (!m) return 0;
      const high = parseFloat(m[2] ?? m[1]);
      const unit = m[3] === 'M' ? 1_000_000 : m[3] === 'K' ? 1_000 : 1;
      return high * unit;
    }

    const modelBudgets = enabledModels
      .filter(m => platformSet.has(m.platform))
      .map(m => ({
        displayName: m.displayName,
        platform: m.platform,
        budget: parseBudget(m.monthlyTokenBudget),
      }));

    const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const requests = await getUserRequests(uid, startOfMonth.toISOString());
    const totalUsed = requests.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);

    res.json({
      totalBudget,
      totalUsed,
      models: modelBudgets,
    });
  } catch (error) {
    console.error('Error getting token usage:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
