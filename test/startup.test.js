import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The container must fail fast and loudly when the platform fails to inject
 * configuration - silently booting a half-configured task is a production
 * incident waiting to happen.
 */
describe('startup contract', () => {
  it('exits with EX_CONFIG (78) and logs the missing keys', async () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.REDIS_URL;

    try {
      await run(process.execPath, ['src/server.js'], { env, timeout: 15000 });
      assert.fail('expected the process to exit non-zero');
    } catch (error) {
      assert.equal(error.code, 78);
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      assert.match(output, /invalid configuration/);
      assert.match(output, /DATABASE_URL, REDIS_URL/);
    }
  });
});
