#!/usr/bin/env node
/**
 * Process entrypoint.
 *
 * Boot order matters: validate config -> connect dependencies -> listen.
 * Shutdown order is the reverse, and SIGTERM handling is what allows ECS to
 * replace a task without dropping a request.
 */

import { createServer } from 'node:http';
import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './logger.js';
import { createMetrics } from './metrics.js';
import { createApp } from './app.js';
import { PostgresStore } from './store/postgres.js';
import { createCache } from './cache.js';

const logger = createLogger({ level: process.env.LOG_LEVEL || 'info', service: 'api' });

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('invalid configuration', { error: error.message, missing: error.missing });
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const log = createLogger({
    level: config.logLevel,
    service: config.serviceName,
    version: config.version,
  });
  const metrics = createMetrics({ service: config.serviceName, version: config.version });

  const store = new PostgresStore({
    connectionString: config.databaseUrl,
    max: config.databasePoolSize,
    ssl: config.databaseSsl,
    sslVerify: config.databaseSslVerify,
    logger: log,
  });
  const cache = await createCache({ url: config.redisUrl, logger: log });

  await store.ensureSchema();

  const app = createApp({ config, store, cache, logger: log, metrics });
  const server = createServer(app);

  // Connection-level readiness gate: ElastiCache and RDS are reachable now.
  metrics.ready.set(1);
  log.info('dependencies connected', { port: config.port, environment: config.environment });

  server.listen(config.port, '0.0.0.0', () => {
    log.info('server listening', { port: config.port, pid: process.pid });
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    // 1. Fail readiness immediately so the ALB deregisters this task.
    app.locals.drain();
    log.info('shutdown initiated', { signal });

    // 2. Stop accepting new connections and let in-flight requests finish.
    const hardStop = setTimeout(() => {
      log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, config.gracefulShutdownMs);
    hardStop.unref();

    await new Promise((resolve) => server.close(resolve));

    // 3. Release external connections.
    await Promise.allSettled([store.close(), cache.quit()]);
    clearTimeout(hardStop);

    log.info('shutdown complete', { signal });
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error('fatal startup error', { error: error.message });
  process.exit(1);
});
