import type { Request, Response, NextFunction } from 'express';

/**
 * Middleware to sanitize and validate route parameters (req.params)
 * against path traversal and Firestore subcollection/document injection.
 */
export function sanitizeParams(req: Request, res: Response, next: NextFunction): void {
  for (const [key, val] of Object.entries(req.params)) {
    if (typeof val === 'string') {
      // Check for path traversal segments, slash separators, or reserved metadata prefixes
      const hasTraversal = 
        val.includes('/') || 
        val.includes('\\') || 
        val === '.' || 
        val.includes('..') || 
        val.startsWith('__');
        
      if (hasTraversal) {
        res.status(400).json({
          error: {
            message: `Invalid request: parameter '${key}' contains unsafe characters.`,
            type: 'invalid_request_error'
          }
        });
        return;
      }
    }
  }
  next();
}
