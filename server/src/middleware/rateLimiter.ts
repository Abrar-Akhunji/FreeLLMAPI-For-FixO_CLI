import type { Request, Response, NextFunction } from 'express';

interface RequestLog {
  timestamps: number[];
}

const ipRequests = new Map<string, RequestLog>();
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const WINDOW_MS = 60 * 1000; // 1 minute window

// Periodic cleanup of inactive IPs to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, log] of ipRequests.entries()) {
    log.timestamps = log.timestamps.filter(ts => now - ts < WINDOW_MS);
    if (log.timestamps.length === 0) {
      ipRequests.delete(ip);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Creates an IP-based sliding-window rate limiter middleware.
 * Supports reverse proxies by parsing x-forwarded-for first.
 *
 * @param limit Maximum allowed requests per minute
 * @param endpointName The name of the endpoint for clean error logs
 */
export function createIpRateLimiter(limit: number, endpointName: string = 'endpoint') {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Read IP address (Support reverse proxy headers like Cloudflare or Hostinger Nginx)
    const rawIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown';
    // Use first IP if multiple are passed in the header
    const ip = rawIp.split(',')[0].trim();

    const now = Date.now();
    let log = ipRequests.get(ip);
    if (!log) {
      log = { timestamps: [] };
      ipRequests.set(ip, log);
    }

    // Filter to only keep requests within the sliding window
    log.timestamps = log.timestamps.filter(ts => now - ts < WINDOW_MS);

    if (log.timestamps.length >= limit) {
      console.warn(`[Rate Limit] IP ${ip} blocked on '${endpointName}' (exceeded ${limit} req/min)`);
      res.status(429).json({
        error: {
          message: `Rate limit exceeded. You are allowed up to ${limit} requests per minute on this ${endpointName}.`,
          type: 'rate_limit_error',
        }
      });
      return;
    }

    log.timestamps.push(now);
    next();
  };
}
