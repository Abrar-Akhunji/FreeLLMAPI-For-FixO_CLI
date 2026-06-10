import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getUserSettings, setUserSetting, getUnifiedApiKey, regenerateUnifiedKey } from '../db/index.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../middleware/authMiddleware.js';

export const settingsRouter = Router();

settingsRouter.use(authMiddleware);

// GET /api/settings/api-key
settingsRouter.get('/api-key', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const unifiedApiKey = await getUnifiedApiKey(uid);
    res.json({ apiKey: unifiedApiKey });
  } catch (error) {
    console.error('Error fetching unified API key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// POST /api/settings/api-key/regenerate
settingsRouter.post('/api-key/regenerate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const newKey = await regenerateUnifiedKey(uid);
    res.json({ success: true, key: newKey });
  } catch (error) {
    console.error('Error regenerating unified API key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// POST /api/settings/regenerate-key (for backward compatibility)
settingsRouter.post('/regenerate-key', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const newKey = await regenerateUnifiedKey(uid);
    res.json({ success: true, key: newKey });
  } catch (error) {
    console.error('Error regenerating unified API key:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
});

// GET /api/settings/global (and GET /api/settings)
const getSettingsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.user!.uid;
    const settings = await getUserSettings(uid);
    const unifiedApiKey = await getUnifiedApiKey(uid);

    res.json({
      unified_api_key: unifiedApiKey,
      smart_routing: settings.smart_routing || 'false',
      prompt_translation: settings.prompt_translation || 'false',
      ollama_local_enabled: settings.ollama_local_enabled || 'false',
      ollama_local_url: settings.ollama_local_url || 'http://localhost:11434',
      multi_tenant_auth: 'true'
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
};

settingsRouter.get('/', getSettingsHandler);
settingsRouter.get('/global', getSettingsHandler);

const updateSettingsSchema = z.object({
  smart_routing: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(val => val !== undefined ? String(val) : undefined),
  prompt_translation: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(val => val !== undefined ? String(val) : undefined),
  ollama_local_enabled: z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(val => val !== undefined ? String(val) : undefined),
  ollama_local_url: z.string().max(256).optional().transform(val => val?.replace(/[<>]/g, '')),
});

// PUT /api/settings/global, POST /api/settings/global, and POST /api/settings
const updateSettingsHandler = async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  try {
    const uid = req.user!.uid;
    const { smart_routing, prompt_translation, ollama_local_enabled, ollama_local_url } = parsed.data;

    if (smart_routing !== undefined) await setUserSetting(uid, 'smart_routing', smart_routing);
    if (prompt_translation !== undefined) await setUserSetting(uid, 'prompt_translation', prompt_translation);
    if (ollama_local_enabled !== undefined) await setUserSetting(uid, 'ollama_local_enabled', ollama_local_enabled);
    if (ollama_local_url !== undefined) await setUserSetting(uid, 'ollama_local_url', ollama_local_url);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: { message: 'Internal server error' } });
  }
};

settingsRouter.post('/', updateSettingsHandler);
settingsRouter.post('/global', updateSettingsHandler);
settingsRouter.put('/global', updateSettingsHandler);

