import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cached } from '../src/cache.js';

function fakeRedis(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value, options) {
      assert.equal(options.EX > 0, true, 'cache writes must always carry a TTL');
      data.set(key, value);
    },
  };
}

describe('cached', () => {
  it('computes and stores on a miss', async () => {
    const client = fakeRedis();
    let calls = 0;

    const result = await cached(client, 'items', 30, async () => {
      calls += 1;
      return [{ id: 1 }];
    });

    assert.equal(result.cache, 'miss');
    assert.deepEqual(result.value, [{ id: 1 }]);
    assert.equal(calls, 1);
    assert.equal(client.data.has('items'), true);
  });

  it('serves from cache on a hit without calling the producer', async () => {
    const client = fakeRedis({ items: JSON.stringify([{ id: 2 }]) });

    const result = await cached(client, 'items', 30, async () => {
      throw new Error('producer must not run on a cache hit');
    });

    assert.equal(result.cache, 'hit');
    assert.deepEqual(result.value, [{ id: 2 }]);
  });
});
