/**
 * PostgreSQL persistence.
 *
 * The pool points at RDS in the isolated subnet. Worst-case connect time is
 * bounded so a hanging database cannot exhaust the Node event loop during a
 * rolling deployment.
 */

import pg from 'pg';

export class PostgresStore {
  constructor({ connectionString, max = 10, ssl = false, sslVerify = false, logger, pool } = {}) {
    this.logger = logger;
    this.pool = pool ?? new pg.Pool({
      connectionString,
      max,
      ssl: ssl ? { rejectUnauthorized: sslVerify } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    this.pool.on('error', (error) => {
      this.logger?.error('idle postgres client error', { error: error.message });
    });
  }

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id          bigserial PRIMARY KEY,
        name        text        NOT NULL,
        description text        NOT NULL DEFAULT '',
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS items_created_at_idx ON items (created_at DESC)');
  }

  async listItems({ limit = 50 } = {}) {
    const { rows } = await this.pool.query(
      'SELECT id, name, description, created_at FROM items ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(toItem);
  }

  async getItem(id) {
    const { rows } = await this.pool.query(
      'SELECT id, name, description, created_at FROM items WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? toItem(rows[0]) : null;
  }

  async createItem({ name, description = '' }) {
    const { rows } = await this.pool.query(
      'INSERT INTO items (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at',
      [name, description],
    );
    return toItem(rows[0]);
  }

  async close() {
    await this.pool.end();
  }
}

function toItem(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
