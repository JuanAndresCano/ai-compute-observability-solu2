export interface AuditEvent {
  eventType: string; // e.g. 'telemetry.batch.ingested', 'alert.anomaly.triggered'
  occurredAtMs: number;
  payload: Readonly<Record<string, unknown>>;
}

export interface EventDispatcherPort {
  emit(event: AuditEvent): void;
}
