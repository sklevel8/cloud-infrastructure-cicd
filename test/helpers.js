import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createMetrics } from '../src/metrics.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://app:secret@db.internal:5432/app',
  REDIS_URL: 'redis://cache.internal:6379',
  APP_VERSION: '1.0.0',
  SERVICE_NAME: 'test-api',
  READINESS_TIMEOUT_MS: '250',
};

export function testConfig(overrides = {}) {
  return loadConfig({ ...TEST_ENV, ...overrides });
}

/** Structured logger that writes nowhere, so test output stays readable. */
export function silentLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger() };
}

export function createFakeStore({ failPing = false, items = [] } = {}) {
  const rows = [...items];
  let nextId = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1;

  return {
    async ping() {
      if (failPing) throw new Error('connect ECONNREFUSED user=app password=secret');
      return true;
    },
    async listItems({ limit = 50 } = {}) {
      return rows.slice(0, limit);
    },
    async getItem(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async createItem({ name, description = '' }) {
      const item = { id: nextId++, name, description, createdAt: new Date().toISOString() };
      rows.unshift(item);
      return item;
    },
    async close() {},
  };
}

export function createFakeCache({ failPing = false } = {}) {
  return {
    async ping() {
      if (failPing) throw new Error('redis connection lost');
      return true;
    },
    async quit() {},
  };
}

export async function startTestServer({ store, cache } = {}) {
  const config = testConfig();
  const metrics = createMetrics({ service: config.serviceName, version: config.version });
  const app = createApp({
    config,
    store: store ?? createFakeStore(),
    cache: cache ?? createFakeCache(),
    logger: silentLogger(),
    metrics,
  });

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    app,
    metrics,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function getJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => undefined);
  return { response, body };
}
