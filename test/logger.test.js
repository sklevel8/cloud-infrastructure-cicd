import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, redactUrl } from '../src/logger.js';

function capture() {
  const lines = [];
  return { lines, sink: { write: (chunk) => lines.push(chunk.trim()) } };
}

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink, service: 'api', version: '1.2.3', now: () => '2026-01-01T00:00:00.000Z' });

    logger.info('server listening', { port: 3000 });

    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      service: 'api',
      version: '1.2.3',
      message: 'server listening',
      port: 3000,
    });
  });

  it('filters records below the configured level', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink, level: 'warn' });

    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');
    logger.error('kept');

    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).level), ['warn', 'error']);
  });

  it('merges child context into every record', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ sink }).child({ requestId: 'abc' });

    logger.info('request completed', { status: 200 });

    assert.deepEqual(
      { requestId: JSON.parse(lines[0]).requestId, status: JSON.parse(lines[0]).status },
      { requestId: 'abc', status: 200 },
    );
  });
});

describe('redactUrl', () => {
  it('removes credentials from a connection string', () => {
    const redacted = redactUrl('postgres://app:supersecret@db.internal:5432/app');
    assert.ok(!redacted.includes('supersecret'));
    assert.match(redacted, /db\.internal/);
  });

  it('returns a placeholder for unparsable input', () => {
    assert.equal(redactUrl('not a url'), '***');
  });
});
