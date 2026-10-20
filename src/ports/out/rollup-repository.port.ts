export interface HourlyRollupRecord {
  node_id: string;
  gpu_index: number;
  hour_epoch_s: number;
  gpu_hours_busy: number;
  gpu_hours_idle: number;
  gpu_hours_unavailable: number;
  prompt_tokens_total: number;
  completion_tokens_total: number;
  primary_subject: string;
}

export interface RollupRepositoryPort {
  /** Reads rollup_hourly_metrics only (INV-06); never raw telemetry. */
  queryHourly(fromMs: number, toMs: number, subjects: readonly string[]): Promise<HourlyRollupRecord[]>;
}
