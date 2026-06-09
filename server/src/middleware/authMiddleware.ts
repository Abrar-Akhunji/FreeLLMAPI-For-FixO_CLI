import type { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebaseAdmin.js';
import { ensureUser } from '../db/index.js';

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
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    res.status(401).json({ error: { message: 'Unauthorized: Invalid token' } });
  }
}

