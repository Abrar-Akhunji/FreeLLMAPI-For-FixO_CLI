import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err.stack || err.message || err);

  if (res.headersSent) return next(err);

  const status = (err as any).status ?? 500;
  
  let message = err.message;
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal Server Error';
  }

  res.status(status).json({
    error: {
      message,
      type: err.name ?? 'server_error',
    },
  });
}
