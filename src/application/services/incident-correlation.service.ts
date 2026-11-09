import type { NodeTelemetryPacketDTO } from '../../dto';
import type { IncidentsPort } from '../../ports/in/incidents.port';
import type { AnomalyObserverPort } from '../../ports/out/anomaly-observer.port';
import type { ClockPort } from '../../ports/out/clock.port';
import type { EventDispatcherPort } from '../../ports/out/event-dispatcher.port';
import type { MetricsPort } from '../../ports/out/metrics.port';
import {
  CompositeIncidentCorrelator,
  type CompositeIncident,
  type RawAnomalyEvent,
} from '../../domain/services/composite-incident-correlator';

/** Thermal spike threshold of AD-28 (strictly greater than). */
export const THERMAL_SPIKE_C = 85;

/**
 * Turns accepted telemetry into anomaly signals and feeds the correlator (AD-28):
 *   temperature_celsius > 85  -> THERMAL_SPIKE
 *   fan_rpm === 0             -> FAN_FAILURE        (only when the node reports fan_rpm)
 *   dropped_tokens > 0        -> DROPPED_TOKENS     (only when the node reports dropped_tokens)
 * Anomaly time is the SERVER clock at ingestion, so a node with a skewed or hostile timestamp cannot
 * move the correlator's per-node high-water mark. One `incident.created` audit event per new incident.
 */
export class IncidentCorrelationService implements AnomalyObserverPort, IncidentsPort {
  constructor(
    private readonly deps: { clock: ClockPort; events: EventDispatcherPort; metrics: MetricsPort },
    private readonly correlator: CompositeIncidentCorrelator = new CompositeIncidentCorrelator(),
  ) {}

  observe(events: readonly NodeTelemetryPacketDTO[]): void {
    const now = this.deps.clock.nowMs();
    for (const ev of events) {
      for (const anomaly of this.anomaliesOf(ev, now)) {
        const incident = this.correlator.ingestAnomaly(anomaly);
        if (incident) this.announce(incident);
      }
    }
    this.correlator.prune(now);
  }

  listActiveIncidents(): CompositeIncident[] {
    return this.correlator.listActiveIncidents(this.deps.clock.nowMs());
  }

  private anomaliesOf(ev: NodeTelemetryPacketDTO, now: number): RawAnomalyEvent[] {
    const out: RawAnomalyEvent[] = [];
    if (ev.temperature_celsius > THERMAL_SPIKE_C) {
      out.push({ node_id: ev.node_id, anomaly_type: 'THERMAL_SPIKE', timestamp_ms: now, value: ev.temperature_celsius });
    }
    if (ev.fan_rpm !== undefined && ev.fan_rpm === 0) {
      out.push({ node_id: ev.node_id, anomaly_type: 'FAN_FAILURE', timestamp_ms: now, value: 0 });
    }
    if (ev.dropped_tokens !== undefined && ev.dropped_tokens > 0) {
      out.push({ node_id: ev.node_id, anomaly_type: 'DROPPED_TOKENS', timestamp_ms: now, value: ev.dropped_tokens });
    }
    return out;
  }

  private announce(incident: CompositeIncident): void {
    this.deps.events.emit({
      eventType: 'incident.created',
      occurredAtMs: incident.created_at_ms,
      payload: {
        incident_id: incident.incident_id,
        incident_type: incident.incident_type,
        node_id: incident.node_id,
        severity: incident.severity,
        evidence_count: incident.supporting_evidence.length,
      },
    });
    this.deps.metrics.increment('incidents_created_total', { type: incident.incident_type }, 1);
  }
}
