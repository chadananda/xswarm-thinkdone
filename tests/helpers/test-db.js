// Test adapter: wraps better-sqlite3 with async API matching Turso WASM
// Lets the same SQL and engine code work in both browser (Turso WASM) and Node (tests)
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

export function connect(name) {
  const path = name === ':memory:'
    ? ':memory:'
    : join(tmpdir(), `thinkdone-test-${randomBytes(4).toString('hex')}.db`);
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');

  return {
    _raw: raw,
    _path: path,

    async exec(sql) {
      raw.exec(sql);
    },

    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        async all(...params) {
          return stmt.all(...params);
        },
        async get(...params) {
          return stmt.get(...params) || null;
        },
        async run(...params) {
          return stmt.run(...params);
        },
      };
    },

    async close() {
      raw.close();
    },
  };
}

export async function createTestDb() {
  return connect(':memory:');
}
