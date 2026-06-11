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
      // Clear cache so the next request retries init instead of permanently
      // serving 500s from a poisoned container.
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    console.error('[api] initialization failed:', err);
    // Always include the error detail for init failures — these are
    // configuration problems (missing FIREBASE_SERVICE_ACCOUNT, bad
    // ENCRYPTION_KEY, etc.) that the operator needs to see to fix the
    // deployment. They are not data leaks.
    res.status(500).json({
      error: {
        message: 'Server initialization failed',
        code: err?.code ?? 'INIT_FAILED',
        detail: String(err?.message ?? err),
      },
    });
    return;
  }
  return app(req, res);
}
