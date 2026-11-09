/**
 * Story 11.5 / AD-28: behaviours the happy-path test does not cover. Pure domain, deterministic timestamps, no timers.
 * Each test names the defect it guards against (found in a human review of the correlator).
 */
import { describe, expect, it } from 'vitest';
import { CompositeIncidentCorrelator, MAX_EVIDENCE_PER_INCIDENT, type AnomalyType } from '../../src/domain/services/composite-incident-correlator';

const NODE = 'ws-gpu-15';
const T = 1_794_185_800_000;
const ev = (type: AnomalyType, value: number, t: number, node = NODE) => ({ node_id: node, anomaly_type: type, timestamp_ms: t, value });
const trigger = (c: CompositeIncidentCorrelator, t = T) => {
  c.ingestAnomaly(ev('THERMAL_SPIKE', 88.5, t));
  c.ingestAnomaly(ev('FAN_FAILURE', 0, t));
  return c.ingestAnomaly(ev('DROPPED_TOKENS', 120, t));
};

describe('Annex BDD (Story 11.5): simultaneous anomalies on ws-gpu-15', () => {
  it('4 anomaly events at the same millisecond create exactly one CRITICAL_COOLING_FAILURE and suppress the duplicate', () => {
    const c = new CompositeIncidentCorrelator();
    const results = [
      c.ingestAnomaly(ev('THERMAL_SPIKE', 88.5, T)),
      c.ingestAnomaly(ev('FAN_FAILURE', 0, T)),
      c.ingestAnomaly(ev('DROPPED_TOKENS', 120, T)),
      c.ingestAnomaly(ev('THERMAL_SPIKE', 91, T)),
    ];
    const created = results.filter((r) => r !== null);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ incident_type: 'CRITICAL_COOLING_FAILURE', node_id: NODE });
    expect(created[0]!.supporting_evidence.slice(0, 3).map((e) => e.anomaly_type)).toEqual(['THERMAL_SPIKE', 'FAN_FAILURE', 'DROPPED_TOKENS']);
    expect(c.getActiveIncident(NODE)!.suppressed_count).toBe(1);
  });

  it('works with the 15-second window of the BDD wording as well as the 30-second invariant', () => {
    const c = new CompositeIncidentCorrelator({ windowDurationSeconds: 15 });
    c.ingestAnomaly(ev('THERMAL_SPIKE', 88.5, T));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T + 7_000));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 120, T + 14_000))).not.toBeNull();

    const late = new CompositeIncidentCorrelator({ windowDurationSeconds: 15 });
    late.ingestAnomaly(ev('THERMAL_SPIKE', 88.5, T));
    late.ingestAnomaly(ev('FAN_FAILURE', 0, T + 7_000));
    expect(late.ingestAnomaly(ev('DROPPED_TOKENS', 120, T + 16_000))).toBeNull(); // thermal is 16 s old: outside the window
  });
});

describe('memory stays bounded under a storm of suppressed duplicates', () => {
  it(`caps evidence at ${MAX_EVIDENCE_PER_INCIDENT} while still counting every suppressed alert`, () => {
    const c = new CompositeIncidentCorrelator();
    trigger(c);
    for (let i = 0; i < 10_000; i++) c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T + 1 + (i % 1000)));
    const incident = c.getActiveIncident(NODE)!;
    expect(incident.supporting_evidence.length).toBe(MAX_EVIDENCE_PER_INCIDENT);
    expect(incident.suppressed_count).toBe(10_000);
  });

  it('prune() releases expired incidents, stale buffers and bookkeeping', () => {
    const c = new CompositeIncidentCorrelator();
    trigger(c);
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T, 'ws-gpu-01')); // a lone buffered anomaly on another node
    c.prune(T + 31_000);
    expect(c.getActiveIncident(NODE)).toBeNull();
    expect(c.listActiveIncidents()).toEqual([]);
    // a fresh signature now creates a NEW incident instead of being swallowed by stale state
    expect(trigger(c, T + 40_000)).toMatchObject({ created_at_ms: T + 40_000 });
  });
});

describe('incident lifetime', () => {
  it('getActiveIncident(now) no longer reports an incident that has been silent for a full window', () => {
    const c = new CompositeIncidentCorrelator();
    trigger(c);
    expect(c.getActiveIncident(NODE, T + 30_000)).not.toBeNull(); // exactly the window: still active (inclusive)
    expect(c.getActiveIncident(NODE, T + 30_001)).toBeNull();
    expect(c.listActiveIncidents(T + 30_001)).toEqual([]);
  });

  it('a sustained failure keeps ONE incident alive (the window slides with the last related anomaly)', () => {
    const c = new CompositeIncidentCorrelator();
    const first = trigger(c);
    let created = 0;
    for (let t = T + 10_000; t <= T + 120_000; t += 10_000) {
      if (c.ingestAnomaly(ev('THERMAL_SPIKE', 92, t))) created++;
    }
    expect(created).toBe(0);
    expect(c.getActiveIncident(NODE, T + 120_000)!.incident_id).toBe(first!.incident_id);
  });

  it('after a full silent window a new signature opens a second incident', () => {
    const c = new CompositeIncidentCorrelator();
    const first = trigger(c);
    const second = trigger(c, T + 31_000);
    expect(second).not.toBeNull();
    expect(second!.incident_id).not.toBe(first!.incident_id);
  });
});

describe('out-of-order timestamps', () => {
  it('accepts a late event that is still inside the window and completes the signature', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 88.5, T + 10_000));
    c.ingestAnomaly(ev('DROPPED_TOKENS', 5, T + 12_000));
    expect(c.ingestAnomaly(ev('FAN_FAILURE', 0, T + 5_000))).not.toBeNull(); // arrived last, happened earlier, 7 s before the newest
  });

  it('ignores an event older than the window relative to the newest one (no negative-age bypass)', () => {
    const c = new CompositeIncidentCorrelator();
    trigger(c, T + 60_000);
    const before = c.getActiveIncident(NODE)!.suppressed_count;
    expect(c.ingestAnomaly(ev('THERMAL_SPIKE', 95, T))).toBeNull(); // 60 s in the past
    expect(c.getActiveIncident(NODE)!.suppressed_count).toBe(before); // not counted as a duplicate of the live incident
  });

  it('a stale event cannot complete a signature either', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T + 100_000));
    c.ingestAnomaly(ev('DROPPED_TOKENS', 5, T + 100_000));
    expect(c.ingestAnomaly(ev('FAN_FAILURE', 0, T))).toBeNull();
  });
});

describe('signature boundaries and isolation', () => {
  it.each([
    ['thermal exactly 85.0', ev('THERMAL_SPIKE', 85.0, T)],
    ['thermal 84.99', ev('THERMAL_SPIKE', 84.99, T)],
  ])('%s is not a thermal spike (strictly greater than 85)', (_n, thermal) => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(thermal);
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 9, T))).toBeNull();
  });

  it('thermal 85.01 is', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 85.01, T));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 1, T))).not.toBeNull();
  });

  it.each([[1], [300], [0.5]])('a fan at %s RPM is not a failure', (rpm) => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T));
    c.ingestAnomaly(ev('FAN_FAILURE', rpm, T));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 9, T))).toBeNull();
  });

  it('zero dropped tokens is not an anomaly signal', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 0, T))).toBeNull();
  });

  it('signals on different nodes never combine; each node gets its own incident', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T, 'ws-gpu-01'));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, T, 'ws-gpu-02'));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 9, T, 'ws-gpu-03'))).toBeNull();

    expect(trigger(c)).toMatchObject({ node_id: NODE });
    const a = c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T + 1, 'ws-gpu-07'));
    expect(a).toBeNull();
    expect(c.listActiveIncidents().map((i) => i.node_id)).toEqual([NODE]);
  });

  it('LATENCY_BREACH events do not contribute to the cooling signature', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, T));
    c.ingestAnomaly(ev('LATENCY_BREACH', 9_000, T));
    expect(c.ingestAnomaly(ev('FAN_FAILURE', 0, T))).toBeNull();
  });
});
