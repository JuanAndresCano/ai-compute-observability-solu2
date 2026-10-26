/** Counter sink for the metrics named in contracts.md (telemetry_events_dropped_total, alerts_emitted_total, ...). */
export interface MetricsPort {
  increment(name: string, labels: Readonly<Record<string, string>>, by: number): void;
}
