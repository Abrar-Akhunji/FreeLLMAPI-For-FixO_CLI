import { Router } from 'express';
import type { Response } from 'express';
import { getUserApiKeys } from '../db/index.js';
import { checkKeyHealth } from '../services/health.js';
import { hasProvider } from '../providers/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { sanitizeParams } from '../middleware/sanitizeParams.js';

export const healthRouter = Router();

healthRouter.use(authMiddleware);

// Get health status for all platforms
healthRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const keys = await getUserApiKeys(uid);

    const platformStats: Record<string, {
      platform: string;
      totalKeys: number;
      healthyKeys: number;
      rateLimitedKeys: number;
      invalidKeys: number;
      errorKeys: number;
      unknownKeys: number;
      enabledKeys: number;
    }> = {};

    for (const k of keys) {
      const p = k.platform;
      if (!platformStats[p]) {
        platformStats[p] = {
          platform: p,
          totalKeys: 0,
          healthyKeys: 0,
          rateLimitedKeys: 0,
          invalidKeys: 0,
          errorKeys: 0,
          unknownKeys: 0,
          enabledKeys: 0
        };
      }
      const stats = platformStats[p];
      stats.totalKeys++;
      if (k.enabled) stats.enabledKeys++;
      if (k.status === 'healthy') stats.healthyKeys++;
      else if (k.status === 'rate_limited') stats.rateLimitedKeys++;
      else if (k.status === 'invalid') stats.invalidKeys++;
      else if (k.status === 'error') stats.errorKeys++;
      else if (k.status === 'unknown') stats.unknownKeys++;
    }

    res.json({
      platforms: Object.values(platformStats).map(p => ({
        platform: p.platform,
        hasProvider: hasProvider(p.platform as any),
        totalKeys: p.totalKeys,
        healthyKeys: p.healthyKeys,
        rateLimitedKeys: p.rateLimitedKeys,
        invalidKeys: p.invalidKeys,
        errorKeys: p.errorKeys,
        unknownKeys: p.unknownKeys,
        enabledKeys: p.enabledKeys,
      })),
      keys: keys.map(k => ({
        id: k.id,
        platform: k.platform,
        label: k.label,
        status: k.status,
        enabled: k.enabled,
        createdAt: k.createdAt,
        lastCheckedAt: k.lastCheckedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching health status:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Check a specific key
healthRouter.post('/check/:keyId', sanitizeParams, async (req: AuthenticatedRequest, res: Response) => {
  const keyId = req.params.keyId as string;
  if (!keyId) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const status = await checkKeyHealth(uid, keyId);
    res.json({ keyId, status });
  } catch (error) {
    console.error('Error checking key health:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Check all keys
healthRouter.post('/check-all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const keys = await getUserApiKeys(uid);
    const enabledKeys = keys.filter(k => k.enabled);

    for (const key of enabledKeys) {
      await checkKeyHealth(uid, key.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error checking all keys health:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
