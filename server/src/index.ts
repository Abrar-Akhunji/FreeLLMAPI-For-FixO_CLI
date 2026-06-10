import './env.js';
import { createApp } from './app.js';
import { initDb } from './db/index.js';
import { startHealthChecker } from './services/health.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT ?? 3001;

async function main() {
  await initDb();
  const app = createApp();

  const server = app.listen(Number(PORT), '0.0.0.0', () => {
    logger.info('server started', { port: Number(PORT), env: process.env.NODE_ENV ?? 'development' });
    logger.info('proxy endpoint ready', { url: `http://0.0.0.0:${PORT}/v1/chat/completions` });
    startHealthChecker();
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => {
      logger.warn('force exit after shutdown timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { error: err.message, stack: err.stack });
  });
}

main().catch((err) => {
  logger.error('fatal startup error', { error: err?.message, stack: err?.stack });
  process.exit(1);
});
