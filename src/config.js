/**
 * Runtime configuration.
 *
 * Every value is injected by the platform (ECS task definition, GitHub
 * Actions, docker compose, a local shell). Nothing is read from a committed
 * file, so no credential can ever leak into the image.
 */

export class ConfigError extends Error {
  constructor(message, missing = []) {
    super(message);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

const REQUIRED_KEYS = ['DATABASE_URL', 'REDIS_URL'];

function parsePositiveInt(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer, received "${value}"`);
  }
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function isPostgresUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function isRedisUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}

/**
 * Validate the environment and return a frozen config object.
 * Throws ConfigError listing every missing or malformed key at once so a bad
 * deployment fails loudly instead of half-booting.
 */
export function loadConfig(env = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}`, missing);
  }

  if (!isPostgresUrl(env.DATABASE_URL)) {
    throw new ConfigError('DATABASE_URL must be a postgres:// or postgresql:// connection string');
  }
  if (!isRedisUrl(env.REDIS_URL)) {
    throw new ConfigError('REDIS_URL must be a redis:// or rediss:// connection string');
  }

  return Object.freeze({
    serviceName: env.SERVICE_NAME || 'prod-microservices-api',
    version: env.APP_VERSION || '1.0.0',
    environment: env.NODE_ENV || 'development',
    port: parsePositiveInt(env.PORT, 3000, 'PORT'),
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    databasePoolSize: parsePositiveInt(env.DATABASE_POOL_SIZE, 10, 'DATABASE_POOL_SIZE'),
    databaseSsl: parseBoolean(env.DATABASE_SSL, false),
    // RDS presents an Amazon-trusted CA that is not in Node's default store.
    // Set DATABASE_SSL_VERIFY=true together with NODE_EXTRA_CA_CERTS to get
    // full certificate verification.
    databaseSslVerify: parseBoolean(env.DATABASE_SSL_VERIFY, false),
    // Must stay below the ECS stopTimeout (30s) so the task drains before SIGKILL.
    gracefulShutdownMs: parsePositiveInt(env.GRACEFUL_SHUTDOWN_MS, 20000, 'GRACEFUL_SHUTDOWN_MS'),
    readinessTimeoutMs: parsePositiveInt(env.READINESS_TIMEOUT_MS, 2000, 'READINESS_TIMEOUT_MS'),
    logLevel: env.LOG_LEVEL || 'info',
  });
}
