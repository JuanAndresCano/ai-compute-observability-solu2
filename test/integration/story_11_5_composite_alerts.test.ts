import { describe, it, expect, beforeEach } from 'vitest';
import { CompositeIncidentCorrelator } from '../../src/domain/services/composite-incident-correlator';

describe('Story 11.5 [Flow D - Quality Gate & NFR]: Multi-Metric Composite Alert Correlation Engine (Invariant AD-28)', () => {
  let correlator: CompositeIncidentCorrelator;

  beforeEach(() => {
    correlator = new CompositeIncidentCorrelator({ windowDurationSeconds: 30 });
  });

  it('correlates thermal spike >85C, fan 0 RPM, and dropped tokens on ws-gpu-15 into a single CRITICAL_COOLING_FAILURE incident', () => {
    const baseTime = 1794185800000;

    // 1. Ingest thermal spike (> 85C)
    const inc1 = correlator.ingestAnomaly({
      node_id: 'ws-gpu-15',
      anomaly_type: 'THERMAL_SPIKE',
      timestamp_ms: baseTime + 1000,
      value: 88.5,
    });
    expect(inc1).toBeNull(); // No composite incident yet (missing other indicators)

    // 2. Ingest fan tachometer failure (0 RPM)
    const inc2 = correlator.ingestAnomaly({
      node_id: 'ws-gpu-15',
      anomaly_type: 'FAN_FAILURE',
      timestamp_ms: baseTime + 5000,
      value: 0,
    });
    expect(inc2).toBeNull(); // Still pending dropped tokens

    // 3. Ingest dropped token heartbeats
    const inc3 = correlator.ingestAnomaly({
      node_id: 'ws-gpu-15',
      anomaly_type: 'DROPPED_TOKENS',
      timestamp_ms: baseTime + 10000,
      value: 120,
    });

    // Correlation triggered!
    expect(inc3).not.toBeNull();
    expect(inc3!.incident_type).toBe('CRITICAL_COOLING_FAILURE');
    expect(inc3!.node_id).toBe('ws-gpu-15');
    expect(inc3!.severity).toBe('CRITICAL');
    expect(inc3!.supporting_evidence.length).toBe(3);

    // 4. Fire 4th anomaly on ws-gpu-15 within the 30-second window -> MUST BE SUPPRESSED to prevent alert storm
    const inc4 = correlator.ingestAnomaly({
      node_id: 'ws-gpu-15',
      anomaly_type: 'THERMAL_SPIKE',
      timestamp_ms: baseTime + 14000,
      value: 91.0,
    });

    expect(inc4).toBeNull(); // Suppressed!
    const active = correlator.getActiveIncident('ws-gpu-15');
    expect(active).not.toBeNull();
    expect(active!.suppressed_count).toBe(1);
    expect(active!.supporting_evidence.length).toBe(4);
  });
});
