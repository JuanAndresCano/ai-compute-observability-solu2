import type { Database } from 'better-sqlite3';
import type { RollupRepositoryPort, HourlyRollupRecord } from '../../ports/out/rollup-repository.port';
import { StorageUnavailableError } from '../../shared/errors';

export class SqliteRollupRepo implements RollupRepositoryPort {
  constructor(private readonly db: Database) {}

  async queryHourly(fromMs: number, toMs: number, subjects: readonly string[]): Promise<HourlyRollupRecord[]> {
    try {
      const fromS = Math.floor(fromMs / 1000);
      const toS = Math.floor(toMs / 1000);

      const hasAll = subjects.includes('ALL');
      let sql = `
        SELECT node_id, gpu_index, hour_epoch_s,
               gpu_hours_busy, gpu_hours_idle, gpu_hours_unavailable,
               prompt_tokens_total, completion_tokens_total, primary_subject
        FROM rollup_hourly_metrics
        WHERE hour_epoch_s >= ? AND hour_epoch_s < ?
      `;
      const params: any[] = [fromS, toS];

      if (!hasAll && subjects.length > 0) {
        const placeholders = subjects.map(() => '?').join(', ');
        sql += ` AND primary_subject IN (${placeholders})`;
        params.push(...subjects);
      }

      sql += ` ORDER BY hour_epoch_s ASC, node_id ASC, gpu_index ASC`;

      const rows = this.db.prepare(sql).all(...params) as HourlyRollupRecord[];
      return rows;
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }
}
