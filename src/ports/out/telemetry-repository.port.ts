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

export interface TimelinePoint {
  timestamp_ms: number;
  temperature_celsius: number;
  vram_used_bytes: number;
}

export interface TelemetryRepositoryPort {
  /** Last accepted packet of the node (JSON of a NodeTelemetryPacketDTO) or null. */
  lastSnapshot(nodeId: string): Promise<string | null>;
  /** Closed 250 ms buckets of the node in [fromMs, toMs), ascending. */
  readTimeline(nodeId: string, fromMs: number, toMs: number): Promise<TimelinePoint[]>;
  /** Idempotent: INSERT OR IGNORE on (node_id, gpu_index, bucket_start_ms). */
  commitBuckets(buckets: readonly TelemetryBucketRecord[]): Promise<void>;
  /** INSERT OR IGNORE INTO ingested_batches; false when batch_id was already registered inside the 1-hour replay window (AMD-19). */
  registerBatch(batchId: string): Promise<boolean>;
}
