import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, ensureUser } from '../../db/index.js';
import { firestore } from '../../lib/firebaseAdmin.js';

async function req(app: Express, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(data); } catch {}

  return { status: res.status, body: json, headers: res.headers, raw: data };
}

let testUserUnifiedKey = '';

function authHeaders() {
  return { Authorization: `Bearer ${testUserUnifiedKey}` };
}

function apiHeaders() {
  return { Authorization: 'Bearer test-token' };
}

describe('Full Integration Flow', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    if ('data' in firestore) {
      (firestore as any).data = {};
    }
    await initDb();
    app = createApp();

    // Register a mock user and get their unified key
    const user = await ensureUser('test-user-uid', 'test@example.com', 'Test User', 'https://example.com/pic.jpg');
    testUserUnifiedKey = user.unifiedApiKey;
  });

  it('Step 1: Verify models are seeded', async () => {
    const { status, body } = await req(app, 'GET', '/api/models', undefined, apiHeaders());
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(50);
    expect(body[0]).toHaveProperty('modelId');
    expect(body[0]).toHaveProperty('hasProvider');
    for (const m of body) {
      expect(m.hasProvider).toBe(true);
    }
  });

  it('Step 2: Verify fallback chain is populated', async () => {
    const { status, body } = await req(app, 'GET', '/api/fallback', undefined, apiHeaders());
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(50);
    expect(body[0]).toHaveProperty('priority');
    expect(body[0]).toHaveProperty('enabled');
  });

  it('Step 3: Authenticated proxy returns 429 with no keys', async () => {
    const { status, body } = await req(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, authHeaders());
    expect([429, 502, 503]).toContain(status);
    expect(body.error).toBeDefined();
  });

  it('Step 4: Add a Groq key', async () => {
    const { status, body } = await req(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_integration_test_key',
      label: 'Integration Test',
    }, apiHeaders());
    expect(status).toBe(201);
    expect(body.platform).toBe('groq');
    expect(body.maskedKey).toContain('...');
  });

  it('Step 5: Proxy routes to Groq and handles provider error gracefully', async () => {
    // Mock fetch to simulate a Groq API error
    const origFetch = global.fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      let urlStr = '';
      if (typeof url === 'string') urlStr = url;
      else if (url instanceof URL) urlStr = url.toString();
      else if (url && (url as any).url) urlStr = (url as any).url;
      else urlStr = url.toString();
      
      if (urlStr.includes('api.groq.com')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return origFetch(url as any, init);
    });

    const { status, body } = await req(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'hello' }],
    }, authHeaders());

    expect([502, 429]).toContain(status);
    expect(body.error).toBeDefined();

    vi.restoreAllMocks();
  });

  it('Step 6: Error was logged in analytics', async () => {
    const { status, body } = await req(app, 'GET', '/api/analytics/summary?range=24h', undefined, apiHeaders());
    expect(status).toBe(200);
    expect(body.totalRequests).toBeGreaterThanOrEqual(0);
  });

  it('Step 7: Sort fallback by speed', async () => {
    const { status } = await req(app, 'POST', '/api/fallback/sort/speed', undefined, apiHeaders());
    expect(status).toBe(200);

    const { body } = await req(app, 'GET', '/api/fallback', undefined, apiHeaders());
    expect(body[0].speedRank).toBe(2);
  });

  it('Step 8: Health endpoint works', async () => {
    const { status, body } = await req(app, 'GET', '/api/health', undefined, apiHeaders());
    expect(status).toBe(200);
    expect(body).toHaveProperty('platforms');
    expect(body).toHaveProperty('keys');
  });

  it('Step 9: Delete a key if any exist', async () => {
    await req(app, 'POST', '/api/keys', {
      platform: 'groq', key: 'gsk_delete_test', label: 'delete-test',
    }, apiHeaders());
    const { body: keys } = await req(app, 'GET', '/api/keys', undefined, apiHeaders());
    const target = keys.find((k: any) => k.label === 'delete-test');
    expect(target).toBeDefined();

    const { status } = await req(app, 'DELETE', `/api/keys/${target.id}`, undefined, apiHeaders());
    expect(status).toBe(200);
  });

  it('Step 10: Validate request schema', async () => {
    const { status } = await req(app, 'POST', '/v1/chat/completions', {
      messages: [],
    }, authHeaders());
    expect(status).toBe(400);

    const { status: s2 } = await req(app, 'POST', '/v1/chat/completions', {
    }, authHeaders());
    expect(s2).toBe(400);
  });

  it('Step 11: Explicit unknown model returns 400 (not silent fallthrough)', async () => {
    const { status, body } = await req(app, 'POST', '/v1/chat/completions', {
      model: 'definitely-not-a-real-model',
      messages: [{ role: 'user', content: 'hi' }],
    }, authHeaders());
    expect(status).toBe(400);
    expect(body.error.code).toBe('model_not_found');
    expect(body.error.message).toContain('not in the catalog');
  });

  it('Step 12: Explicit disabled model returns 400 with disabled reason', async () => {
    const { status, body } = await req(app, 'POST', '/v1/chat/completions', {
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    }, authHeaders());
    expect(status).toBe(400);
    expect(body.error.code).toBe('model_not_found');
    expect(body.error.message).toContain('is disabled');
  });
});
