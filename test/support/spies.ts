import type { MetricsPort } from '../../src/ports/out/metrics.port';
import type { UiDispatchPort } from '../../src/ports/out/ui-dispatch.port';
import type { FleetSnapshotDTO } from '../../src/dto';
import type { AuditEvent, EventDispatcherPort } from '../../src/ports/out/event-dispatcher.port';

export class EventSpy implements EventDispatcherPort {
  readonly events: AuditEvent[] = [];
  emit(event: AuditEvent): void {
    this.events.push(event);
  }
  ofType(eventType: string): AuditEvent[] {
    return this.events.filter((e) => e.eventType === eventType);
  }
}

export class MetricsSpy implements MetricsPort {
  readonly calls: { name: string; labels: Readonly<Record<string, string>>; by: number }[] = [];
  increment(name: string, labels: Readonly<Record<string, string>>, by: number): void {
    this.calls.push({ name, labels, by });
  }
  total(name: string, labels?: Record<string, string>): number {
    return this.calls
      .filter((c) => c.name === name && Object.entries(labels ?? {}).every(([k, v]) => c.labels[k] === v))
      .reduce((s, c) => s + c.by, 0);
  }
}

export class UiSpy implements UiDispatchPort {
  readonly ticks: FleetSnapshotDTO[] = [];
  dispatch(snapshot: FleetSnapshotDTO): void {
    this.ticks.push(snapshot);
  }
  /** Dispatches whose bucket_start_ms lies in [fromMs, fromMs + 1000). */
  inSecond(fromMs: number): FleetSnapshotDTO[] {
    return this.ticks.filter((t) => t.bucket_start_ms >= fromMs && t.bucket_start_ms < fromMs + 1000);
  }
}
