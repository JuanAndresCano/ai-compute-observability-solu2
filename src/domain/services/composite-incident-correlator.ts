/**
 * Domain Service: Composite Incident Correlator (Invariant AD-28).
 * Correlates multi-metric co-occurring anomalies (thermal spike >85C, fan 0 RPM, dropped tokens)
 * on a single node within a 30-second window, collapsing them into a single deduplicated
 * root-cause incident: CRITICAL_COOLING_FAILURE.
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
  supporting_evidence: RawAnomalyEvent[];
  suppressed_count: number;
}

export class CompositeIncidentCorrelator {
  private readonly windowDurationMs: number;
  // Node -> active anomalies
  private nodeAnomalies: Map<string, RawAnomalyEvent[]> = new Map();
  // Node -> active composite incident
  private activeIncidents: Map<string, CompositeIncident> = new Map();

  constructor(options: { windowDurationSeconds?: number } = {}) {
    this.windowDurationMs = (options.windowDurationSeconds ?? 30) * 1000;
  }

  /**
   * Evaluates an incoming anomaly event. Returns a CompositeIncident if threshold correlation is met,
   * or null if the event is buffered or suppressed.
   */
  public ingestAnomaly(event: RawAnomalyEvent): CompositeIncident | null {
    const now = event.timestamp_ms;
    const existingIncident = this.activeIncidents.get(event.node_id);

    // If an incident already exists and is active within the 30-second window, suppress duplicates
    if (existingIncident && (now - existingIncident.created_at_ms <= this.windowDurationMs)) {
      existingIncident.suppressed_count += 1;
      existingIncident.supporting_evidence.push(event);
      return null;
    }

    // Prune stale anomalies outside the window
    let anomalies = this.nodeAnomalies.get(event.node_id) || [];
    anomalies = anomalies.filter((a) => (now - a.timestamp_ms) <= this.windowDurationMs);
    anomalies.push(event);
    this.nodeAnomalies.set(event.node_id, anomalies);

    // Check correlation signature for CRITICAL_COOLING_FAILURE:
    // Requires: THERMAL_SPIKE (>85C) + FAN_FAILURE (0 RPM) + DROPPED_TOKENS (>0)
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
        supporting_evidence: [...anomalies],
        suppressed_count: 0,
      };

      this.activeIncidents.set(event.node_id, incident);
      // Clear buffered anomalies after incident generation
      this.nodeAnomalies.delete(event.node_id);
      return incident;
    }

    return null;
  }

  public getActiveIncident(nodeId: string): CompositeIncident | null {
    return this.activeIncidents.get(nodeId) || null;
  }

  public clear(): void {
    this.nodeAnomalies.clear();
    this.activeIncidents.clear();
  }
}
