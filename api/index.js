import { createApp } from '../server/dist/app.js';
import { initDb } from '../server/dist/db/index.js';

// Vercel reuses the same container across warm invocations.
// Cache the initialized Express app + the DB-init promise so we only pay
// the cold-start cost once per container.
let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await initDb();
      // serveStatic: false → static assets are served directly by Vercel
      // from /dist; this function only handles /api/* and /v1/*.
      return createApp({ serveStatic: false });
    })().catch((err) => {
      // On failure, clear the cache so the next request retries init
      // instead of permanently serving 500s from a poisoned container.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('[api] initialization failed:', err);
    res.status(500).json({
      error: {
        message: 'Server initialization failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message ?? err),
      },
    });
  }
}
