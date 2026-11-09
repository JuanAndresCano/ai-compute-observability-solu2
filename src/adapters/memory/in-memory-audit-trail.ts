import type { AuditEvent, EventDispatcherPort } from '../../ports/out/event-dispatcher.port';
import type { AuditTrailPort } from '../../ports/out/audit-trail.port';

/** Bounded in-memory audit log: the dispatcher the console emits into and the feed the UI reads back. */
export class InMemoryAuditTrail implements EventDispatcherPort, AuditTrailPort {
  private readonly events: AuditEvent[] = [];

  constructor(private readonly capacity = 500) {}

  emit(event: AuditEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
  }

  recent(limit: number, typePrefix?: string): AuditEvent[] {
    const matching = typePrefix ? this.events.filter((e) => e.eventType.startsWith(typePrefix)) : this.events;
    return matching.slice(-limit).reverse();
  }
}
