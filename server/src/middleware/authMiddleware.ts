import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebaseAdmin.js';
import { ensureUser, lookupUserByUnifiedApiKey } from '../db/index.js';
import { logger } from '../lib/logger.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { message: 'Unauthorized: Missing or invalid token format' } });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  // Check if Bearer token is a unified API key
  if (idToken.startsWith('freellmapi-unified-')) {
    try {
      const user = await lookupUserByUnifiedApiKey(idToken);
      if (!user) {
        res.status(401).json({ error: { message: 'Unauthorized: Invalid unified API key' } });
        return;
      }
      (req as AuthenticatedRequest).user = {
        uid: user.uid,
        email: user.email,
      };
      next();
      return;
    } catch (error: any) {
      logger.error('unified api key verification failed', { error: error?.message });
      res.status(500).json({ error: { message: 'Internal server error' } });
      return;
    }
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email || '';
    const displayName = (decodedToken.name as string) || '';
    const photoUrl = (decodedToken.picture as string) || '';

    await ensureUser(uid, email, displayName, photoUrl);

    (req as AuthenticatedRequest).user = {
      uid,
      email,
    };
    next();
  } catch (error: any) {
    logger.warn('firebase id token verification failed', { error: error?.message });
    res.status(401).json({ error: { message: 'Unauthorized: Invalid token' } });
  }
}


