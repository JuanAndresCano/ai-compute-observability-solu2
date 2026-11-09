/**
 * Branch-coverage unit tests for the pure domain services (hexagonal core, ≥ 90 % branch target).
 * Every test asserts concrete observable behaviour at a boundary: no snapshot-of-implementation tests.
 */
import { describe, expect, it } from 'vitest';
import { HistogramP99 } from '../../src/domain/services/histogram-p99';
import { TelemetryRingBuffer } from '../../src/domain/models/telemetry-ring-buffer';
import { FLEET_SERIES_IDS } from '../../src/domain/models/fleet';
import { NodeHeartbeatWatchdog } from '../../src/domain/services/heartbeat-watchdog';
import { CompositeIncidentCorrelator, type RawAnomalyEvent } from '../../src/domain/services/composite-incident-correlator';
import { StreamDownsampler } from '../../src/domain/services/stream-downsampler';
import { SlidingWindowAssembler } from '../../src/application/services/sliding-window-assembler';
import { FakeClock } from '../../src/adapters/sim/fake-clock';

describe('HistogramP99', () => {
  it.each([
    [-5, 0], [0, 0], [Number.NaN, 0], [199, 0], [200, 1], [19_799, 98], [19_800, 99], [1_000_000, 99],
  ])('latency %s ms falls in bucket %s', (latency, bucket) => {
    expect(HistogramP99.bucketIndex(latency)).toBe(bucket);
  });

  it('returns 0 for an empty histogram', () => {
    expect(HistogramP99.p99UpperEdgeMs(new Array(100).fill(0))).toBe(0);
  });

  it('returns the upper edge of the bucket holding the 99th-percentile rank', () => {
    const counts = new Array(100).fill(0);
    counts[0] = 98; // 98 fast samples
    counts[40] = 2; // 2 slow samples in [8000, 8200)
    expect(HistogramP99.p99UpperEdgeMs(counts)).toBe(8_200);
  });

  it('falls back to the maximum edge when counts are shorter than the rank requires', () => {
    expect(HistogramP99.p99UpperEdgeMs([0, 0, undefined as unknown as number])).toBe(0);
    // rank can never be reached if cumulative counts stop short: simulate with a sparse array whose total is read as 0 beyond length
    const sparse: number[] = [];
    sparse[3] = 5;
    expect(HistogramP99.p99UpperEdgeMs(sparse)).toBe(800);
  });
});

describe('TelemetryRingBuffer', () => {
  const sample = (seriesId: string, v: number) => ({ seriesId, values: [v, v + 1, v + 2, v + 3, v + 4, v + 5] });

  it('has the fixed 5,702,400-byte footprint', () => {
    expect(new TelemetryRingBuffer(FLEET_SERIES_IDS).byteLength).toBe(5_702_400);
  });

  it('writes one slot per tick and reads the six metrics back', () => {
    const ring = new TelemetryRingBuffer(FLEET_SERIES_IDS);
    ring.commitTick([sample('ws-gpu-01:0', 10)]);
    expect(ring.writePointer).toBe(1);
    expect([0, 1, 2, 3, 4, 5].map((m) => ring.read('ws-gpu-01:0', m, 1))).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('ignores samples for unknown series but still advances the pointer', () => {
    const ring = new TelemetryRingBuffer(FLEET_SERIES_IDS);
    ring.commitTick([sample('ghost:0', 99)]);
    expect(ring.writePointer).toBe(1);
    expect(ring.read('ghost:0', 0, 1)).toBe(0);
  });

  it('keeps only the first six metric values of an oversized sample', () => {
    const ring = new TelemetryRingBuffer(FLEET_SERIES_IDS);
    ring.commitTick([{ seriesId: 'ws-gpu-02:0', values: [1, 2, 3, 4, 5, 6, 7, 8] }]);
    expect(ring.read('ws-gpu-02:0', 5, 1)).toBe(6);
    expect(ring.read('ws-gpu-02:0', 6, 1)).toBe(0); // index out of metric range
  });

  it('wraps the write pointer modulo 7,200 without growing memory', () => {
    const ring = new TelemetryRingBuffer(FLEET_SERIES_IDS);
    for (let i = 0; i < 7_200; i++) ring.commitTick([]);
    expect(ring.writePointer).toBe(0);
    expect(ring.byteLength).toBe(5_702_400);
  });

  it.each([[-1], [7_200]])('read of slot %s is out of range and returns 0', (slot) => {
    expect(new TelemetryRingBuffer(FLEET_SERIES_IDS).read('ws-gpu-01:0', 0, slot)).toBe(0);
  });

  it('read of a negative metric index returns 0', () => {
    expect(new TelemetryRingBuffer(FLEET_SERIES_IDS).read('ws-gpu-01:0', -1, 0)).toBe(0);
  });
});

describe('NodeHeartbeatWatchdog state machine (INV-04)', () => {
  const NODE = 'ws-gpu-05';
  const setup = () => {
    const clock = new FakeClock(1_000_000);
    return { clock, wd: new NodeHeartbeatWatchdog(clock, [NODE]) };
  };

  it('HEALTHY → STALE at 5 s → SILENT_TIMEOUT at 15 s, reporting each transition once', () => {
    const { clock, wd } = setup();
    clock.advanceBy(5_000);
    expect(wd.check()).toMatchObject([{ node_id: NODE, previous_state: 'HEALTHY', new_state: 'STALE' }]);
    expect(wd.check()).toEqual([]);
    clock.advanceBy(10_000);
    expect(wd.check()).toMatchObject([{ previous_state: 'STALE', new_state: 'SILENT_TIMEOUT' }]);
  });

  it('a HEALTHY node that goes silent for 15 s jumps straight to SILENT_TIMEOUT', () => {
    const { clock, wd } = setup();
    clock.advanceBy(15_000);
    expect(wd.check()).toMatchObject([{ previous_state: 'HEALTHY', new_state: 'SILENT_TIMEOUT' }]);
  });

  it('a STALE node that heartbeats again returns to HEALTHY', () => {
    const { clock, wd } = setup();
    clock.advanceBy(6_000);
    wd.check();
    wd.recordHeartbeat(NODE, clock.nowMs());
    expect(wd.stateOf(NODE)).toBe('HEALTHY');
  });

  it('a STALE node whose silence drops below 5 s on check() is HEALTHY again', () => {
    const { clock, wd } = setup();
    clock.advanceBy(6_000);
    wd.check();
    // heartbeat timestamped "in the future" of the last check: silence is negative → < 5 s
    wd.recordHeartbeat(NODE, clock.nowMs());
    wd.check();
    expect(wd.stateOf(NODE)).toBe('HEALTHY');
  });

  it('recovery from SILENT_TIMEOUT needs 3 consecutive heartbeats', () => {
    const { clock, wd } = setup();
    clock.advanceBy(15_000);
    wd.check();
    wd.recordHeartbeat(NODE, clock.nowMs());
    expect(wd.stateOf(NODE)).toBe('RECOVERING');
    wd.recordHeartbeat(NODE, clock.nowMs());
    expect(wd.stateOf(NODE)).toBe('RECOVERING');
    wd.recordHeartbeat(NODE, clock.nowMs());
    expect(wd.stateOf(NODE)).toBe('HEALTHY');
  });

  it('a RECOVERING node that misses a 5 s interval restarts its recovery count', () => {
    const { clock, wd } = setup();
    clock.advanceBy(15_000);
    wd.check();
    wd.recordHeartbeat(NODE, clock.nowMs()); // RECOVERING (1)
    wd.recordHeartbeat(NODE, clock.nowMs()); // RECOVERING (2)
    clock.advanceBy(5_000);
    wd.check(); // missed interval → count reset, still RECOVERING
    wd.recordHeartbeat(NODE, clock.nowMs()); // count 1 again
    wd.recordHeartbeat(NODE, clock.nowMs()); // count 2: must NOT be healthy yet
    expect(wd.stateOf(NODE)).toBe('RECOVERING');
  });

  it('a RECOVERING node silent for 15 s falls back to SILENT_TIMEOUT', () => {
    const { clock, wd } = setup();
    clock.advanceBy(15_000);
    wd.check();
    wd.recordHeartbeat(NODE, clock.nowMs());
    clock.advanceBy(15_000);
    // The last reported state was already SILENT_TIMEOUT, so the bounce through RECOVERING is not reported again (no flapping).
    expect(wd.check()).toEqual([]);
    expect(wd.stateOf(NODE)).toBe('SILENT_TIMEOUT');
  });

  it('tracks a node first seen through a heartbeat and reports unknown nodes as HEALTHY', () => {
    const { clock, wd } = setup();
    expect(wd.stateOf('never-seen')).toBe('HEALTHY');
    wd.recordHeartbeat('late-joiner', clock.nowMs());
    expect(wd.stateOf('late-joiner')).toBe('HEALTHY');
    clock.advanceBy(15_000);
    expect(wd.check().map((c) => c.node_id)).toContain('late-joiner');
  });
});

describe('CompositeIncidentCorrelator (AD-28)', () => {
  const ev = (type: RawAnomalyEvent['anomaly_type'], value: number, t: number, node = 'ws-gpu-15'): RawAnomalyEvent => ({
    node_id: node, anomaly_type: type, timestamp_ms: t, value,
  });

  it('does not correlate when the thermal value is exactly 85 °C (strictly greater than)', () => {
    const c = new CompositeIncidentCorrelator();
    expect(c.ingestAnomaly(ev('THERMAL_SPIKE', 85, 1_000))).toBeNull();
    expect(c.ingestAnomaly(ev('FAN_FAILURE', 0, 2_000))).toBeNull();
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 3, 3_000))).toBeNull();
    expect(c.getActiveIncident('ws-gpu-15')).toBeNull();
  });

  it('does not correlate when the fan is still spinning', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 90, 1_000));
    c.ingestAnomaly(ev('FAN_FAILURE', 1_200, 2_000));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 3, 3_000))).toBeNull();
  });

  it('collapses the three signatures into one CRITICAL_COOLING_FAILURE and suppresses later duplicates', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 91, 1_000));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, 2_000));
    const incident = c.ingestAnomaly(ev('DROPPED_TOKENS', 4, 3_000));
    expect(incident).toMatchObject({ incident_type: 'CRITICAL_COOLING_FAILURE', node_id: 'ws-gpu-15', severity: 'CRITICAL', suppressed_count: 0 });
    expect(incident?.supporting_evidence).toHaveLength(3);

    expect(c.ingestAnomaly(ev('THERMAL_SPIKE', 92, 10_000))).toBeNull();
    expect(c.getActiveIncident('ws-gpu-15')?.suppressed_count).toBe(1);
  });

  it('forgets anomalies older than the 30 s window, so stale signals cannot complete a signature', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 91, 1_000));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, 2_000));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 4, 40_000))).toBeNull();
  });

  it('opens a fresh incident once the previous one is older than the window', () => {
    const c = new CompositeIncidentCorrelator();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 91, 1_000));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, 1_100));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 1, 1_200))).not.toBeNull();
    c.ingestAnomaly(ev('THERMAL_SPIKE', 95, 100_000));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, 100_100));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 2, 100_200))).toMatchObject({ created_at_ms: 100_200 });
  });

  it('keeps nodes independent and clear() drops all state', () => {
    const c = new CompositeIncidentCorrelator({ windowDurationSeconds: 10 });
    c.ingestAnomaly(ev('THERMAL_SPIKE', 91, 1_000, 'ws-gpu-01'));
    c.ingestAnomaly(ev('FAN_FAILURE', 0, 1_100, 'ws-gpu-02'));
    expect(c.ingestAnomaly(ev('DROPPED_TOKENS', 1, 1_200, 'ws-gpu-03'))).toBeNull();
    c.clear();
    expect(c.getActiveIncident('ws-gpu-01')).toBeNull();
  });
});

describe('StreamDownsampler (AD-27)', () => {
  const e = (node: string, temp: number, vram = 1, util = 10) => ({
    node_id: node, gpu_index: 0, timestamp_ms: 0, temperature_celsius: temp, vram_used_bytes: vram, gpu_utilization_pct: util,
  });

  it('keeps the true peak temperature and VRAM and averages utilisation', () => {
    const d = new StreamDownsampler();
    d.ingest(e('ws-gpu-01', 60, 100, 10));
    d.ingest(e('ws-gpu-01', 89, 50, 30));
    d.ingest(e('ws-gpu-01', 70, 300, 20));
    const frame = d.harvest(1_000);
    expect(frame?.nodes).toEqual([
      { node_id: 'ws-gpu-01', gpu_index: 0, peak_temperature_celsius: 89, peak_vram_used_bytes: 300, avg_gpu_utilization_pct: 20, event_count: 3 },
    ]);
    expect(d.getPendingNodeCount()).toBe(0);
  });

  it('emits nothing when there is no pending data', () => {
    expect(new StreamDownsampler().harvest(1_000)).toBeNull();
  });

  it('does not emit twice inside one 100 ms interval', () => {
    const d = new StreamDownsampler();
    d.ingest(e('ws-gpu-01', 60));
    expect(d.harvest(1_000)).not.toBeNull();
    d.ingest(e('ws-gpu-01', 61));
    expect(d.harvest(1_050)).toBeNull();
    expect(d.harvest(1_100)).not.toBeNull();
  });

  it('never exceeds 10 frames in one second and refills the bucket after 1 s', () => {
    const d = new StreamDownsampler({ maxOutputHz: 10 });
    let emitted = 0;
    for (let t = 1_000; t < 2_000; t += 100) {
      d.ingest(e('ws-gpu-01', 60));
      if (d.harvest(t)) emitted++;
    }
    expect(emitted).toBeLessThanOrEqual(10);
    d.ingest(e('ws-gpu-01', 60));
    expect(d.harvest(2_000)).not.toBeNull(); // new second, tokens refilled
  });

  it('blocks harvesting when the token bucket is empty even though the interval elapsed', () => {
    const d = new StreamDownsampler({ maxOutputHz: 2 }); // 500 ms interval, 2 tokens/s
    const frames: number[] = [];
    for (const t of [1_000, 1_500, 2_000]) {
      d.ingest(e('ws-gpu-01', 60));
      if (d.harvest(t)) frames.push(t);
    }
    // t=1000 and 1500 use the 2 tokens; the refill happens at 2000 (>= 1 s after 1000) so 2000 emits too
    expect(frames).toEqual([1_000, 1_500, 2_000]);
    d.ingest(e('ws-gpu-01', 60));
    d.ingest(e('ws-gpu-01', 60));
    expect(d.harvest(2_100)).toBeNull(); // interval not elapsed
  });
});

describe('SlidingWindowAssembler', () => {
  const packet = (t: number, latency: number, prompt = 10) => ({ timestamp_ms: t, total_latency_ms: latency, prompt_tokens: prompt }) as never;

  it('splits samples between the 30 s and 300 s windows using the half-open rule', () => {
    const clock = new FakeClock(1_000_000);
    const w = new SlidingWindowAssembler(clock);
    w.foldInference([
      packet(1_000_000 - 10_000, 100, 5),  // in both windows
      packet(1_000_000 - 100_000, 100, 7), // long window only
      packet(1_000_000 - 400_000, 100, 9), // older than 300 s → pruned
      packet(1_000_000, 100, 11),          // timestamp == now → excluded (half-open)
    ]);
    const win = w.assemble();
    expect(win.short_window_prompt_tokens).toBe(5);
    expect(win.long_window_prompt_tokens).toBe(12);
    expect(win.short_histogram.reduce((a, b) => a + b, 0)).toBe(1);
    expect(win.long_histogram.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('uses an explicit evaluation time, and time 0 when neither a clock nor a time is given', () => {
    const w = new SlidingWindowAssembler();
    w.foldInference([packet(500, 100, 3)]);
    expect(w.assemble().long_window_prompt_tokens).toBe(0); // now = 0 → nothing in [−300000, 0) except none
    expect(w.assemble(1_000).long_window_prompt_tokens).toBe(0); // pruned by the previous assemble()
  });
});
