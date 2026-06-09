import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { firestore } from '../../lib/firebaseAdmin.js';

async function request(app: Express, method: string, path: string, body?: any, ipHeader?: string) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer test-token',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(ipHeader ? { 'x-forwarded-for': ipHeader } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('Security Hardening & Sanitization', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    await initDb();
    app = createApp();
  });

  beforeEach(() => {
    if ('data' in firestore) {
      const keys = Object.keys((firestore as any).data);
      for (const k of keys) {
        if (!k.startsWith('global_models/')) {
          delete (firestore as any).data[k];
        }
      }
    }
  });

  describe('Path Traversal Sanitization', () => {
    it('rejects route parameters containing slashes (/) with HTTP 400', async () => {
      // Trying path traversal on keys DELETE /:id
      const res = await request(app, 'DELETE', '/api/keys/some%2Ftraversal%2Fpath');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("unsafe characters");
    });

    it('rejects route parameters containing dot segments (..) with HTTP 400', async () => {
      const res = await request(app, 'DELETE', '/api/keys/some%2E%2Epath');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("unsafe characters");
    });

    it('rejects route parameters starting with reserved __ prefix with HTTP 400', async () => {
      const res = await request(app, 'DELETE', '/api/keys/__reserved__');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("unsafe characters");
    });
  });

  describe('XSS Input Sanitization via Zod Transforms', () => {
    it('strips < and > characters from alias inputs to prevent XSS script tag injection', async () => {
      const payload = {
        alias: '<script>alert("xss")</script>my-model-alias',
        targetModelDbId: 'google_gemini-2.5-flash',
      };

      const res = await request(app, 'POST', '/api/model-aliases', payload);
      expect(res.status).toBe(201);
      expect(res.body.alias).not.toContain('<');
      expect(res.body.alias).not.toContain('>');
      expect(res.body.alias).toBe('scriptalert("xss")/scriptmy-model-alias');
    });

    it('strips < and > characters from settings inputs', async () => {
      const payload = {
        ollama_local_url: '<img src=x onerror=alert(1)>http://localhost:11434',
        smart_routing: true,
      };

      const res = await request(app, 'POST', '/api/settings', payload);
      expect(res.status).toBe(200);

      // Verify stored setting in Firestore is sanitized
      const settingsDoc = await firestore.collection('users').doc('test-user-uid').collection('settings').doc('config').get();
      expect(settingsDoc.exists).toBe(true);
      const data = settingsDoc.data();
      expect(data?.ollama_local_url).toBe('img src=x onerror=alert(1)http://localhost:11434');
    });
  });

  describe('IP Rate Limiting', () => {
    it('returns HTTP 429 when IP requests exceed the rate limit threshold', async () => {
      const randomIp = `192.168.1.${Math.floor(Math.random() * 250)}`;

      // We make 100 requests (which is fine), and the 101st request should be rate limited
      // To run quickly in unit tests, we'll send a few rapid calls and make sure they increment.
      // Wait, let's verify if the limiter blocks after limit (which is 100 on /api).
      // Since 101 calls takes a bit of time, let's do a loop of 101 requests.
      // (fetch is extremely fast on localhost/in-memory, 101 requests will take < 100ms)
      
      let rateLimited = false;
      for (let i = 0; i < 105; i++) {
        const res = await request(app, 'GET', '/api/keys', undefined, randomIp);
        if (res.status === 429) {
          rateLimited = true;
          expect(res.body.error.type).toBe('rate_limit_error');
          break;
        }
      }
      expect(rateLimited).toBe(true);
    });
  });
});
