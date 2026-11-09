import type { AuditEvent } from './event-dispatcher.port';

/** Read side of the audit events the console emitted (activity feed). Newest first. */
export interface AuditTrailPort {
  recent(limit: number, typePrefix?: string): AuditEvent[];
}
