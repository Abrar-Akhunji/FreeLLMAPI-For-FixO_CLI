import { firestore } from '../lib/firebaseAdmin.js';
import { ENV } from '../env.js';

export async function discoverOllamaModels() {
  const settingsRef = firestore.collection('global_settings').doc('ollama');
  const settingsDoc = await settingsRef.get();
  
  let isEnabled = ENV.OLLAMA_LOCAL_ENABLED === 'true';
  let baseUrl = ENV.OLLAMA_LOCAL_URL || 'http://localhost:11434';

  if (settingsDoc.exists) {
    const data = settingsDoc.data();
    if (data) {
      if (data.enabled !== undefined) isEnabled = data.enabled === 'true' || data.enabled === true;
      if (data.url) baseUrl = data.url;
    }
  }

  const modelsColl = firestore.collection('global_models');

  if (!isEnabled) {
    // Disable all local ollama models in global catalog
    const snapshot = await modelsColl.where('platform', '==', 'ollama-local').get();
    if (!snapshot.empty) {
      const batch = firestore.batch();
      for (const doc of snapshot.docs) {
        batch.update(doc.ref, { enabled: false });
      }
      await batch.commit();
    }
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('Ollama connection not OK');

    const data = await res.json() as any;
    const models = data.models || [];

    // Fetch existing local models
    const snapshot = await modelsColl.where('platform', '==', 'ollama-local').get();
    const existingMap = new Map(snapshot.docs.map((doc: any) => {
      const d = doc.data();
      return [d.modelId, doc.id];
    }));

    const batch = firestore.batch();
    
    // First disable all existing local models in batch
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { enabled: false });
    }

    // Insert or enable the discovered ones
    for (const m of models) {
      const modelId = m.name;
      const existingId = existingMap.get(modelId);
      if (existingId) {
        batch.update(modelsColl.doc(existingId), { enabled: true });
      } else {
        const id = `ollama-local_${modelId.replace(/\//g, '_')}`;
        const newModel = {
          id,
          platform: 'ollama-local',
          modelId,
          displayName: `${modelId} (Local)`,
          intelligenceRank: 50,
          speedRank: 5,
          sizeLabel: 'Local',
          rpmLimit: null,
          rpdLimit: null,
          tpmLimit: null,
          tpdLimit: null,
          monthlyTokenBudget: 'Unlimited',
          contextWindow: 8192,
          enabled: true
        };
        batch.set(modelsColl.doc(id), newModel);
      }
    }
    
    await batch.commit();

  } catch (err) {
    console.error('[Ollama Discovery] Error scanning local Ollama:', err);
    // Disable all local ollama models on failure
    const snapshot = await modelsColl.where('platform', '==', 'ollama-local').get();
    if (!snapshot.empty) {
      const batch = firestore.batch();
      for (const doc of snapshot.docs) {
        batch.update(doc.ref, { enabled: false });
      }
      await batch.commit();
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;

export function startOllamaDiscovery() {
  if (intervalId) return;
  console.log('[Ollama Discovery] Starting local discovery service...');
  discoverOllamaModels().catch(console.error);
  intervalId = setInterval(() => {
    discoverOllamaModels().catch(console.error);
  }, 5 * 60 * 1000); // 5 minutes
}

export function stopOllamaDiscovery() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
