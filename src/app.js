/**
 * HTTP application factory.
 *
 * Dependencies are injected so the whole surface can be tested without a real
 * database, cache or network listener. The three probe endpoints map directly
 * onto the infrastructure:
 *
 *   GET /health   liveness  - never touches a dependency; ALB target group check
 *   GET /ready    readiness - verifies Postgres + Redis; used by the deploy job
 *   GET /metrics  Prometheus exposition for CloudWatch / Grafana scraping
 */

import express from 'express';
import { randomUUID } from 'node:crypto';

export function createApp({ config, store, cache, logger, metrics, startedAt = Date.now() }) {
  const app = express();
  const state = { draining: false };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  app.use((req, res, next) => {
    req.id = req.get('x-request-id') || randomUUID();
    res.set('x-request-id', req.id);

    const start = process.hrtime.bigint();
    const requestLogger = logger.child({ requestId: req.id });

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = {
        method: req.method,
        route: req.route?.path ?? normalisePath(req.path),
        status: String(res.statusCode),
      };
      metrics?.httpRequestDuration.observe(labels, seconds);
      metrics?.httpRequests.inc(labels);

      const line = {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
      };
      if (res.statusCode >= 500) requestLogger.error('request failed', line);
      else if (res.statusCode >= 400) requestLogger.warn('request rejected', line);
      else requestLogger.info('request completed', line);
    });

    next();
  });

  app.get('/', (req, res) => {
    res.json({
      service: config.serviceName,
      version: config.version,
      environment: config.environment,
    });
  });

  // Liveness: a container that answers this is alive. Deliberately dependency
  // free, otherwise a brief RDS failover would restart otherwise healthy tasks.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // Readiness: flips to 503 as soon as SIGTERM arrives so the ALB stops
  // sending traffic before the task is removed. This is what buys zero
  // downtime during a rolling update.
  app.get('/ready', async (req, res) => {
    if (state.draining) {
      return res.status(503).json({ status: 'draining' });
    }

    const checks = { database: 'unknown', cache: 'unknown' };
    try {
      const [db, redis] = await withTimeout(
        Promise.all([store.ping(), cache.ping()]),
        config.readinessTimeoutMs,
      );
      checks.database = db ? 'ok' : 'failed';
      checks.cache = redis ? 'ok' : 'failed';

      if (db && redis) {
        metrics?.ready.set(1);
        return res.json({ status: 'ready', checks });
      }
      metrics?.ready.set(0);
      return res.status(503).json({ status: 'degraded', checks });
    } catch (error) {
      checks.database = redact(error.message);
      metrics?.ready.set(0);
      return res.status(503).json({ status: 'unavailable', checks, error: 'dependency check failed' });
    }
  });

  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('content-type', metrics.registry.contentType);
      res.send(await metrics.registry.metrics());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/items', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.query.limit);
    const items = await store.listItems({ limit });
    res.json({ items, count: items.length });
  }));

  app.get('/api/v1/items/:id', asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'validation_error', message: 'id must be a positive integer' });
    }
    const item = await store.getItem(id);
    if (!item) return res.status(404).json({ error: 'not_found', message: 'item not found' });
    return res.json({ item });
  }));

  app.post('/api/v1/items', asyncHandler(async (req, res) => {
    const { name, description = '' } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 200) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'name is required and must be 1-200 characters',
      });
    }
    if (typeof description !== 'string' || description.length > 2000) {
      return res.status(400).json({
        error: 'validation_error',
        message: 'description must be a string of at most 2000 characters',
      });
    }

    const item = await store.createItem({ name: name.trim(), description: description.trim() });
    return res.status(201).json({ item });
  }));

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: `no route for ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status ?? 500;
    if (status >= 500) logger.error('unhandled error', { requestId: req.id, error: error.message });
    else logger.warn('client error', { requestId: req.id, error: error.message });

    res.status(status).json({
      error: status >= 500 ? 'internal_error' : 'bad_request',
      message: status >= 500 ? 'the server could not complete the request' : error.message,
    });
  });

  app.locals.drain = () => {
    state.draining = true;
    metrics?.ready.set(0);
  };
  app.locals.isDraining = () => state.draining;

  return app;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function clampLimit(value) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

/** Collapse ids so metrics do not explode the label cardinality. */
function normalisePath(path) {
  return path.replace(/\/\d+/g, '/:id');
}

function redact(message) {
  return String(message ?? 'error').replace(/(password|user|pwd)=[^\s&]+/gi, '$1=***');
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`dependency check timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
