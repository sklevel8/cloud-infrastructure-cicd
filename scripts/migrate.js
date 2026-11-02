#!/usr/bin/env node
/**
 * Applies the schema before the new task revision starts receiving traffic.
 *
 * Run as an ECS one-off task (or `npm run migrate` locally) rather than on
 * container boot, so a bad migration fails the pipeline instead of crashing
 * every replica at once.
 */

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { PostgresStore } from '../src/store/postgres.js';

const logger = createLogger({ service: 'migrate' });

const config = loadConfig();
const store = new PostgresStore({
  connectionString: config.databaseUrl,
  max: 1,
  ssl: config.databaseSsl,
  sslVerify: config.databaseSslVerify,
  logger,
});

try {
  await store.ensureSchema();
  logger.info('schema applied');
} catch (error) {
  logger.error('schema migration failed', { error: error.message });
  process.exitCode = 1;
} finally {
  await store.close();
}
