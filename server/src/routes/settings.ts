import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getUnifiedApiKey, regenerateUnifiedKey, getSetting, setSetting } from '../db/index.js';
import crypto from 'crypto';

export const settingsRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !crypto.timingSafeEqual(Buffer.from(token.padEnd(64)), Buffer.from(getUnifiedApiKey().padEnd(64)))) {
    res.status(401).json({ error: { message: 'Admin key required' } });
    return;
  }
  next();
}

// Get the unified API key
settingsRouter.get('/api-key', (_req: Request, res: Response) => {
  res.json({ apiKey: getUnifiedApiKey() });
});

// Regenerate the unified API key
settingsRouter.post('/api-key/regenerate', (_req: Request, res: Response) => {
  const newKey = regenerateUnifiedKey();
  res.json({ apiKey: newKey });
});

// Get global settings
settingsRouter.get('/global', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    smart_routing: getSetting('smart_routing') || 'false',
    prompt_translation: getSetting('prompt_translation') || 'false',
    ollama_local_enabled: getSetting('ollama_local_enabled') || 'false',
    ollama_local_url: getSetting('ollama_local_url') || 'http://localhost:11434',
    multi_tenant_auth: getSetting('multi_tenant_auth') || 'false'
  });
});

// Update global settings
settingsRouter.put('/global', requireAdmin, (req: Request, res: Response) => {
  const { smart_routing, prompt_translation, ollama_local_enabled, ollama_local_url, multi_tenant_auth } = req.body;
  if (smart_routing !== undefined) setSetting('smart_routing', String(smart_routing));
  if (prompt_translation !== undefined) setSetting('prompt_translation', String(prompt_translation));
  if (ollama_local_enabled !== undefined) setSetting('ollama_local_enabled', String(ollama_local_enabled));
  if (ollama_local_url !== undefined) setSetting('ollama_local_url', String(ollama_local_url));
  if (multi_tenant_auth !== undefined) setSetting('multi_tenant_auth', String(multi_tenant_auth));
  res.json({ success: true });
});
