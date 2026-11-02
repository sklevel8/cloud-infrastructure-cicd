import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createFakeCache, createFakeStore, getJson, startTestServer } from './helpers.js';

describe('HTTP surface', () => {
  let server;

  before(async () => {
    server = await startTestServer({
      store: createFakeStore({ items: [{ id: 1, name: 'existing', description: '', createdAt: '2026-01-01T00:00:00.000Z' }] }),
    });
  });

  after(async () => {
    await server.close();
  });

  it('GET /health is dependency free and always 200', async () => {
    const { response, body } = await getJson(`${server.url}/health`);
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '1.0.0');
    assert.equal(typeof body.uptimeSeconds, 'number');
  });

  it('GET /ready returns 200 when both dependencies answer', async () => {
    const { response, body } = await getJson(`${server.url}/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(body.checks, { database: 'ok', cache: 'ok' });
  });

  it('GET /ready flips to 503 while draining so the ALB stops routing', async () => {
    server.app.locals.drain();
    const { response, body } = await getJson(`${server.url}/ready`);
    assert.equal(response.status, 503);
    assert.equal(body.status, 'draining');
    assert.equal(server.app.locals.isDraining(), true);
  });

  it('GET /api/v1/items lists items with a clamped limit', async () => {
    const { response, body } = await getJson(`${server.url}/api/v1/items?limit=9999`);
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.items[0].name, 'existing');
  });

  it('POST /api/v1/items validates the payload', async () => {
    const { response, body } = await getJson(`${server.url}/api/v1/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(response.status, 400);
    assert.equal(body.error, 'validation_error');
  });

  it('POST /api/v1/items creates an item', async () => {
    const { response, body } = await getJson(`${server.url}/api/v1/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new item', description: 'created by test' }),
    });
    assert.equal(response.status, 201);
    assert.equal(body.item.name, 'new item');
    assert.equal(body.item.description, 'created by test');
  });

  it('GET /api/v1/items/:id rejects bad ids and reports missing rows', async () => {
    const invalid = await getJson(`${server.url}/api/v1/items/abc`);
    assert.equal(invalid.response.status, 400);

    const missing = await getJson(`${server.url}/api/v1/items/424242`);
    assert.equal(missing.response.status, 404);

    const found = await getJson(`${server.url}/api/v1/items/1`);
    assert.equal(found.response.status, 200);
    assert.equal(found.body.item.id, 1);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const { response, body } = await getJson(`${server.url}/nope`);
    assert.equal(response.status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('propagates a request id for log correlation', async () => {
    const { response } = await getJson(`${server.url}/health`, { headers: { 'x-request-id': 'trace-123' } });
    assert.equal(response.headers.get('x-request-id'), 'trace-123');
  });

  it('exposes Prometheus metrics with request counters', async () => {
    const response = await fetch(`${server.url}/metrics`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain/);
    assert.match(text, /http_requests_total/);
    assert.match(text, /app_ready\{[^}]*\}\s+0/);
  });
});

describe('dependency failures', () => {
  it('GET /ready returns 503 and hides credentials when Postgres is down', async () => {
    const server = await startTestServer({ store: createFakeStore({ failPing: true }) });
    try {
      const { response, body } = await getJson(`${server.url}/ready`);
      assert.equal(response.status, 503);
      assert.equal(body.status, 'unavailable');
      assert.ok(!JSON.stringify(body).includes('secret'));
    } finally {
      await server.close();
    }
  });

  it('GET /ready returns 503 when Redis is down', async () => {
    const server = await startTestServer({ cache: createFakeCache({ failPing: true }) });
    try {
      const { response } = await getJson(`${server.url}/ready`);
      assert.equal(response.status, 503);
    } finally {
      await server.close();
    }
  });

  it('GET /ready times out rather than hanging the load balancer', async () => {
    const server = await startTestServer({
      store: { ping: () => new Promise(() => {}) },
    });
    try {
      const started = Date.now();
      const { response } = await getJson(`${server.url}/ready`);
      assert.equal(response.status, 503);
      assert.ok(Date.now() - started < 2000, 'readiness check should fail fast');
    } finally {
      await server.close();
    }
  });

  it('maps unexpected errors to a 500 without leaking internals', async () => {
    const server = await startTestServer({
      store: {
        ...createFakeStore(),
        async listItems() {
          throw new Error('relation "items" does not exist: password=secret');
        },
      },
    });
    try {
      const { response, body } = await getJson(`${server.url}/api/v1/items`);
      assert.equal(response.status, 500);
      assert.equal(body.error, 'internal_error');
      assert.ok(!JSON.stringify(body).includes('secret'));
    } finally {
      await server.close();
    }
  });
});
