export interface TelemetryBucketRecord {
  node_id: string;
  gpu_index: number;
  bucket_start_ms: number;
  temperature_min: number;
  temperature_max: number;
  temperature_avg: number;
  vram_used_bytes: number;
  gpu_utilization_pct: number;
  event_count: number;
}

export interface TelemetryRepositoryPort {
  /** Idempotent: INSERT OR IGNORE on (node_id, gpu_index, bucket_start_ms). */
  commitBuckets(buckets: readonly TelemetryBucketRecord[]): Promise<void>;
  /** Returns false when batch_id was already registered (replay). */
  registerBatch(batchId: string): Promise<boolean>;
}
