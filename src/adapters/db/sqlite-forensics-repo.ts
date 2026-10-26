import type { Database } from 'better-sqlite3';
import type { ForensicsRepositoryPort, ForensicRecord } from '../../ports/out/forensics-repository.port';
import { StorageUnavailableError } from '../../shared/errors';

export class SqliteForensicsRepo implements ForensicsRepositoryPort {
  constructor(private readonly db: Database) {}

  async captureIfAbsent(record: ForensicRecord): Promise<boolean> {
    try {
      if (!this.db) throw new StorageUnavailableError('Database not initialized');
      const stmt = this.db.prepare(`
        INSERT INTO node_forensics (
          node_id, last_heartbeat_ms, last_snapshot_json, log_tail_json, last_job_json,
          captured_at_ms, created_at_ms, updated_at_ms
        ) VALUES (
          @node_id, @last_heartbeat_ms, @last_snapshot_json, @log_tail_json, @last_job_json,
          @captured_at_ms, @captured_at_ms, @captured_at_ms
        ) ON CONFLICT (node_id) DO NOTHING
      `);

      const res = stmt.run({
        node_id: record.node_id,
        last_heartbeat_ms: record.last_heartbeat_ms,
        last_snapshot_json: record.last_snapshot_json,
        log_tail_json: record.log_tail_json,
        last_job_json: record.last_job_json,
        captured_at_ms: record.captured_at_ms,
      });

      return res.changes === 1;
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async load(nodeId: string): Promise<ForensicRecord | null> {
    try {
      if (!this.db) throw new StorageUnavailableError('Database not initialized');
      const row = this.db
        .prepare(
          `SELECT node_id, last_heartbeat_ms, last_snapshot_json, log_tail_json, last_job_json, captured_at_ms
           FROM node_forensics
           WHERE node_id = ?`,
        )
        .get(nodeId) as any;

      if (!row) return null;

      return {
        node_id: row.node_id,
        last_heartbeat_ms: row.last_heartbeat_ms,
        last_snapshot_json: row.last_snapshot_json,
        log_tail_json: row.log_tail_json,
        last_job_json: row.last_job_json,
        captured_at_ms: row.captured_at_ms,
      };
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async clear(nodeId: string): Promise<void> {
    try {
      if (!this.db) throw new StorageUnavailableError('Database not initialized');
      this.db.prepare(`DELETE FROM node_forensics WHERE node_id = ?`).run(nodeId);
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }
}
