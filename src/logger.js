/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line to stdout. ECS ships stdout/stderr to
 * CloudWatch Logs through the awslogs driver, where CloudWatch Logs Insights
 * can query individual fields (`level`, `requestId`, `status`, ...).
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({
  level = 'info',
  service = 'api',
  version = '0.0.0',
  sink = process.stdout,
  now = () => new Date().toISOString(),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, message, context = {}) {
    if (LEVELS[levelName] < threshold) return;
    const line = JSON.stringify({
      timestamp: now(),
      level: levelName,
      service,
      version,
      message,
      ...context,
    });
    sink.write(`${line}\n`);
  }

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
    /** Derive a logger that stamps every line with extra context. */
    child(extra = {}) {
      return {
        debug: (m, c) => emit('debug', m, { ...extra, ...c }),
        info: (m, c) => emit('info', m, { ...extra, ...c }),
        warn: (m, c) => emit('warn', m, { ...extra, ...c }),
        error: (m, c) => emit('error', m, { ...extra, ...c }),
      };
    },
  };
}

/** Never log a connection string verbatim: credentials live inside it. */
export function redactUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '***';
  }
}
