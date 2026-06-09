import { Router } from 'express';
import type { Response } from 'express';
import { getUserRequests, getGlobalModels } from '../db/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

function getSinceTimestamp(range: string): string {
  const now = Date.now();
  switch (range) {
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case '7d':
    default:
      return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
}

// Summary stats
analyticsRouter.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);

    const totalRequests = requests.length;
    const successCount = requests.filter(r => r.status === 'success').length;
    const successRate = totalRequests > 0 ? (successCount / totalRequests) * 100 : 0;
    
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalLatency = 0;

    for (const r of requests) {
      totalInputTokens += r.inputTokens || 0;
      totalOutputTokens += r.outputTokens || 0;
      totalLatency += r.latencyMs || 0;
    }

    const avgLatencyMs = totalRequests > 0 ? totalLatency / totalRequests : 0;
    const inputCost = (totalInputTokens / 1_000_000) * 3;
    const outputCost = (totalOutputTokens / 1_000_000) * 15;

    res.json({
      totalRequests,
      successRate: Math.round(successRate * 10) / 10,
      totalInputTokens,
      totalOutputTokens,
      avgLatencyMs: Math.round(avgLatencyMs),
      estimatedCostSavings: Math.round((inputCost + outputCost) * 100) / 100,
    });
  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Stats grouped by model
analyticsRouter.get('/by-model', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);
    const globalModels = await getGlobalModels();

    const modelMap = new Map(globalModels.map(m => [`${m.platform}_${m.modelId}`, m.displayName]));

    const groups: Record<string, {
      platform: string;
      modelId: string;
      displayName: string;
      requests: number;
      successCount: number;
      totalLatency: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }> = {};

    for (const r of requests) {
      const key = `${r.platform}_${r.modelId}`;
      if (!groups[key]) {
        groups[key] = {
          platform: r.platform,
          modelId: r.modelId,
          displayName: modelMap.get(key) || r.modelId,
          requests: 0,
          successCount: 0,
          totalLatency: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
        };
      }
      const g = groups[key];
      g.requests++;
      if (r.status === 'success') g.successCount++;
      g.totalLatency += r.latencyMs || 0;
      g.totalInputTokens += r.inputTokens || 0;
      g.totalOutputTokens += r.outputTokens || 0;
    }

    const rows = Object.values(groups).map(g => ({
      platform: g.platform,
      modelId: g.modelId,
      displayName: g.displayName,
      requests: g.requests,
      successRate: Math.round((g.successCount / g.requests) * 100 * 10) / 10,
      avgLatencyMs: Math.round(g.totalLatency / g.requests),
      totalInputTokens: g.totalInputTokens,
      totalOutputTokens: g.totalOutputTokens,
    }));

    rows.sort((a, b) => b.requests - a.requests);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching analytics by-model:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Stats grouped by platform
analyticsRouter.get('/by-platform', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);

    const groups: Record<string, {
      platform: string;
      requests: number;
      successCount: number;
      totalLatency: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    }> = {};

    for (const r of requests) {
      const p = r.platform;
      if (!groups[p]) {
        groups[p] = {
          platform: p,
          requests: 0,
          successCount: 0,
          totalLatency: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
        };
      }
      const g = groups[p];
      g.requests++;
      if (r.status === 'success') g.successCount++;
      g.totalLatency += r.latencyMs || 0;
      g.totalInputTokens += r.inputTokens || 0;
      g.totalOutputTokens += r.outputTokens || 0;
    }

    const rows = Object.values(groups).map(g => ({
      platform: g.platform,
      requests: g.requests,
      successRate: Math.round((g.successCount / g.requests) * 100 * 10) / 10,
      avgLatencyMs: Math.round(g.totalLatency / g.requests),
      totalInputTokens: g.totalInputTokens,
      totalOutputTokens: g.totalOutputTokens,
    }));

    rows.sort((a, b) => b.requests - a.requests);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching analytics by-platform:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Timeline data
analyticsRouter.get('/timeline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const interval = (req.query.interval as string) ?? (range === '24h' ? 'hour' : 'day');
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);

    const formatTimestamp = (isoString: string) => {
      const date = new Date(isoString);
      if (interval === 'hour') {
        // Formats to YYYY-MM-DDTHH:00:00
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00:00`;
      } else {
        // Formats to YYYY-MM-DD
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }
    };

    const groups: Record<string, {
      timestamp: string;
      requests: number;
      successCount: number;
      failureCount: number;
    }> = {};

    for (const r of requests) {
      const ts = formatTimestamp(r.createdAt);
      if (!groups[ts]) {
        groups[ts] = {
          timestamp: ts,
          requests: 0,
          successCount: 0,
          failureCount: 0,
        };
      }
      const g = groups[ts];
      g.requests++;
      if (r.status === 'success') g.successCount++;
      else if (r.status === 'error') g.failureCount++;
    }

    const rows = Object.values(groups);
    rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    res.json(rows);
  } catch (error) {
    console.error('Error fetching analytics timeline:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Helper to categorize errors
function getErrorCategory(error: string): string {
  const err = error.toLowerCase();
  if (err.includes('429') || err.includes('rate limit') || err.includes('too many') || err.includes('quota')) {
    return 'Rate Limited (429)';
  }
  if (err.includes('401') || err.includes('unauthorized') || err.includes('invalid') || err.includes('key')) {
    return 'Auth Error (401)';
  }
  if (err.includes('403') || err.includes('forbidden')) {
    return 'Forbidden (403)';
  }
  if (err.includes('404') || err.includes('not found')) {
    return 'Not Found (404)';
  }
  if (err.includes('timeout') || err.includes('etimedout') || err.includes('econnrefused')) {
    return 'Timeout/Connection';
  }
  if (err.includes('500') || err.includes('internal server')) {
    return 'Server Error (500)';
  }
  if (err.includes('503') || err.includes('unavailable')) {
    return 'Unavailable (503)';
  }
  return 'Other';
}

// Error distribution
analyticsRouter.get('/error-distribution', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);
    const errors = requests.filter(r => r.status === 'error');

    const byDetailed: Record<string, {
      platform: string;
      modelId: string;
      error_category: string;
      count: number;
    }> = {};

    const byCat: Record<string, {
      category: string;
      count: number;
    }> = {};

    const byPlat: Record<string, {
      platform: string;
      count: number;
    }> = {};

    for (const r of errors) {
      const errorMsg = r.error || '';
      const category = getErrorCategory(errorMsg);
      const detailedKey = `${r.platform}_${category}`;

      // Detailed
      if (!byDetailed[detailedKey]) {
        byDetailed[detailedKey] = {
          platform: r.platform,
          modelId: r.modelId,
          error_category: category,
          count: 0
        };
      }
      byDetailed[detailedKey].count++;

      // By Category
      if (!byCat[category]) {
        byCat[category] = { category, count: 0 };
      }
      byCat[category].count++;

      // By Platform
      if (!byPlat[r.platform]) {
        byPlat[r.platform] = { platform: r.platform, count: 0 };
      }
      byPlat[r.platform].count++;
    }

    const detailedRows = Object.values(byDetailed).sort((a, b) => b.count - a.count);
    const catRows = Object.values(byCat).sort((a, b) => b.count - a.count);
    const platRows = Object.values(byPlat).sort((a, b) => b.count - a.count);

    res.json({
      byCategory: catRows,
      byPlatform: platRows,
      detailed: detailedRows,
    });
  } catch (error) {
    console.error('Error fetching error distribution:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// Recent errors (limit 50)
analyticsRouter.get('/errors', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const range = (req.query.range as string) ?? '7d';
    const since = getSinceTimestamp(range);

    const requests = await getUserRequests(uid, since);
    const errors = requests.filter(r => r.status === 'error');

    // Sort descending by createdAt
    errors.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const result = errors.slice(0, 50).map(r => ({
      id: r.id,
      platform: r.platform,
      modelId: r.modelId,
      error: r.error,
      latencyMs: r.latencyMs,
      createdAt: r.createdAt,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching recent errors:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});
