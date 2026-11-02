/**
 * Redis cache client (ElastiCache).
 *
 * Used for readiness probes and short-lived read caching. Reconnection is
 * handled by node-redis with an exponential-ish backoff capped at 3s, which
 * keeps a brief ElastiCache failover from turning into a crash loop.
 */

import { createClient } from 'redis';

export async function createCache({ url, logger, attempts = 5, delayMs = 1000 }) {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  client.on('error', (error) => logger?.error('redis client error', { error: error.message }));
  client.on('reconnecting', () => logger?.warn('redis reconnecting'));

  // A brief ElastiCache failover should not crash-loop a task that is otherwise
  // healthy: retry the initial connection, then let node-redis take over.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.connect();
      return client;
    } catch (error) {
      logger?.warn('redis connection attempt failed', { attempt, attempts, error: error.message });
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return client;
}

export async function cachePing(client) {
  const reply = await client.ping();
  return reply === 'PONG';
}

/** Cache-aside helper: returns cached JSON or computes it and stores it. */
export async function cached(client, key, ttlSeconds, producer) {
  const hit = await client.get(key);
  if (hit) return { value: JSON.parse(hit), cache: 'hit' };

  const value = await producer();
  await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return { value, cache: 'miss' };
}
