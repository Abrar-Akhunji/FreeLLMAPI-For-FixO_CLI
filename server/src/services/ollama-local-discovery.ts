import { getDb, getSetting } from '../db/index.js';
import { ENV } from '../env.js';

export async function discoverOllamaModels() {
  const isEnabled = (getSetting('ollama_local_enabled') ?? ENV.OLLAMA_LOCAL_ENABLED) === 'true';
  const db = getDb();

  if (!isEnabled) {
    db.prepare("UPDATE models SET enabled = 0 WHERE platform = 'ollama-local'").run();
    return;
  }

  const baseUrl = getSetting('ollama_local_url') || ENV.OLLAMA_LOCAL_URL || 'http://localhost:11434';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Not OK');

    const data = await res.json() as any;
    const models = data.models || [];

    const existingModels = db.prepare("SELECT model_id FROM models WHERE platform = 'ollama-local'").all() as { model_id: string }[];
    const existingSet = new Set(existingModels.map(m => m.model_id));

    const insertModel = db.prepare(`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, enabled)
      VALUES ('ollama-local', ?, ?, 50, 5, 'Local', 'Unlimited', 1)
    `);
    const updateModel = db.prepare("UPDATE models SET enabled = 1 WHERE platform = 'ollama-local' AND model_id = ?");

    db.transaction(() => {
      // First disable all local models, then re-enable the ones we find
      db.prepare("UPDATE models SET enabled = 0 WHERE platform = 'ollama-local'").run();

      for (const m of models) {
        if (existingSet.has(m.name)) {
          updateModel.run(m.name);
        } else {
          insertModel.run(m.name, m.name + ' (Local)');
        }
      }
      
      const missingFb = db.prepare(`
        SELECT m.id FROM models m
        LEFT JOIN fallback_config f ON m.id = f.model_db_id
        WHERE m.platform = 'ollama-local' AND f.id IS NULL
      `).all() as { id: number }[];

      if (missingFb.length > 0) {
        const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get() as { mx: number }).mx;
        const addFb = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
        for (let i = 0; i < missingFb.length; i++) {
          addFb.run(missingFb[i].id, maxPriority + i + 1);
        }
      }
    })();

  } catch (err) {
    db.prepare("UPDATE models SET enabled = 0 WHERE platform = 'ollama-local'").run();
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startOllamaDiscovery() {
  if (intervalId) return;
  discoverOllamaModels().catch(console.error);
  intervalId = setInterval(() => {
    discoverOllamaModels().catch(console.error);
  }, 5 * 60 * 1000); // 5 minutes
}
