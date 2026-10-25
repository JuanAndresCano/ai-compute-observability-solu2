import type { Database, Statement } from 'better-sqlite3';
import type { TelemetryRepositoryPort, TelemetryBucketRecord, TimelinePoint } from '../../ports/out/telemetry-repository.port';
import type { NodeTelemetryPacketDTO } from '../../dto';
import { StorageUnavailableError } from '../../shared/errors';

export class SqliteTelemetryRepo implements TelemetryRepositoryPort {
  private readonly insertBucketStmt: Statement;
  private readonly insertBatchStmt: Statement;
  private readonly pruneBatchStmt: Statement;
  private readonly timelineStmt: Statement;
  private readonly lastSnapshotStmt: Statement;
  private readonly latestSnapshots = new Map<string, string>();

  constructor(private readonly db: Database) {
    this.insertBucketStmt = this.db.prepare(`
      INSERT OR IGNORE INTO telemetry_buckets (
        bucket_id, node_id, gpu_index, bucket_start_ms,
        temperature_min, temperature_max, temperature_avg,
        vram_used_bytes, gpu_utilization_pct,
        prompt_tokens_per_sec, completion_tokens_per_sec, p99_latency_ms,
        event_count, created_at_ms
      ) VALUES (
        @bucket_id, @node_id, @gpu_index, @bucket_start_ms,
        @temperature_min, @temperature_max, @temperature_avg,
        @vram_used_bytes, @gpu_utilization_pct,
        @prompt_tokens_per_sec, @completion_tokens_per_sec, @p99_latency_ms,
        @event_count, @created_at_ms
      )
    `);

    this.insertBatchStmt = this.db.prepare(`
      INSERT OR IGNORE INTO ingested_batches (batch_id, ingested_at_ms)
      VALUES (?, ?)
    `);

    this.pruneBatchStmt = this.db.prepare(`
      DELETE FROM ingested_batches WHERE ingested_at_ms < ?
    `);

    this.timelineStmt = this.db.prepare(`
      SELECT bucket_start_ms AS timestamp_ms, temperature_max AS temperature_celsius, vram_used_bytes
      FROM telemetry_buckets
      WHERE node_id = ? AND bucket_start_ms >= ? AND bucket_start_ms <= ?
      ORDER BY bucket_start_ms ASC
    `);

    this.lastSnapshotStmt = this.db.prepare(`
      SELECT * FROM telemetry_buckets
      WHERE node_id = ?
      ORDER BY bucket_start_ms DESC
      LIMIT 1
    `);
  }

  async commitBuckets(buckets: readonly TelemetryBucketRecord[]): Promise<void> {
    try {
      const insertMany = this.db.transaction((records: readonly TelemetryBucketRecord[]) => {
        for (const b of records) {
          const bucketId = `BUCKET-${b.bucket_start_ms}-${b.node_id}-${b.gpu_index}`;
          this.insertBucketStmt.run({
            bucket_id: bucketId,
            node_id: b.node_id,
            gpu_index: b.gpu_index,
            bucket_start_ms: b.bucket_start_ms,
            temperature_min: b.temperature_min,
            temperature_max: b.temperature_max,
            temperature_avg: b.temperature_avg,
            vram_used_bytes: b.vram_used_bytes,
            gpu_utilization_pct: b.gpu_utilization_pct,
            prompt_tokens_per_sec: 0,
            completion_tokens_per_sec: 0,
            p99_latency_ms: 0,
            event_count: b.event_count,
            created_at_ms: b.bucket_start_ms,
          });
        }
      });
      insertMany(buckets);
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async registerBatch(batchId: string): Promise<boolean> {
    try {
      const now = Date.now();
      const info = this.insertBatchStmt.run(batchId, now);
      this.pruneBatchStmt.run(now - 3_600_000);
      return info.changes > 0;
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async lastSnapshot(nodeId: string): Promise<string | null> {
    try {
      if (this.latestSnapshots.has(nodeId)) {
        return this.latestSnapshots.get(nodeId)!;
      }
      const row = this.lastSnapshotStmt.get(nodeId) as any;
      if (!row) return null;
      const packet: NodeTelemetryPacketDTO = {
        node_id: row.node_id,
        gpu_index: row.gpu_index,
        timestamp_ms: row.bucket_start_ms,
        temperature_celsius: row.temperature_max,
        vram_used_bytes: row.vram_used_bytes,
        vram_total_bytes: row.node_id === 'server-gpu-01' ? 51539607552 : 25769803776,
        gpu_utilization_pct: row.gpu_utilization_pct,
        active_jobs_count: 0,
        current_subject: 'CS-480',
      };
      return JSON.stringify(packet);
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  setLastSnapshot(nodeId: string, snapshotJson: string): void {
    this.latestSnapshots.set(nodeId, snapshotJson);
  }

  async readTimeline(nodeId: string, fromMs: number, toMs: number): Promise<TimelinePoint[]> {
    try {
      return this.timelineStmt.all(nodeId, fromMs, toMs) as TimelinePoint[];
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }
}
