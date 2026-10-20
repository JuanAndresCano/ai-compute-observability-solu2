import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedFleet } from './seed_fleet';
import { T0 } from './fake_clock';

export const MIGRATION_PATH = process.env.SCHEMA_PATH ?? resolve(__dirname, '../../planning/detailed-design/schemas/001_observability_schema.sql');

export const TABLES = ['cluster_nodes', 'telemetry_buckets', 'ingested_batches', 'operational_alerts', 'node_heartbeats', 'node_forensics', 'rollup_hourly_metrics', 'audit_events'] as const;
export type TableName = (typeof TABLES)[number];

const traces = new WeakMap<Db, string[][]>();

/**
 * Live log of every SQL statement EXECUTED from now on, whenever it was prepared (better-sqlite3 `verbose` reports
 * executions, so statements prepared once in an adapter constructor cannot evade it).
 */
export function traceSql(db: Db): string[] {
  const log: string[] = [];
  traces.set(db, [...(traces.get(db) ?? []), log]);
  return log;
}

/** Ephemeral in-memory SQLite migrated from 001_observability_schema.sql, fleet seeded. */
export function createTestDb(opts: { seed?: boolean; nowMs?: number } = {}): Db {
  // eslint-disable-next-line prefer-const
  let db: Db;
  db = new Database(':memory:', { verbose: (sql) => traces.get(db)?.forEach((l) => l.push(String(sql))) });
  db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  if (opts.seed !== false) seedFleet(db, opts.nowMs ?? T0);
  return db;
}

export function count(db: Db, table: TableName): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Full content of every table: equal fingerprints before/after prove "zero mutations". */
export function fingerprint(db: Db): string {
  return JSON.stringify(
    TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
}
