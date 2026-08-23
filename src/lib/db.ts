import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Uses Node's built-in SQLite driver, so the project has no native
// dependencies to compile: `npm install` works on any machine.

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'atlas.db');
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql');

// Next.js reloads modules on every edit in development. Caching the handle on
// globalThis keeps one connection instead of leaking a new one per reload.
const globalForDb = globalThis as unknown as { __atlasDb?: DatabaseSync };

function open(): DatabaseSync {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const isNew = !existsSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');

  if (isNew && existsSync(SCHEMA_PATH)) {
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__atlasDb) globalForDb.__atlasDb = open();
  return globalForDb.__atlasDb;
}

/**
 * node:sqlite only accepts null, number, bigint, string and Uint8Array.
 * Booleans and undefined are common in form handling, so they are normalised
 * here rather than at every call site.
 */
export type SqlParam = string | number | bigint | boolean | null | undefined;

function normalise(params: SqlParam[]): (string | number | bigint | null)[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/**
 * node:sqlite returns rows with a NULL prototype. React refuses to serialise
 * those across the Server -> Client Component boundary ("Only plain objects
 * ... can be passed to Client Components"), so every row is copied into a
 * plain object exactly once, here, rather than at each call site.
 */
function toPlain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

/** Run a SELECT returning every matching row. */
export function query<T>(sql: string, ...params: SqlParam[]): T[] {
  const rows = getDb().prepare(sql).all(...normalise(params));
  return rows.map((r) => toPlain<T>(r));
}

/** Run a SELECT returning the first row, or undefined. */
export function get<T>(sql: string, ...params: SqlParam[]): T | undefined {
  const row = getDb().prepare(sql).get(...normalise(params));
  return row === undefined || row === null ? undefined : toPlain<T>(row);
}

/** Run an INSERT, UPDATE or DELETE. */
export function run(
  sql: string,
  ...params: SqlParam[]
): { changes: number; lastInsertRowid: number } {
  const r = getDb().prepare(sql).run(...normalise(params));
  return {
    changes: Number(r.changes),
    lastInsertRowid: Number(r.lastInsertRowid),
  };
}

/** Execute several statements atomically. Rolls back if the callback throws. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
