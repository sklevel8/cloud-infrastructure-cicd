import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { TEST_ENV } from './helpers.js';

describe('loadConfig', () => {
  it('returns a frozen, fully populated config', () => {
    const config = loadConfig(TEST_ENV);
    assert.equal(config.port, 3000);
    assert.equal(config.environment, 'test');
    assert.equal(config.databaseUrl, TEST_ENV.DATABASE_URL);
    assert.equal(config.gracefulShutdownMs, 20000);
    assert.ok(Object.isFrozen(config));
  });

  it('applies safe defaults for optional values', () => {
    const { PORT, READINESS_TIMEOUT_MS, APP_VERSION, SERVICE_NAME, ...minimal } = TEST_ENV;
    const config = loadConfig(minimal);
    assert.equal(config.port, 3000);
    assert.equal(config.readinessTimeoutMs, 2000);
    assert.equal(config.version, '1.0.0');
    assert.equal(config.serviceName, 'prod-microservices-api');
    assert.equal(config.databaseSsl, false);
  });

  it('reports every missing required variable at once', () => {
    assert.throws(
      () => loadConfig({}),
      (error) => {
        assert.ok(error instanceof ConfigError);
        assert.deepEqual(error.missing, ['DATABASE_URL', 'REDIS_URL']);
        assert.match(error.message, /DATABASE_URL, REDIS_URL/);
        return true;
      },
    );
  });

  it('rejects malformed connection strings', () => {
    assert.throws(() => loadConfig({ ...TEST_ENV, DATABASE_URL: 'mysql://x' }), ConfigError);
    assert.throws(() => loadConfig({ ...TEST_ENV, REDIS_URL: 'http://x' }), ConfigError);
  });

  it('rejects non numeric or non positive ports', () => {
    assert.throws(() => loadConfig({ ...TEST_ENV, PORT: 'abc' }), /PORT must be a positive integer/);
    assert.throws(() => loadConfig({ ...TEST_ENV, PORT: '0' }), ConfigError);
  });

  it('parses boolean and numeric flags', () => {
    const config = loadConfig({ ...TEST_ENV, DATABASE_SSL: 'true', DATABASE_POOL_SIZE: '25' });
    assert.equal(config.databaseSsl, true);
    assert.equal(config.databasePoolSize, 25);
  });
});
