import { createApp } from '../server/dist/app.js';
import { initDb } from '../server/dist/db/index.js';

let isDbInitialized = false;

const app = createApp();

// Add a middleware to ensure DB is initialized before handling requests
app.use(async (req, res, next) => {
  if (!isDbInitialized) {
    try {
      await initDb();
      isDbInitialized = true;
    } catch (err) {
      console.error('Failed to initialize database:', err);
      res.status(500).json({ error: { message: 'Database initialization failed: ' + err.message } });
      return;
    }
  }
  next();
});

export default app;
