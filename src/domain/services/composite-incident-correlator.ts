/**
 * Domain Service: Composite Incident Correlator (Invariant AD-28).
 * Correlates multi-metric co-occurring anomalies (thermal spike >85C, fan 0 RPM, dropped tokens)
 * on a single node within a 30-second window, collapsing them into a single deduplicated
 * root-cause incident: CRITICAL_COOLING_FAILURE.
 *
 * Window semantics (an interpretation of AD-28, see decision log):
 *  - Correlation is a SLIDING window anchored at the newest event seen for the node: only anomalies within
 *    `windowDuration` of it count toward the signature.
 *  - An incident stays ACTIVE while related anomalies keep arriving; it expires after `windowDuration` of silence
 *    (measured from the last related anomaly, not from creation), so a sustained failure produces one incident,
 *    not one every 30 s.
 *  - Time comes only from event timestamps (the domain is pure); out-of-order events are tolerated inside the window
 *    and ignored once older than the window relative to the node's newest event.
 *  - Memory is bounded: evidence per incident is capped; expired state is pruned.
 */

export type AnomalyType = 'THERMAL_SPIKE' | 'FAN_FAILURE' | 'DROPPED_TOKENS' | 'LATENCY_BREACH';

export interface RawAnomalyEvent {
  node_id: string;
  anomaly_type: AnomalyType;
  timestamp_ms: number;
  value: number;
  details?: Record<string, string | number>;
}

export interface CompositeIncident {
  incident_id: string;
  incident_type: 'CRITICAL_COOLING_FAILURE' | 'NETWORK_BOTTLENECK' | 'COMPUTE_STARVATION';
  node_id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  created_at_ms: number;
  /** Timestamp of the latest related anomaly attached or suppressed; the incident expires `window` after it. */
  last_activity_ms: number;
  /** At most MAX_EVIDENCE_PER_INCIDENT events are kept; `suppressed_count` still counts every duplicate. */
  supporting_evidence: RawAnomalyEvent[];
  suppressed_count: number;
}

export const MAX_EVIDENCE_PER_INCIDENT = 100;

export class CompositeIncidentCorrelator {
  private readonly windowDurationMs: number;
  /** Node -> anomalies inside the sliding window (pruned on every event). */
  private nodeAnomalies: Map<string, RawAnomalyEvent[]> = new Map();
  /** Node -> active composite incident. */
  private activeIncidents: Map<string, CompositeIncident> = new Map();
  /** Node -> newest event timestamp seen (high-water mark for out-of-order handling). */
  private newestTimestamp: Map<string, number> = new Map();

  constructor(options: { windowDurationSeconds?: number } = {}) {
    this.windowDurationMs = (options.windowDurationSeconds ?? 30) * 1000;
  }

  /**
   * Evaluates an incoming anomaly event. Returns a CompositeIncident if threshold correlation is met,
   * or null if the event is buffered, suppressed as a duplicate, or too old to matter.
   */
  public ingestAnomaly(event: RawAnomalyEvent): CompositeIncident | null {
    const newest = Math.max(this.newestTimestamp.get(event.node_id) ?? Number.NEGATIVE_INFINITY, event.timestamp_ms);
    // Older than the window relative to the node's newest event: cannot belong to the current correlation.
    if (event.timestamp_ms < newest - this.windowDurationMs) return null;
    this.newestTimestamp.set(event.node_id, newest);
    const now = newest;

    // An incident that has been silent for a full window has expired: forget it and start fresh.
    const existingIncident = this.activeIncidents.get(event.node_id);
    if (existingIncident && now - existingIncident.last_activity_ms > this.windowDurationMs) {
      this.activeIncidents.delete(event.node_id);
    }

    const active = this.activeIncidents.get(event.node_id);
    if (active) {
      // Related anomaly while the incident is active: suppress the duplicate alert, keep (bounded) evidence.
      active.suppressed_count += 1;
      active.last_activity_ms = Math.max(active.last_activity_ms, event.timestamp_ms);
      if (active.supporting_evidence.length < MAX_EVIDENCE_PER_INCIDENT) active.supporting_evidence.push(event);
      return null;
    }

    // Sliding window: keep only anomalies within the window of the newest event, then add this one.
    const anomalies = (this.nodeAnomalies.get(event.node_id) ?? []).filter((a) => now - a.timestamp_ms <= this.windowDurationMs);
    anomalies.push(event);
    this.nodeAnomalies.set(event.node_id, anomalies);

    // Signature of CRITICAL_COOLING_FAILURE: THERMAL_SPIKE (>85C) + FAN_FAILURE (0 RPM) + DROPPED_TOKENS (>0)
    const hasThermalSpike = anomalies.some((a) => a.anomaly_type === 'THERMAL_SPIKE' && a.value > 85.0);
    const hasFanFailure = anomalies.some((a) => a.anomaly_type === 'FAN_FAILURE' && a.value === 0);
    const hasDroppedTokens = anomalies.some((a) => a.anomaly_type === 'DROPPED_TOKENS' && a.value > 0);

    if (hasThermalSpike && hasFanFailure && hasDroppedTokens) {
      const incident: CompositeIncident = {
        incident_id: `INC-COOLING-${event.node_id}-${now}`,
        incident_type: 'CRITICAL_COOLING_FAILURE',
        node_id: event.node_id,
        severity: 'CRITICAL',
        created_at_ms: now,
        last_activity_ms: now,
        supporting_evidence: anomalies.slice(-MAX_EVIDENCE_PER_INCIDENT),
        suppressed_count: 0,
      };
      this.activeIncidents.set(event.node_id, incident);
      this.nodeAnomalies.delete(event.node_id); // buffered anomalies are now evidence of the incident
      return incident;
    }

    return null;
  }

  /**
   * The node's active incident, or null. Pass `nowMs` to ignore an incident that has already expired
   * (silent for a full window); without it the stored incident is returned as-is.
   */
  public getActiveIncident(nodeId: string, nowMs?: number): CompositeIncident | null {
    const incident = this.activeIncidents.get(nodeId) ?? null;
    if (incident && nowMs !== undefined && nowMs - incident.last_activity_ms > this.windowDurationMs) return null;
    return incident;
  }

  /** Active (non-expired at `nowMs`) incidents across all nodes. */
  public listActiveIncidents(nowMs?: number): CompositeIncident[] {
    return [...this.activeIncidents.keys()]
      .map((n) => this.getActiveIncident(n, nowMs))
      .filter((i): i is CompositeIncident => i !== null);
  }

  /** Releases state that can no longer influence a result at `nowMs` (call periodically; keeps memory flat). */
  public prune(nowMs: number): void {
    for (const [node, incident] of this.activeIncidents) {
      if (nowMs - incident.last_activity_ms > this.windowDurationMs) this.activeIncidents.delete(node);
    }
    for (const [node, anomalies] of this.nodeAnomalies) {
      const live = anomalies.filter((a) => nowMs - a.timestamp_ms <= this.windowDurationMs);
      if (live.length === 0) this.nodeAnomalies.delete(node);
      else this.nodeAnomalies.set(node, live);
    }
    for (const [node, newest] of this.newestTimestamp) {
      if (nowMs - newest > this.windowDurationMs && !this.activeIncidents.has(node) && !this.nodeAnomalies.has(node)) {
        this.newestTimestamp.delete(node);
      }
    }
  }

  public clear(): void {
    this.nodeAnomalies.clear();
    this.activeIncidents.clear();
    this.newestTimestamp.clear();
  }
}
