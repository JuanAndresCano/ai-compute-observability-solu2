/**
 * Database connection factory and migration runner for SQLite.
 * Confined strictly to src/adapters/db according to Hexagonal Rule R3.
 */
import Database, { type Database as Db } from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DatabaseOptions {
  readonly dbPath: string;
  readonly schemaPath?: string;
  readonly seed?: boolean;
}

export const DEFAULT_SCHEMA_PATH = resolve(process.cwd(), 'planning/detailed-design/schemas/001_observability_schema.sql');

export function initDatabase(options: DatabaseOptions): Db {
  const db = new Database(options.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaFile = options.schemaPath || DEFAULT_SCHEMA_PATH;
  if (existsSync(schemaFile)) {
    const ddl = readFileSync(schemaFile, 'utf8');
    db.exec(ddl);
  }

  return db;
}
