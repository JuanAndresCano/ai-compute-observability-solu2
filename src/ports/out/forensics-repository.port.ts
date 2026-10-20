export interface ForensicRecord {
  node_id: string;
  last_heartbeat_ms: number;
  last_snapshot_json: string | null;
  log_tail_json: string;      // JSON array, at most 50 lines (CHECK in node_forensics)
  last_job_json: string | null;
  captured_at_ms: number;
}

export interface ForensicsRepositoryPort {
  /** INSERT ... ON CONFLICT (node_id) DO NOTHING; returns false when a record already existed. */
  captureIfAbsent(record: ForensicRecord): Promise<boolean>;
  load(nodeId: string): Promise<ForensicRecord | null>;
  /** Called when the node is HEALTHY again. */
  clear(nodeId: string): Promise<void>;
}
