import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PostgresStore } from '../src/store/postgres.js';

function fakePool(rows = []) {
  const queries = [];
  return {
    queries,
    on() {},
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('INSERT')) {
        return { rows: [{ id: '7', name: params[0], description: params[1], created_at: new Date('2026-01-01T00:00:00Z') }] };
      }
      return { rows };
    },
    async end() {},
  };
}

describe('PostgresStore', () => {
  it('pings the database', async () => {
    const pool = fakePool();
    const store = new PostgresStore({ pool });
    assert.equal(await store.ping(), true);
    assert.match(pool.queries[0].sql, /SELECT 1/);
  });

  it('creates the schema idempotently', async () => {
    const pool = fakePool();
    const store = new PostgresStore({ pool });
    await store.ensureSchema();

    assert.equal(pool.queries.length, 2);
    assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS items/);
    assert.match(pool.queries[1].sql, /CREATE INDEX IF NOT EXISTS/);
  });

  it('maps snake_case rows into camelCase api objects', async () => {
    const pool = fakePool([
      { id: '3', name: 'row', description: 'desc', created_at: new Date('2026-02-03T04:05:06Z') },
    ]);
    const store = new PostgresStore({ pool });

    const items = await store.listItems({ limit: 10 });

    assert.deepEqual(items, [
      { id: 3, name: 'row', description: 'desc', createdAt: '2026-02-03T04:05:06.000Z' },
    ]);
    assert.deepEqual(pool.queries[0].params, [10]);
  });

  it('returns null for a missing row', async () => {
    const store = new PostgresStore({ pool: fakePool([]) });
    assert.equal(await store.getItem(999), null);
  });

  it('returns the inserted row', async () => {
    const store = new PostgresStore({ pool: fakePool() });
    const item = await store.createItem({ name: 'created', description: 'from test' });
    assert.equal(item.id, 7);
    assert.equal(item.name, 'created');
    assert.match(item.createdAt, /^2026-01-01T00:00:00/);
  });
});
