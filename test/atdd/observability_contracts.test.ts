/**
 * Red-phase ATDD suite for Module 11 (AI Infrastructure Observability Console).
 * Source of truth: planning/detailed-design/contracts.md v1.1 (+ AMD-14 pending confirmation).
 *
 * EVERY test here must fail today with NotImplementedError (interface stubs, no production logic) and must turn
 * green only when the contract is really implemented. `npm run test:atdd:guard` enforces both.
 *
 * Tag legend: [C1-*] ingestMetricBatch, [C2-*] evaluateAlertRule, [C3-*] buildUtilizationReport, [W-*] heartbeat
 * watchdog (AD-04), [X-*] cross-cutting. Titles that start with `test_` are the names bound in the Invariant
 * Binding Table (contracts.md section 3).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Database } from 'better-sqlite3';
import { createWorld, type World } from '../support/world';
import { expectContractError } from '../support/assert';
import { failingTelemetryRepo, failingAlertRepo, failingRollupRepo } from '../support/faults';
import { assertExplanation } from '../fixtures/explain_assert';
import { fingerprint, count, traceSql } from '../fixtures/db';
import { T0, newClock } from '../fixtures/fake_clock';
import { seedRollups } from '../fixtures/rollups';
import { GPU_SERIES, TOKEN_RULE, windowOf, WS_VRAM_BYTES } from '../fixtures/sim_telemetry';
import { NODE_IDS, SILENT_NODE } from '../fixtures/seed_fleet';
import { TelemetryRingBuffer } from '../../src/domain/models/telemetry-ring-buffer';
import { BucketDecimator } from '../../src/domain/services/bucket-decimator';
import { HistogramP99 } from '../../src/domain/services/histogram-p99';
import { AnomalyDetectionEngine } from '../../src/domain/services/anomaly-detector';
import { NodeHeartbeatWatchdog } from '../../src/domain/services/heartbeat-watchdog';
import type { AlertRuleDTO, MetricBatchDTO, ReportQueryDTO, SlidingWindowDTO } from '../../src/dto';

const SERIES_IDS = GPU_SERIES.map((s) => `${s.node_id}:${s.gpu_index}`);
const RING_BYTES = 33 * 6 * 7200 * 4; // 5,702,400
const HOUR_MS = 3_600_000;
const CYCLE_MS = 5000;
const RULE = 'TOKEN_SPIKE_AND_LATENCY_BREACH';

// ----------------------------------------------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------------------------------------------

/** Everything observable from outside: persisted state, emitted audit events, metrics, UI dispatches. */
function snapshot(w: World) {
  return { db: fingerprint(w.db), events: w.events.events.length, metrics: w.metrics.calls.length, ui: w.ui.ticks.length };
}
function expectNoSideEffects(w: World, before: ReturnType<typeof snapshot>) {
  expect(fingerprint(w.db), 'database must be unchanged').toBe(before.db);
  expect(w.events.events.length, 'no audit event may be emitted').toBe(before.events);
  expect(w.metrics.calls.length, 'no metric may be incremented').toBe(before.metrics);
  expect(w.ui.ticks.length, 'no UI dispatch may happen').toBe(before.ui);
}

/** Advance 250 ms and ingest one event of a node no test inspects, which closes the previous decimation window. */
async function flush(w: World) {
  w.clock.advanceBy(250);
  await w.sut.ingest.ingestMetricBatch(w.sim.batch(1, w.clock.nowMs(), { events: [w.sim.packet({ node_id: 'ws-gpu-31', timestamp_ms: w.clock.nowMs() })] }));
}
const bucketRow = (db: Database, node: string, gpu: number, start: number) =>
  db.prepare(`SELECT temperature_min AS tmin, temperature_max AS tmax, temperature_avg AS tavg, event_count AS n FROM telemetry_buckets WHERE node_id = ? AND gpu_index = ? AND bucket_start_ms = ?`).get(node, gpu, start);
const alertRows = (db: Database) => db.prepare(`SELECT * FROM operational_alerts ORDER BY triggered_at_ms, rowid`).all() as Record<string, any>[];
const activeAlerts = (db: Database) => alertRows(db).filter((r) => r.resolved_at_ms === null);

/** Baseline 1,200 tok/s over the 270 s before the short window (324,000 tokens); current 13,440 tok/s over 30 s (403,200); P99 = 9,600 ms. */
const breachWindow = (): SlidingWindowDTO => windowOf({ shortBuckets: { 5: 98, 47: 2 }, longBuckets: { 5: 298, 47: 2 }, shortTokens: 403_200, longTokens: 727_200 });
/** Current rate equals baseline (1,200 tok/s), P99 = 1,200 ms. */
const calmWindow = (): SlidingWindowDTO => windowOf({ shortBuckets: { 5: 100 }, longBuckets: { 5: 400 }, shortTokens: 36_000, longTokens: 360_000 });
const evaluate = (w: World, window: SlidingWindowDTO, rule: AlertRuleDTO = TOKEN_RULE) => w.sut.alertEvaluation.evaluateAlertRule(rule, window);

/** Window with an explicit ratio and P99 bucket: baseline fixed at 1,200 tok/s, so current = ratio x 1,200. */
function ratioWindow(currentTps: number, slowBucket: number): SlidingWindowDTO {
  const S = currentTps * 30;
  const L = S + 1200 * 270;
  return windowOf({ shortBuckets: { 5: 98, [slowBucket]: 2 }, longBuckets: { 5: 298, [slowBucket]: 2 }, shortTokens: S, longTokens: L });
}

const reportQuery = (over: Partial<ReportQueryDTO> = {}): ReportQueryDTO => ({
  query_id: '00000000-0000-4000-b000-000000000001',
  from_timestamp_ms: T0 - 168 * HOUR_MS,
  to_timestamp_ms: T0,
  academic_subjects: ['ALL'],
  ...over,
});
const seeded = (opts?: { outageHours?: number; zeroBusy?: boolean }) => {
  const w = createWorld();
  seedRollups(w.db, T0 / 1000, opts);
  return w;
};

// ================================================================================================================
// OPERATION 1 - ingestMetricBatch
// ================================================================================================================
describe('Operation 1: ingestMetricBatch (contracts.md Op1)', () => {
  describe('Happy path (Q holds)', () => {
    it('[C1-Q1a] a valid 1,250-event batch is fully accepted and described exactly', async () => {
      const w = createWorld();
      const r = await w.sut.ingest.ingestMetricBatch(w.sim.batch(1250, w.clock.nowMs()));
      expect(r.accepted_count).toBe(1250);
      expect(r.dropped_count).toBe(0);
      expect(r.ingested_at_ms).toBe(T0);
      expect(r.decimation_bucket_id).toBe(`BUCKET-${T0}`);
    });

    it('[C1-Q1b] decimation_bucket_id names the half-open 250 ms window [start, start + 250)', async () => {
      const w = createWorld();
      w.clock.advanceBy(249);
      const a = await w.sut.ingest.ingestMetricBatch(w.sim.batch(1, w.clock.nowMs()));
      w.clock.advanceBy(1);
      const b = await w.sut.ingest.ingestMetricBatch(w.sim.batch(1, w.clock.nowMs()));
      expect(a.decimation_bucket_id).toBe(`BUCKET-${T0}`);
      expect(b.decimation_bucket_id).toBe(`BUCKET-${T0 + 250}`);
      expect(b.ingested_at_ms).toBe(T0 + 250);
    });

    it('[C1-Q2a] when the 250 ms window closes, min/max/avg/count of its events are committed', async () => {
      const w = createWorld();
      const events = [50, 70, 60].map((t) => w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: T0, temperature_celsius: t }));
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(3, T0, { events }));
      expect(count(w.db, 'telemetry_buckets'), 'window still open: nothing committed yet').toBe(0);
      await flush(w);
      expect(bucketRow(w.db, 'ws-gpu-05', 0, T0)).toEqual({ tmin: 50, tmax: 70, tavg: 60, n: 3 });
      expect(count(w.db, 'telemetry_buckets'), 'the flush event belongs to the new, still open window').toBe(1);
    });

    it('[C1-Q2b] two batches carrying the same (node, gpu, bucket) leave exactly one persisted row', async () => {
      const w = createWorld();
      const one = () => w.sim.batch(1, T0, { events: [w.sim.packet({ node_id: 'ws-gpu-07', timestamp_ms: T0 })] });
      await w.sut.ingest.ingestMetricBatch(one());
      await w.sut.ingest.ingestMetricBatch(one());
      await flush(w);
      const rows = w.db.prepare(`SELECT COUNT(*) AS n FROM telemetry_buckets WHERE node_id = 'ws-gpu-07'`).get();
      expect(rows).toEqual({ n: 1 });
    });

    it('[C1-Q2c] inference metrics are folded into the 100-bucket histogram (>= 20,000 ms in bucket 99) and the token counters', async () => {
      const w = createWorld();
      const lat = (total: number) => w.sim.inference({ timestamp_ms: T0, queue_duration_ms: total / 2, inference_duration_ms: total / 2 });
      const inference_metrics = [0, 199.9, 200, 19_999, 20_000, 35_000].map(lat);
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(1, T0, { inference_metrics: inference_metrics.map((p) => ({ ...p, timestamp_ms: T0 - 1 })) }));
      const win = w.sut.windows.assemble();
      expect(win.short_histogram[0]).toBe(2);
      expect(win.short_histogram[1]).toBe(1);
      expect(win.short_histogram[99]).toBe(3);
      expect(win.short_histogram.reduce((a, b) => a + b, 0)).toBe(6);
      expect(win.short_window_prompt_tokens).toBe(600);
      expect(win.long_window_prompt_tokens).toBe(600);
    });

    it('[C1-Q3a] one telemetry.batch.ingested event is emitted and no drop is counted', async () => {
      const w = createWorld();
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(1250, T0));
      const ev = w.events.ofType('telemetry.batch.ingested');
      expect(ev).toHaveLength(1);
      expect(ev[0]!.occurredAtMs).toBe(T0);
      expect(ev[0]!.payload).toMatchObject({ accepted_count: 1250, dropped_count: 0, decimation_bucket_id: `BUCKET-${T0}` });
      expect(w.metrics.total('telemetry_events_dropped_total')).toBe(0);
    });

    it('[C1-Q4] the result is explainable: AD-01 rule id, observed rate, capacity, window and free slots', async () => {
      const w = createWorld();
      const r = await w.sut.ingest.ingestMetricBatch(w.sim.batch(1250, T0));
      assertExplanation(r.explanation, {
        ruleId: 'AD-01-DECIMATION-4HZ',
        observed: { observed_rate: 1250, free_slots: 10_000 },
        thresholds: { buffer_capacity: 10_000, decimation_window_ms: 250 },
      });
    });
  });

  describe('Preconditions (P) violated -> typed error, zero mutations', () => {
    const bad = (label: string, mutate: (b: MetricBatchDTO, w: World) => void) => [label, mutate] as const;
    const invalid = [
      bad('temperature 120.1 C', (b) => void (b.events[1] = { ...b.events[1]!, temperature_celsius: 120.1 })),
      bad('temperature -20.1 C', (b) => void (b.events[1] = { ...b.events[1]!, temperature_celsius: -20.1 })),
      bad('node ws-gpu-00 (not registered)', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'ws-gpu-00' })),
      bad('node ws-gpu-32 (not registered)', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'ws-gpu-32' })),
      bad('node ws-gpu-5 (malformed)', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'ws-gpu-5' })),
      bad('node server-gpu-02', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'server-gpu-02' })),
      bad('workstation with gpu_index 1', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'ws-gpu-05', gpu_index: 1 })),
      bad('server-gpu-01 with gpu_index 2', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'server-gpu-01', gpu_index: 2, vram_total_bytes: 51_539_607_552 })),
      bad('vram_used above vram_total', (b) => void (b.events[1] = { ...b.events[1]!, vram_used_bytes: WS_VRAM_BYTES + 1 })),
      bad('vram_total 1 byte', (b) => void (b.events[1] = { ...b.events[1]!, vram_total_bytes: 1, vram_used_bytes: 0 })),
      bad('workstation reporting 48 GB', (b) => void (b.events[1] = { ...b.events[1]!, node_id: 'ws-gpu-05', vram_total_bytes: 51_539_607_552 })),
      bad('utilization 100.1 %', (b) => void (b.events[1] = { ...b.events[1]!, gpu_utilization_pct: 100.1 })),
      bad('utilization -0.1 %', (b) => void (b.events[1] = { ...b.events[1]!, gpu_utilization_pct: -0.1 })),
      bad('timestamp 0', (b) => void (b.events[1] = { ...b.events[1]!, timestamp_ms: 0 })),
      bad('timestamp -5', (b) => void (b.events[1] = { ...b.events[1]!, timestamp_ms: -5 })),
      bad('0 events', (b) => void (b.events = [])),
      bad('5,001 events', (b, w) => void (b.events = w.sim.events(5001, T0))),
      bad('inference request_id not a UUIDv4', (b, w) => void (b.inference_metrics = [{ ...w.sim.inference({ timestamp_ms: T0 }), request_id: 'not-a-uuid' }])),
      bad('inference prompt_tokens -1', (b, w) => void (b.inference_metrics = [{ ...w.sim.inference({ timestamp_ms: T0 }), prompt_tokens: -1 }])),
      bad('inference completion_tokens 1.5', (b, w) => void (b.inference_metrics = [{ ...w.sim.inference({ timestamp_ms: T0 }), completion_tokens: 1.5 }])),
      bad('inference total_latency != queue + inference', (b, w) => void (b.inference_metrics = [{ ...w.sim.inference({ timestamp_ms: T0 }), total_latency_ms: 999 }])),
      bad('inference queue_duration -1 ms', (b, w) => void (b.inference_metrics = [{ ...w.sim.inference({ timestamp_ms: T0 }), queue_duration_ms: -1, total_latency_ms: 399 }])),
      bad('5,001 inference metrics', (b, w) => void (b.inference_metrics = Array.from({ length: 5001 }, () => w.sim.inference({ timestamp_ms: T0 })))),
    ];
    it.each(invalid)('[C1-P1a] rejects %s with ERR_INVALID_TELEMETRY_PAYLOAD (422) and changes nothing', async (_label, mutate) => {
      const w = createWorld();
      const batch = w.sim.batch(3, T0);
      mutate(batch, w);
      const before = snapshot(w);
      await expectContractError(w.sut.ingest.ingestMetricBatch(batch), { code: 'ERR_INVALID_TELEMETRY_PAYLOAD', http: 422, retryable: false });
      expectNoSideEffects(w, before);
    });

    it('[C1-P1b] one invalid event in 1,250 rejects the whole batch: all-or-nothing', async () => {
      const w = createWorld();
      const batch = w.sim.batch(1250, T0);
      batch.events[1249] = { ...batch.events[1249]!, temperature_celsius: 500 };
      const before = snapshot(w);
      await expectContractError(w.sut.ingest.ingestMetricBatch(batch), { code: 'ERR_INVALID_TELEMETRY_PAYLOAD', http: 422, retryable: false });
      await flush(w);
      expect(count(w.db, 'telemetry_buckets'), 'none of the 1,249 valid events may be persisted').toBe(0);
      expect(w.events.events.length).toBe(before.events + 1); // only the flush batch is ingested
    });

    it('[C1-P1c] the boundary values themselves are valid (-20 C, 120 C, 0 %, 100 %, vram_used = vram_total, timestamp 1)', async () => {
      const w = createWorld();
      const mk = (over: object) => w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: 1, ...over });
      const events = [
        mk({ temperature_celsius: -20 }),
        mk({ temperature_celsius: 120 }),
        mk({ gpu_utilization_pct: 0 }),
        mk({ gpu_utilization_pct: 100 }),
        mk({ vram_used_bytes: WS_VRAM_BYTES }),
        w.sim.packet({ node_id: 'server-gpu-01', gpu_index: 1, timestamp_ms: 1 }),
        w.sim.packet({ node_id: 'ws-gpu-31', timestamp_ms: T0 }),
      ];
      const r = await w.sut.ingest.ingestMetricBatch(w.sim.batch(events.length, T0, { events }));
      expect(r.accepted_count).toBe(7);
      expect(r.dropped_count).toBe(0);
    });

    it('[C1-P2a] client_timestamp 5,001 ms ahead of the clock -> ERR_FUTURE_TIMESTAMP_DRIFT (400), nothing written', async () => {
      const w = createWorld();
      const before = snapshot(w);
      const batch = w.sim.batch(10, T0, { client_timestamp_ms: T0 + 5001 });
      const err = await expectContractError(w.sut.ingest.ingestMetricBatch(batch), { code: 'ERR_FUTURE_TIMESTAMP_DRIFT', http: 400, retryable: false });
      expect(err.body.message).toContain('5001');
      expectNoSideEffects(w, before);
    });

    it('[C1-P2b] client_timestamp exactly 5,000 ms ahead is accepted (boundary)', async () => {
      const w = createWorld();
      const r = await w.sut.ingest.ingestMetricBatch(w.sim.batch(10, T0, { client_timestamp_ms: T0 + 5000 }));
      expect(r.accepted_count).toBe(10);
      expect(r.dropped_count).toBe(0);
      expect(w.events.ofType('telemetry.batch.ingested')).toHaveLength(1);
    });

    it('[C1-P3a] with 0 of 10,000 slots free the batch is rejected with ERR_BUFFER_OVERFLOW (429, retryable) and nothing is written or counted', async () => {
      const w = createWorld();
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(5000, T0));
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(5000, T0));
      const before = snapshot(w);
      await expectContractError(w.sut.ingest.ingestMetricBatch(w.sim.batch(1, T0)), { code: 'ERR_BUFFER_OVERFLOW', http: 429, retryable: true });
      expectNoSideEffects(w, before);
      expect(w.metrics.total('telemetry_events_dropped_total'), 'a rejected batch is not a tail-drop').toBe(0);
    });

    it('[C1-Qfail] a storage failure -> ERR_DATABASE_UNAVAILABLE (503, retryable), transaction rolled back, nothing emitted', async () => {
      const w = createWorld({ telemetry: failingTelemetryRepo });
      const before = snapshot(w);
      await expectContractError(w.sut.ingest.ingestMetricBatch(w.sim.batch(1250, T0)), { code: 'ERR_DATABASE_UNAVAILABLE', http: 503, retryable: true });
      expectNoSideEffects(w, before);
    });
  });

  describe('Capacity rule (P3 partial): tail-drop with visible dropped_count (AMD-1)', () => {
    it('[C1-Q3b] 9,000 queued + 2,500 offered -> first 1,000 accepted, last 1,500 dropped and counted', async () => {
      const w = createWorld();
      const fill = (n: number) => w.sim.batch(n, T0, { events: Array.from({ length: n }, () => w.sim.packet({ node_id: 'ws-gpu-10', timestamp_ms: T0 })) });
      await w.sut.ingest.ingestMetricBatch(fill(5000));
      await w.sut.ingest.ingestMetricBatch(fill(4000));
      const events = [
        ...Array.from({ length: 1000 }, () => w.sim.packet({ node_id: 'ws-gpu-01', timestamp_ms: T0 })),
        ...Array.from({ length: 1500 }, () => w.sim.packet({ node_id: 'ws-gpu-02', timestamp_ms: T0 })),
      ];
      const r = await w.sut.ingest.ingestMetricBatch(w.sim.batch(2500, T0, { events }));
      expect(r.accepted_count).toBe(1000);
      expect(r.dropped_count).toBe(1500);
      expect(r.accepted_count + r.dropped_count).toBe(2500);
      expect(w.events.ofType('telemetry.batch.ingested').at(-1)!.payload).toMatchObject({ accepted_count: 1000, dropped_count: 1500 });
      expect(w.metrics.total('telemetry_events_dropped_total')).toBe(1500);
      assertExplanation(r.explanation, { ruleId: 'AD-01-DECIMATION-4HZ', observed: { observed_rate: 2500, free_slots: 1000 }, thresholds: { buffer_capacity: 10_000 } });
      await flush(w);
      expect(bucketRow(w.db, 'ws-gpu-01', 0, T0), 'the accepted head of the batch is persisted').toMatchObject({ n: 1000 });
      expect(bucketRow(w.db, 'ws-gpu-02', 0, T0), 'the dropped tail is not persisted').toBeUndefined();
    });
  });

  describe('Invariants (I) under repetition, concurrency and boundary', () => {
    it('test_ring_buffer_memory_remains_static_after_100k_events [C1-I1a]', () => {
      const ring = new TelemetryRingBuffer(SERIES_IDS);
      expect(ring.byteLength).toBe(RING_BYTES);
      const start = ring.writePointer;
      const TICKS = 100_000;
      for (let k = 1; k <= TICKS; k++) ring.commitTick(SERIES_IDS.map((seriesId) => ({ seriesId, values: [k, 0, 0, 0, 0, 0] })));
      expect(ring.byteLength, 'no reallocation while streaming').toBe(RING_BYTES);
      expect(ring.writePointer).toBe((start + TICKS) % 7200);
      expect(ring.read('server-gpu-01:1', 0, ring.writePointer), 'latest tick sits at the pointer').toBe(TICKS);
      expect(ring.read('ws-gpu-01:0', 0, (ring.writePointer + 1) % 7200), 'oldest retained tick is 7,199 ticks back').toBe(TICKS - 7199);
    });

    it('test_ingestion_enforces_4hz_dispatch_cap_under_5000_ev_storm [C1-I2]', () => {
      const w = createWorld();
      const dispatched: number[] = [];
      const dec = new BucketDecimator({ clock: w.clock, ring: new TelemetryRingBuffer(SERIES_IDS), onDispatch: () => dispatched.push(w.clock.nowMs()) });
      for (let step = 0; step < 300; step++) {
        dec.accumulate(w.sim.events(50, w.clock.nowMs())); // 50 events every 10 ms = 5,000 ev/s for 3 s
        w.clock.advanceBy(10);
      }
      for (let s = 0; s < 3; s++) {
        const inSecond = dispatched.filter((t) => t >= T0 + s * 1000 && t < T0 + (s + 1) * 1000);
        expect(inSecond.length, `second ${s}`).toBeLessThanOrEqual(4);
        expect(inSecond.length, `second ${s}: the UI is not starved`).toBeGreaterThanOrEqual(3);
      }
      for (let i = 1; i < dispatched.length; i++) expect(dispatched[i]! - dispatched[i - 1]!).toBeGreaterThanOrEqual(250);
    });

    it('test_server_gpu01_tracks_dual_gpus_independently_without_averaging [C1-I1b]', async () => {
      const w = createWorld();
      const events = [
        w.sim.packet({ node_id: 'server-gpu-01', gpu_index: 0, timestamp_ms: T0, temperature_celsius: 40 }),
        w.sim.packet({ node_id: 'server-gpu-01', gpu_index: 1, timestamp_ms: T0, temperature_celsius: 80 }),
      ];
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(2, T0, { events }));
      await flush(w);
      expect(bucketRow(w.db, 'server-gpu-01', 0, T0)).toMatchObject({ tavg: 40, n: 1 });
      expect(bucketRow(w.db, 'server-gpu-01', 1, T0)).toMatchObject({ tavg: 80, n: 1 });
      expect(new TelemetryRingBuffer(SERIES_IDS).byteLength, 'two series for the server, not one').toBe(RING_BYTES);
    });

    it('[C1-CON-a] replaying a batch_id is idempotent: accepted 0, dropped 0, no extra rows or counts', async () => {
      const w = createWorld();
      const batch = w.sim.batch(1, T0, { events: [w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: T0 })] });
      const first = await w.sut.ingest.ingestMetricBatch(batch);
      const replay = await w.sut.ingest.ingestMetricBatch(batch);
      expect(first.accepted_count).toBe(1);
      expect(replay.accepted_count).toBe(0);
      expect(replay.dropped_count).toBe(0);
      await flush(w);
      expect(bucketRow(w.db, 'ws-gpu-05', 0, T0)).toMatchObject({ n: 1 });
    });

    it('[C1-CON-b] two simultaneous batches for one series lose no update (200 events -> count 200)', async () => {
      const w = createWorld();
      const mk = () => w.sim.batch(100, T0, { events: Array.from({ length: 100 }, () => w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: T0 })) });
      const [a, b] = await Promise.all([w.sut.ingest.ingestMetricBatch(mk()), w.sut.ingest.ingestMetricBatch(mk())]);
      expect([a.accepted_count, b.accepted_count]).toEqual([100, 100]);
      await flush(w);
      expect(bucketRow(w.db, 'ws-gpu-05', 0, T0)).toMatchObject({ n: 200 });
    });

    it('[C1-TIME] windows are half-open: an ingest at +249 ms joins window T0, an ingest at +250 ms opens window T0+250', async () => {
      const w = createWorld();
      const one = () => w.sim.batch(1, w.clock.nowMs(), { events: [w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: w.clock.nowMs() })] });
      w.clock.advanceBy(249);
      await w.sut.ingest.ingestMetricBatch(one());
      w.clock.advanceBy(1);
      await w.sut.ingest.ingestMetricBatch(one());
      await flush(w); // closes T0+250
      expect(bucketRow(w.db, 'ws-gpu-05', 0, T0)).toMatchObject({ n: 1 });
      expect(bucketRow(w.db, 'ws-gpu-05', 0, T0 + 250)).toMatchObject({ n: 1 });
    });
  });

  describe('Mandatory Edge Case (FR-05, P0): 5,000 ev/s telemetry storm', () => {
    it('[C1-EDGE-a] a sustained storm keeps 4 Hz dispatch, static memory, zero drops and a bucket per series per window', async () => {
      const w = createWorld();
      const SECONDS = Number(process.env.STORM_SECONDS ?? 60); // CI nightly sets 900 (NFR-01: 15 minutes)
      const ringBefore = w.sut.ring.byteLength;
      let dropped = 0;
      for (let i = 0; i < SECONDS * 4; i++) {
        w.clock.setTo(T0 + i * 250);
        const r = await w.sut.ingest.ingestMetricBatch(w.sim.stormSlice(w.clock.nowMs()));
        expect(r.accepted_count).toBe(1250);
        dropped += r.dropped_count;
      }
      expect(dropped, 'a consumer that keeps up drops nothing').toBe(0);
      for (let s = 0; s < Math.min(SECONDS, 60); s++) expect(w.ui.inSecond(T0 + s * 1000).length, `second ${s}`).toBeLessThanOrEqual(4);
      expect(w.sut.ring.byteLength, 'memory is static during the storm').toBe(ringBefore);
      expect(w.sut.ring.byteLength).toBe(RING_BYTES);
      await flush(w);
      const windows = SECONDS * 4;
      expect(count(w.db, 'telemetry_buckets')).toBe(33 * windows);
      expect(w.metrics.total('telemetry_events_dropped_total')).toBe(0);
    }, Math.max(30_000, Number(process.env.STORM_SECONDS ?? 60) * 1000));

    it('[C1-EDGE-b] a stalled consumer: the 9th slice of 1,250 hits the 10,000 ceiling -> 429, and the next window accepts again', async () => {
      const w = createWorld();
      for (let i = 0; i < 8; i++) expect((await w.sut.ingest.ingestMetricBatch(w.sim.stormSlice(T0))).accepted_count).toBe(1250);
      const before = snapshot(w);
      await expectContractError(w.sut.ingest.ingestMetricBatch(w.sim.stormSlice(T0)), { code: 'ERR_BUFFER_OVERFLOW', http: 429, retryable: true });
      expectNoSideEffects(w, before);
      w.clock.advanceBy(250);
      const recovered = await w.sut.ingest.ingestMetricBatch(w.sim.stormSlice(w.clock.nowMs()));
      expect(recovered.accepted_count).toBe(1250);
      expect(recovered.dropped_count).toBe(0);
    });

    it('[C1-EDGE-c] critical alerts bypass decimation: with the queue saturated an anomaly is still evaluated and persisted', async () => {
      const w = createWorld();
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(5000, T0));
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(5000, T0));
      const r = await evaluate(w, breachWindow());
      expect(r.status).toBe('TRIGGERED');
      expect(activeAlerts(w.db)).toHaveLength(1);
    });
  });
});

// ================================================================================================================
// OPERATION 2 - evaluateAlertRule
// ================================================================================================================
describe('Operation 2: evaluateAlertRule (contracts.md Op2)', () => {
  describe('Happy path (Q holds)', () => {
    it('[C2-Q1a] a 11.2x token surge with P99 9,600 ms is TRIGGERED: one alert row, one audit event, one counter, exact payload', async () => {
      const w = createWorld();
      const r = await evaluate(w, breachWindow());
      expect(r.status).toBe('TRIGGERED');
      expect(r.rule_id).toBe(RULE);
      expect(r.evaluated_at_ms).toBe(T0);
      expect(r.evaluation_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const p = r.alert_payload!;
      expect(p).not.toBeNull();
      expect(p.alert_id).toMatch(/^ALT-[A-Z0-9]{8,16}$/);
      expect(p.observed_metrics.baseline_throughput_tok_per_sec).toBeCloseTo(1200, 6);
      expect(p.observed_metrics.current_throughput_tok_per_sec).toBeCloseTo(13_440, 6);
      expect(p.observed_metrics.spike_factor).toBeCloseTo(11.2, 6);
      expect(p.observed_metrics.p99_latency_ms).toBe(9600);
      expect(p.observed_metrics.sla_threshold_ms).toBe(8000);
      const rows = alertRows(w.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ alert_id: p.alert_id, node_id: 'CLUSTER', trigger_rule: RULE, status: 'TRIGGERED', triggered_at_ms: T0, resolved_at_ms: null });
      expect(rows[0]!.incident_key).toBe(`INC-TOKEN-P99-CLUSTER-${T0}`);
      expect(p.incident_key).toBe(rows[0]!.incident_key);
      expect(w.events.ofType('alert.anomaly.triggered')).toHaveLength(1);
      expect(w.metrics.total('alerts_emitted_total', { rule_id: RULE })).toBe(1);
    });

    it('[C2-Q1b] a calm window with no active alert is CLEARED and writes nothing', async () => {
      const w = createWorld();
      const before = snapshot(w);
      const r = await evaluate(w, calmWindow());
      expect(r.status).toBe('CLEARED');
      expect(r.alert_payload).toBeNull();
      expectNoSideEffects(w, before);
    });

    it('[C2-Q4a] the TRIGGERED decision cites AD-03 with the observed ratio, P99 and thresholds', async () => {
      const w = createWorld();
      const r = await evaluate(w, breachWindow());
      assertExplanation(r.explanation, {
        ruleId: 'AD-03-ANOMALY-EVAL',
        observedKeys: ['observed_baseline_tok_per_sec', 'observed_current_tok_per_sec', 'spike_ratio', 'observed_p99_latency_ms'],
        thresholds: { threshold_ms: 8000 },
      });
      expect(r.explanation.observed_values.spike_ratio).toBeCloseTo(11.2, 6);
    });

    it('[C2-Q4b] the SUPPRESSED_COLD_START decision cites the observed and required sample counts', async () => {
      const w = createWorld();
      const r = await evaluate(w, windowOf({ shortBuckets: { 47: 10 }, longBuckets: { 47: 49 }, shortTokens: 403_200, longTokens: 727_200 }));
      assertExplanation(r.explanation, { ruleId: 'AD-03-ANOMALY-EVAL', observed: { observed_samples: 49 }, thresholds: { required_samples: 50 } });
    });

    it('[C2-PURE] the engine is a pure function: same window, same verdict, with the exact derived metrics', () => {
      const engine = new AnomalyDetectionEngine();
      const a = engine.evaluate(TOKEN_RULE, breachWindow());
      const b = engine.evaluate(TOKEN_RULE, breachWindow());
      expect(a).toEqual(b);
      expect(a).toMatchObject({ suppressedColdStart: false, breach: true, observedSamples: 300, p99Ms: 9600 });
      expect(a.baselineTps).toBeCloseTo(1200, 6);
      expect(a.currentTps).toBeCloseTo(13_440, 6);
      expect(a.spikeRatio!).toBeCloseTo(11.2, 6);
    });
  });

  describe('Thresholds are exact: ratio >= 10.0 AND P99 > 8,000 ms (boundaries)', () => {
    it.each([
      ['ratio 10.0 and P99 9,600 -> breach (>= is inclusive)', ratioWindow(12_000, 47), true],
      ['ratio 9.99 and P99 9,600 -> no breach', ratioWindow(11_988, 47), false],
      ['ratio 11.2 and P99 exactly 8,000 ms (bucket 39) -> no breach (> is strict)', ratioWindow(13_440, 39), false],
      ['ratio 11.2 and P99 8,200 ms (bucket 40) -> breach', ratioWindow(13_440, 40), true],
      ['1 slow sample in 100 does not move P99 (ceil(0.99 x 100) = 99th sample is fast)', windowOf({ shortBuckets: { 5: 99, 47: 1 }, longBuckets: { 5: 299, 47: 1 }, shortTokens: 403_200, longTokens: 727_200 }), false],
    ])('[C2-Q2a] %s', async (_label, window, breach) => {
      const w = createWorld();
      const r = await evaluate(w, window);
      expect(r.status === 'TRIGGERED').toBe(breach);
      expect(activeAlerts(w.db)).toHaveLength(breach ? 1 : 0);
    });

    it('[C2-Q2b] baseline of 0 tokens/s with >= 50 samples: the spike is undefined, so no breach and no error', async () => {
      const w = createWorld();
      const r = await evaluate(w, windowOf({ shortBuckets: { 47: 100 }, longBuckets: { 47: 100 }, shortTokens: 403_200, longTokens: 403_200 }));
      expect(r.status).toBe('CLEARED');
      expect(activeAlerts(w.db)).toHaveLength(0);
    });

    it('[C2-I2a] HistogramP99.bucketIndex: 200 ms buckets, everything >= 20,000 ms in bucket 99', () => {
      expect([0, 199.999, 200, 7999.9, 8000, 19_999.9, 20_000, 1_000_000].map((ms) => HistogramP99.bucketIndex(ms))).toEqual([0, 0, 1, 39, 40, 99, 99, 99]);
    });

    it('[C2-I2b] HistogramP99.p99UpperEdgeMs is the upper edge of the bucket holding the ceil(0.99 N)-th sample; 0.0 when empty', () => {
      const hist = (m: Record<number, number>) => Array.from({ length: 100 }, (_, i) => m[i] ?? 0);
      expect(HistogramP99.p99UpperEdgeMs(hist({}))).toBe(0);
      expect(HistogramP99.p99UpperEdgeMs(hist({ 5: 100 }))).toBe(1200);
      expect(HistogramP99.p99UpperEdgeMs(hist({ 5: 99, 47: 1 }))).toBe(1200);
      expect(HistogramP99.p99UpperEdgeMs(hist({ 5: 98, 47: 2 }))).toBe(9600);
      expect(HistogramP99.p99UpperEdgeMs(hist({ 99: 1 }))).toBe(20_000);
    });
  });

  describe('Cold start (AD-03): a result status, not an error (AMD-2)', () => {
    it('test_cold_start_suppresses_anomaly_alarm_below_50_samples [C2-Q2c]', async () => {
      const w = createWorld();
      const before = snapshot(w);
      const r = await evaluate(w, windowOf({ shortBuckets: { 47: 10 }, longBuckets: { 47: 49 }, shortTokens: 403_200, longTokens: 727_200 }));
      expect(r.status).toBe('SUPPRESSED_COLD_START');
      expect(r.alert_payload).toBeNull();
      expectNoSideEffects(w, before);
    });

    it('[C2-Q2d] with exactly 50 samples the rule is evaluated', async () => {
      const w = createWorld();
      const r = await evaluate(w, windowOf({ shortBuckets: { 47: 10 }, longBuckets: { 47: 50 }, shortTokens: 403_200, longTokens: 727_200 }));
      expect(r.status).toBe('TRIGGERED');
      expect(activeAlerts(w.db)).toHaveLength(1);
      expect(r.explanation.observed_values).toMatchObject({ spike_ratio: expect.any(Number) });
    });

    it('[C2-Q2e] a cold-start result leaves an active alert untouched and does not advance its hysteresis', async () => {
      const w = createWorld();
      await evaluate(w, breachWindow());
      w.clock.advanceBy(CYCLE_MS);
      await evaluate(w, calmWindow()); // counter 1
      w.clock.advanceBy(CYCLE_MS);
      const r = await evaluate(w, windowOf({ shortBuckets: { 5: 5 }, longBuckets: { 5: 49 }, shortTokens: 100, longTokens: 1000 }));
      expect(r.status).toBe('SUPPRESSED_COLD_START');
      expect(alertRows(w.db)[0]).toMatchObject({ consecutive_clear_cycles: 1, resolved_at_ms: null, status: 'TRIGGERED' });
    });
  });

  describe('Preconditions (P) violated -> typed error, zero mutations', () => {
    const cases: [string, (win: SlidingWindowDTO, rule: AlertRuleDTO) => { win: SlidingWindowDTO; rule: AlertRuleDTO }][] = [
      ['rule NODE_HEARTBEAT_TIMEOUT (not evaluated by this operation)', (win, rule) => ({ win, rule: { ...rule, rule_id: 'NODE_HEARTBEAT_TIMEOUT' as never } })],
      ['rule THERMAL_CRITICAL_THRESHOLD (removed, no FR)', (win, rule) => ({ win, rule: { ...rule, rule_id: 'THERMAL_CRITICAL_THRESHOLD' as never } })],
      ['unknown rule id', (win, rule) => ({ win, rule: { ...rule, rule_id: 'NOPE' as never } })],
      ['short window 29 s', (win, rule) => ({ win: { ...win, short_window_seconds: 29 }, rule })],
      ['long window 301 s', (win, rule) => ({ win: { ...win, long_window_seconds: 301 }, rule })],
      ['histogram_bucket_count 99', (win, rule) => ({ win: { ...win, histogram_bucket_count: 99 }, rule })],
      ['short_histogram of 99 buckets', (win, rule) => ({ win: { ...win, short_histogram: win.short_histogram.slice(1) }, rule })],
      ['long_histogram of 101 buckets', (win, rule) => ({ win: { ...win, long_histogram: [...win.long_histogram, 0] }, rule })],
      ['negative bucket count', (win, rule) => ({ win: { ...win, short_histogram: win.short_histogram.map((c, i) => (i === 0 ? -1 : c)) }, rule })],
      ['fractional bucket count', (win, rule) => ({ win: { ...win, long_histogram: win.long_histogram.map((c, i) => (i === 0 ? 1.5 : c)) }, rule })],
      ['short bucket larger than long bucket (short not inside long)', (win, rule) => ({ win: { ...win, long_histogram: win.long_histogram.map((c, i) => (i === 47 ? 0 : c)) }, rule })],
      ['short tokens larger than long tokens', (win, rule) => ({ win: { ...win, long_window_prompt_tokens: win.short_window_prompt_tokens - 1 }, rule })],
      ['negative token total', (win, rule) => ({ win: { ...win, short_window_prompt_tokens: -1 }, rule })],
      ['fractional token total', (win, rule) => ({ win: { ...win, short_window_prompt_tokens: 10.5 }, rule })],
    ];
    it.each(cases)('[C2-P1] rejects %s with ERR_INVALID_ALERT_RULE_SPEC (422) and changes nothing', async (_label, build) => {
      const w = createWorld();
      const { win, rule } = build(breachWindow(), TOKEN_RULE);
      const before = snapshot(w);
      await expectContractError(evaluate(w, win, rule), { code: 'ERR_INVALID_ALERT_RULE_SPEC', http: 422, retryable: false });
      expectNoSideEffects(w, before);
    });

    it('[C2-Qfail] a storage failure -> ERR_DATABASE_UNAVAILABLE (503), no row created, no event, no counter', async () => {
      const w = createWorld({ alerts: failingAlertRepo });
      const before = snapshot(w);
      await expectContractError(evaluate(w, breachWindow()), { code: 'ERR_DATABASE_UNAVAILABLE', http: 503, retryable: true });
      expectNoSideEffects(w, before);
    });
  });

  describe('Invariants (I): one active alert per incident, hysteresis, windows', () => {
    it('test_alert_fires_exactly_once_per_incident_until_cleared [C2-I1a]', async () => {
      const w = createWorld();
      const [a, b] = await Promise.all([evaluate(w, breachWindow()), evaluate(w, breachWindow())]);
      expect([a.status, b.status]).toEqual(['TRIGGERED', 'TRIGGERED']);
      expect(a.alert_payload!.alert_id).toBe(b.alert_payload!.alert_id);
      expect(alertRows(w.db)).toHaveLength(1);
      expect(w.events.ofType('alert.anomaly.triggered')).toHaveLength(1);
      expect(w.metrics.total('alerts_emitted_total', { rule_id: RULE })).toBe(1);
    });

    it('[C2-I1b] a repeated breach while active creates no row, no event and resets the clearing counter', async () => {
      const w = createWorld();
      const first = await evaluate(w, breachWindow());
      w.clock.advanceBy(CYCLE_MS);
      await evaluate(w, calmWindow()); // counter 1
      expect(alertRows(w.db)[0]!.consecutive_clear_cycles).toBe(1);
      w.clock.advanceBy(1000);
      const again = await evaluate(w, breachWindow());
      expect(again.status).toBe('TRIGGERED');
      expect(again.alert_payload!.alert_id).toBe(first.alert_payload!.alert_id);
      expect(alertRows(w.db)).toHaveLength(1);
      expect(alertRows(w.db)[0]!.consecutive_clear_cycles).toBe(0);
      expect(w.events.ofType('alert.anomaly.triggered')).toHaveLength(1);
    });

    it('[C2-I1c] an incident that crosses an hour boundary stays ONE alert (AMD-3 regression)', async () => {
      const w = createWorld();
      w.clock.setTo(T0 + HOUR_MS - 1000); // 17:59:59
      const a = await evaluate(w, breachWindow());
      w.clock.setTo(T0 + HOUR_MS + 1000); // 18:00:01
      const b = await evaluate(w, breachWindow());
      expect(b.alert_payload!.alert_id).toBe(a.alert_payload!.alert_id);
      expect(alertRows(w.db)).toHaveLength(1);
      expect(w.events.ofType('alert.anomaly.triggered')).toHaveLength(1);
    });

    it('[C2-I1d] after the incident is cleared, a new breach opens a NEW incident: 2 rows, 1 active, distinct ids', async () => {
      const w = createWorld();
      const first = await evaluate(w, breachWindow());
      for (let i = 0; i < 3; i++) {
        w.clock.advanceBy(CYCLE_MS);
        await evaluate(w, calmWindow());
      }
      expect(alertRows(w.db)[0]).toMatchObject({ status: 'CLEARED' });
      w.clock.advanceBy(CYCLE_MS);
      const second = await evaluate(w, breachWindow());
      expect(second.status).toBe('TRIGGERED');
      const rows = alertRows(w.db);
      expect(rows).toHaveLength(2);
      expect(activeAlerts(w.db)).toHaveLength(1);
      expect(second.alert_payload!.alert_id).not.toBe(first.alert_payload!.alert_id);
      expect(rows[1]!.incident_key).toBe(`INC-TOKEN-P99-CLUSTER-${w.clock.nowMs()}`);
      expect(rows[1]!.incident_key).not.toBe(rows[0]!.incident_key);
    });

    it('[C2-Q2f] hysteresis: 3 consecutive 5 s no-breach cycles clear the alert at the 3rd; a breach in between restarts the count', async () => {
      const w = createWorld();
      await evaluate(w, breachWindow());
      w.clock.advanceBy(CYCLE_MS);
      expect((await evaluate(w, calmWindow())).status, 'cycle 1 of 3: still active').toBe('TRIGGERED');
      w.clock.advanceBy(CYCLE_MS);
      expect((await evaluate(w, calmWindow())).status, 'cycle 2 of 3: still active').toBe('TRIGGERED');
      expect(alertRows(w.db)[0]).toMatchObject({ consecutive_clear_cycles: 2, resolved_at_ms: null });
      w.clock.advanceBy(1000);
      await evaluate(w, breachWindow()); // breach restarts the count
      expect(alertRows(w.db)[0]).toMatchObject({ consecutive_clear_cycles: 0 });
      const statuses: string[] = [];
      for (let i = 0; i < 3; i++) {
        w.clock.setTo(T0 + (3 + i) * CYCLE_MS);
        statuses.push((await evaluate(w, calmWindow())).status);
      }
      expect(statuses).toEqual(['TRIGGERED', 'TRIGGERED', 'CLEARED']);
      expect(alertRows(w.db)[0]).toMatchObject({ status: 'CLEARED', resolved_at_ms: T0 + 5 * CYCLE_MS });
      expect(w.events.ofType('alert.anomaly.resolved')).toHaveLength(1);
    });

    it('[C2-Q2g] two evaluations inside the same 5,000 ms cycle count once', async () => {
      const w = createWorld();
      await evaluate(w, breachWindow());
      w.clock.advanceBy(CYCLE_MS);
      await evaluate(w, calmWindow());
      w.clock.advanceBy(100);
      await evaluate(w, calmWindow());
      expect(alertRows(w.db)[0]!.consecutive_clear_cycles).toBe(1);
    });

    it('[C2-Q2h] the clearing counter survives a restart (new system instance over the same database)', async () => {
      const w = createWorld();
      await evaluate(w, breachWindow());
      for (let i = 0; i < 2; i++) {
        w.clock.advanceBy(CYCLE_MS);
        await evaluate(w, calmWindow());
      }
      const restarted = createWorld({}, { db: w.db, clock: w.clock });
      w.clock.advanceBy(CYCLE_MS);
      const r = await evaluate(restarted, calmWindow());
      expect(r.status).toBe('CLEARED');
      expect(alertRows(w.db)[0]).toMatchObject({ status: 'CLEARED', resolved_at_ms: w.clock.nowMs() });
    });

    it('[C2-TIME] the assembled windows are half-open: [now-30,000, now) and [now-300,000, now)', async () => {
      const w = createWorld();
      const at = (offset: number, latencyMs: number) => w.sim.inference({ timestamp_ms: T0 - offset, queue_duration_ms: latencyMs / 2, inference_duration_ms: latencyMs / 2 });
      const inference_metrics = [at(30_000, 0), at(30_001, 200), at(300_000, 400), at(300_001, 600), at(0, 800)];
      await w.sut.ingest.ingestMetricBatch(w.sim.batch(1, T0, { inference_metrics }));
      const win = w.sut.windows.assemble();
      expect(win.short_histogram.map((c, i) => [i, c]).filter(([, c]) => c !== 0)).toEqual([[0, 1]]);
      expect(win.long_histogram.map((c, i) => [i, c]).filter(([, c]) => c !== 0)).toEqual([[0, 1], [1, 1], [2, 1]]);
      expect(win.short_window_prompt_tokens).toBe(100);
      expect(win.long_window_prompt_tokens).toBe(300);
    });
  });
});

// ================================================================================================================
// OPERATION 3 - buildUtilizationReport
// ================================================================================================================
describe('Operation 3: buildUtilizationReport (contracts.md Op3)', () => {
  describe('Happy path (Q holds)', () => {
    it('[C3-Q1a] the 7-day fixture (168 h x 33 GPUs, 50 % busy) yields exact totals, tokens and per-subject breakdown', async () => {
      const w = seeded();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery());
      expect(r.generated_at_ms).toBe(T0);
      expect(r.query_window).toMatchObject({ from_ms: T0 - 168 * HOUR_MS, to_ms: T0 });
      expect(r.summary).toMatchObject({
        total_cluster_gpu_hours: 5544,
        utilized_gpu_hours: 2772,
        idle_gpu_hours: 2772,
        unavailable_gpu_hours: 0,
        overall_utilization_pct: 50,
        total_prompt_tokens: 554_400,
        total_completion_tokens: 277_200,
      });
      expect(Object.fromEntries(Object.entries(r.by_subject).map(([k, v]) => [k, v.prompt_tokens]))).toEqual({ 'CS-101': 168_000, 'CS-480': 168_000, 'CS-530': 184_800, 'FAC-RES': 33_600 });
      expect(r.node_aggregates).toHaveLength(33);
      expect(r.node_aggregates.find((n) => n.node_id === 'server-gpu-01' && n.gpu_index === 1)).toMatchObject({ gpu_hours_busy: 84, gpu_hours_idle: 84 });
      expect(r.is_empty).toBe(false);
    });

    it('[C3-Q1b] a subject filter restricts every total to that subject (CS-480 = ws-gpu-11..20 = 1,680 GPU-hours)', async () => {
      const w = seeded();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery({ academic_subjects: ['CS-480'] }));
      expect(r.summary).toMatchObject({ total_cluster_gpu_hours: 1680, utilized_gpu_hours: 840, total_prompt_tokens: 168_000 });
      expect(Object.keys(r.by_subject)).toEqual(['CS-480']);
      expect(r.node_aggregates).toHaveLength(10);
    });

    it('[C3-Q3] one report.utilization.generated event and one SUCCESS counter', async () => {
      const w = seeded();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery());
      const ev = w.events.ofType('report.utilization.generated');
      expect(ev).toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ report_id: r.report_id, actor: 'MANAGEMENT', range_hours: 168 });
      expect(w.metrics.total('executive_reports_generated_total', { status: 'SUCCESS' })).toBe(1);
    });

    it('[C3-Q4a] the report is explainable: AD-06 rule id, 5,544 scanned buckets, 60-minute resolution, no empty-state reason', async () => {
      const w = seeded();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery());
      assertExplanation(r.explanation, { ruleId: 'AD-06-HOURLY-ROLLUPS', observed: { scanned_buckets_count: 5544 }, cited: { resolution_minutes: 60 } });
      expect(r.explanation.empty_state_reason ?? null).toBeNull();
    });

    it('[C3-Q2] reads are the only database activity: no write statement, and only rollup_hourly_metrics is selected', async () => {
      const w = seeded();
      const sql = traceSql(w.db);
      const before = fingerprint(w.db);
      await w.sut.reports.buildUtilizationReport(reportQuery());
      expect(sql.length, 'the report must query something').toBeGreaterThan(0);
      expect(sql.filter((s) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)/i.test(s))).toEqual([]);
      expect(fingerprint(w.db)).toBe(before);
    });
  });

  describe('Mandatory empty state: Empty is a contract, not a blank screen', () => {
    it('[C3-EMPTY-a] no rollup rows in the window -> is_empty, reason NO_WORKLOADS_FOUND_IN_WINDOW, zero totals, 0 scanned', async () => {
      const w = createWorld();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery());
      expect(r.is_empty).toBe(true);
      expect(r.summary).toMatchObject({ total_cluster_gpu_hours: 0, utilized_gpu_hours: 0, overall_utilization_pct: 0, total_prompt_tokens: 0 });
      assertExplanation(r.explanation, { ruleId: 'AD-06-HOURLY-ROLLUPS', observed: { scanned_buckets_count: 0 } });
      expect(r.explanation.empty_state_reason).toBe('NO_WORKLOADS_FOUND_IN_WINDOW');
    });

    it('[C3-EMPTY-b] rows exist but nothing ran (busy 0, no tokens) -> is_empty with the same reason, and 5,544 GPU-hours still scanned', async () => {
      const w = seeded({ zeroBusy: true });
      const r = await w.sut.reports.buildUtilizationReport(reportQuery());
      expect(r.is_empty).toBe(true);
      expect(r.summary).toMatchObject({ total_cluster_gpu_hours: 5544, utilized_gpu_hours: 0, idle_gpu_hours: 5544, overall_utilization_pct: 0 });
      expect(r.explanation.empty_state_reason).toBe('NO_WORKLOADS_FOUND_IN_WINDOW');
    });
  });

  describe('Preconditions (P) violated -> typed error, zero queries, zero mutations', () => {
    const range: [string, Partial<ReportQueryDTO>][] = [
      ['from = to', { from_timestamp_ms: T0 - HOUR_MS, to_timestamp_ms: T0 - HOUR_MS }],
      ['from after to', { from_timestamp_ms: T0, to_timestamp_ms: T0 - HOUR_MS }],
      ['duration 168 h + 1 ms', { from_timestamp_ms: T0 - 168 * HOUR_MS - 1 }],
      ['from = 0', { from_timestamp_ms: 0 }],
      ['negative to', { from_timestamp_ms: -10, to_timestamp_ms: -5 }],
      ['fractional from', { from_timestamp_ms: T0 - HOUR_MS + 0.5 }],
    ];
    it.each(range)('[C3-P1a] %s -> ERR_INVALID_DATE_RANGE (400)', async (_l, over) => {
      const w = seeded();
      const sql = traceSql(w.db);
      const before = snapshot(w);
      await expectContractError(w.sut.reports.buildUtilizationReport(reportQuery(over)), { code: 'ERR_INVALID_DATE_RANGE', http: 400, retryable: false });
      expect(sql, 'zero database queries dispatched').toEqual([]);
      expectNoSideEffects(w, before);
    });

    it('[C3-P1b] a window of exactly 168 h ending now is valid (boundary)', async () => {
      const w = seeded();
      const r = await w.sut.reports.buildUtilizationReport(reportQuery({ from_timestamp_ms: T0 - 604_800_000, to_timestamp_ms: T0 }));
      expect(r.query_window.duration_hours).toBe(168);
    });

    it('[C3-P2] an upper bound 1 ms in the future -> ERR_FUTURE_REPORT_QUERY (422)', async () => {
      const w = seeded();
      const before = snapshot(w);
      await expectContractError(w.sut.reports.buildUtilizationReport(reportQuery({ from_timestamp_ms: T0 + 1 - HOUR_MS, to_timestamp_ms: T0 + 1 })), { code: 'ERR_FUTURE_REPORT_QUERY', http: 422, retryable: false });
      expectNoSideEffects(w, before);
    });

    it.each([[[]], [['cs-480']], [['CS-999']], [['CS-480', 'ALL', 'x']]])('[C3-P3] subjects %j -> ERR_INVALID_ACADEMIC_SUBJECT (400)', async (subjects) => {
      const w = seeded();
      const sql = traceSql(w.db);
      const before = snapshot(w);
      await expectContractError(w.sut.reports.buildUtilizationReport(reportQuery({ academic_subjects: subjects })), { code: 'ERR_INVALID_ACADEMIC_SUBJECT', http: 400, retryable: false });
      expect(sql).toEqual([]);
      expectNoSideEffects(w, before);
    });

    it('[C3-Qfail] a storage failure -> ERR_DATABASE_UNAVAILABLE (503) and no partial report', async () => {
      const w = createWorld({ rollups: failingRollupRepo });
      const before = snapshot(w);
      await expectContractError(w.sut.reports.buildUtilizationReport(reportQuery()), { code: 'ERR_DATABASE_UNAVAILABLE', http: 503, retryable: true });
      expectNoSideEffects(w, before);
    });
  });

  describe('Invariants (I)', () => {
    it('test_7day_report_queries_strictly_hourly_rollups_not_raw [C3-I1]', async () => {
      const w = seeded();
      w.db.prepare(`INSERT INTO telemetry_buckets (bucket_id, node_id, gpu_index, bucket_start_ms, temperature_min, temperature_max, temperature_avg, vram_used_bytes, gpu_utilization_pct, event_count, created_at_ms) VALUES ('B', 'ws-gpu-01', 0, ?, 50, 60, 55, 1, 99, 1, ?)`).run(T0 - 1000, T0);
      const sql = traceSql(w.db);
      await w.sut.reports.buildUtilizationReport(reportQuery());
      const selects = sql.filter((s) => /^\s*SELECT|WITH/i.test(s));
      expect(selects.length).toBeGreaterThan(0);
      for (const s of selects) {
        expect(s).toMatch(/rollup_hourly_metrics/);
        expect(s).not.toMatch(/telemetry_buckets/);
      }
    });

    it('[C3-I2a] utilized + idle + unavailable equals total (< 0.001 h), and a 3-hour SILENT_TIMEOUT of ws-gpu-22 is unavailable, not idle', async () => {
      const w = seeded({ outageHours: 3 });
      const { summary: s, node_aggregates } = await w.sut.reports.buildUtilizationReport(reportQuery());
      expect(Math.abs(s.utilized_gpu_hours + s.idle_gpu_hours + s.unavailable_gpu_hours - s.total_cluster_gpu_hours)).toBeLessThan(0.001);
      expect(s.total_cluster_gpu_hours).toBe(5544);
      expect(s.unavailable_gpu_hours).toBe(3);
      expect(s.utilized_gpu_hours).toBe(2770.5);
      expect(s.idle_gpu_hours).toBe(2770.5);
      expect(node_aggregates.find((n) => n.node_id === SILENT_NODE)).toMatchObject({ gpu_hours_unavailable: 3, gpu_hours_busy: 82.5, gpu_hours_idle: 82.5 });
      expect(s.overall_utilization_pct).toBeCloseTo((2770.5 / 5544) * 100, 6);
    });

    it('[C3-CON] five simultaneous reports return identical content (idempotent read, no data race)', async () => {
      const w = seeded();
      const reports = await Promise.all(Array.from({ length: 5 }, () => w.sut.reports.buildUtilizationReport(reportQuery())));
      const strip = ({ report_id: _a, ...rest }: (typeof reports)[number]) => rest;
      for (const r of reports.slice(1)) expect(strip(r)).toEqual(strip(reports[0]!));
      expect(new Set(reports.map((r) => r.report_id)).size, 'every report has its own id').toBe(5);
    });
  });

  describe('Explainability of the empty/denied states', () => {
    it('[C3-Q4b] an error never comes with a narrative: the typed body carries the offending values', async () => {
      const w = seeded();
      const err = await expectContractError(w.sut.reports.buildUtilizationReport(reportQuery({ academic_subjects: ['CS-999'] })), { code: 'ERR_INVALID_ACADEMIC_SUBJECT', http: 400, retryable: false });
      expect(err.body.message).toContain('CS-999');
      expect(err.body.message).toContain('CS-101, CS-480, CS-530, FAC-RES, ALL');
    });
  });
});

// ================================================================================================================
// AD-04 - Node heartbeat watchdog (Scenario 3: ws-gpu-22 goes silent)
// ================================================================================================================
describe('AD-04: NodeHeartbeatWatchdog', () => {
  const heartbeatAll = (wd: NodeHeartbeatWatchdog, at: number, except: string[] = []) => NODE_IDS.filter((n) => !except.includes(n)).forEach((n) => wd.recordHeartbeat(n, at));

  it('test_node_ws22_transitions_to_silent_timeout_after_15s [W-1]', () => {
    const clock = newClock();
    const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
    heartbeatAll(wd, T0);
    const states: [number, string][] = [];
    for (const dt of [4999, 1, 9999, 1]) {
      clock.advanceBy(dt);
      heartbeatAll(wd, clock.nowMs(), [SILENT_NODE]);
      wd.check();
      states.push([clock.nowMs() - T0, wd.stateOf(SILENT_NODE)]);
    }
    expect(states).toEqual([[4999, 'HEALTHY'], [5000, 'STALE'], [14_999, 'STALE'], [15_000, 'SILENT_TIMEOUT']]);
    expect(wd.stateOf('ws-gpu-01'), 'the other 31 nodes are unaffected').toBe('HEALTHY');
  });

  it('[W-2] the transition to SILENT_TIMEOUT is reported exactly once, with the node, the states and the time', () => {
    const clock = newClock();
    const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
    heartbeatAll(wd, T0);
    clock.advanceBy(5000);
    heartbeatAll(wd, clock.nowMs(), [SILENT_NODE]);
    wd.check(); // STALE
    clock.advanceBy(10_000);
    heartbeatAll(wd, clock.nowMs(), [SILENT_NODE]);
    const changes = wd.check();
    expect(changes.filter((c) => c.new_state === 'SILENT_TIMEOUT')).toEqual([{ node_id: SILENT_NODE, previous_state: 'STALE', new_state: 'SILENT_TIMEOUT', at_ms: T0 + 15_000 }]);
    clock.advanceBy(5000);
    heartbeatAll(wd, clock.nowMs(), [SILENT_NODE]);
    expect(wd.check().filter((c) => c.node_id === SILENT_NODE)).toEqual([]);
  });

  it('[W-3] recovery needs 3 consecutive heartbeats: RECOVERING, RECOVERING, then HEALTHY', () => {
    const clock = newClock();
    const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
    heartbeatAll(wd, T0);
    clock.advanceBy(15_000);
    wd.check();
    expect(wd.stateOf(SILENT_NODE)).toBe('SILENT_TIMEOUT');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      clock.advanceBy(5000);
      wd.recordHeartbeat(SILENT_NODE, clock.nowMs());
      wd.check();
      seen.push(wd.stateOf(SILENT_NODE));
    }
    expect(seen).toEqual(['RECOVERING', 'RECOVERING', 'HEALTHY']);
  });

  it('[W-4] a flapping node (heartbeat every other 5 s slot) never returns to HEALTHY and never re-enters SILENT_TIMEOUT within 60 s', () => {
    const clock = newClock();
    const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
    heartbeatAll(wd, T0);
    clock.advanceBy(15_000);
    wd.check(); // SILENT_TIMEOUT
    const entered: string[] = [];
    for (let slot = 0; slot < 12; slot++) {
      clock.advanceBy(5000);
      if (slot % 2 === 0) wd.recordHeartbeat(SILENT_NODE, clock.nowMs());
      entered.push(...wd.check().filter((c) => c.node_id === SILENT_NODE).map((c) => c.new_state));
      expect(wd.stateOf(SILENT_NODE)).not.toBe('HEALTHY'); // never 3 consecutive heartbeats
    }
    expect(entered, 'silence never reaches 15 s again, so SILENT_TIMEOUT is not re-entered').not.toContain('SILENT_TIMEOUT');
    expect(entered).not.toContain('HEALTHY');
  });
});

// ================================================================================================================
// CORE DOMAIN (pure): the highest-share test level. No database, no use case, only the domain classes + FakeClock.
// ================================================================================================================
describe('Core domain (pure functions and state machines)', () => {
  describe('AnomalyDetectionEngine (AD-03)', () => {
    const verdict = (w: SlidingWindowDTO) => new AnomalyDetectionEngine().evaluate(TOKEN_RULE, w);

    it.each([
      ['ratio 10.0, P99 9,600 -> breach', ratioWindow(12_000, 47), true],
      ['ratio 9.99, P99 9,600 -> no breach', ratioWindow(11_988, 47), false],
      ['ratio 11.2, P99 exactly 8,000 -> no breach', ratioWindow(13_440, 39), false],
      ['ratio 11.2, P99 8,200 -> breach', ratioWindow(13_440, 40), true],
      ['ratio 1.0, P99 1,200 -> no breach', calmWindow(), false],
    ])('[D-ENG-a] %s', (_l, window, breach) => {
      expect(verdict(window).breach).toBe(breach);
    });

    it('[D-ENG-b] 49 samples suppress, 50 evaluate (and a suppressed verdict can never be a breach)', () => {
      const mk = (n: number) => windowOf({ shortBuckets: { 47: 10 }, longBuckets: { 47: n }, shortTokens: 403_200, longTokens: 727_200 });
      expect(verdict(mk(49))).toMatchObject({ suppressedColdStart: true, breach: false, observedSamples: 49 });
      expect(verdict(mk(50))).toMatchObject({ suppressedColdStart: false, breach: true, observedSamples: 50 });
    });

    it('[D-ENG-c] a zero baseline gives an undefined spike ratio (null) and never a breach', () => {
      const v = verdict(windowOf({ shortBuckets: { 47: 100 }, longBuckets: { 47: 100 }, shortTokens: 403_200, longTokens: 403_200 }));
      expect(v.spikeRatio).toBeNull();
      expect(v.breach).toBe(false);
    });

    it('[D-ENG-d] property: more tokens in the short window can only keep or create a breach, never remove one', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 600_000 }), fc.integer({ min: 0, max: 600_000 }), (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const at = (S: number) => verdict(windowOf({ shortBuckets: { 47: 100 }, longBuckets: { 47: 300 }, shortTokens: S, longTokens: S + 324_000 }));
          return !at(lo).breach || at(hi).breach;
        }),
      );
    });

    it('[D-ENG-e] property: the verdict depends only on the window (same input, same output)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 99 }), fc.integer({ min: 1, max: 400 }), fc.integer({ min: 0, max: 500_000 }), (bucket, n, tokens) => {
          const w = windowOf({ shortBuckets: { [bucket]: n }, longBuckets: { [bucket]: n + 60 }, shortTokens: tokens, longTokens: tokens + 100_000 });
          return JSON.stringify(verdict(w)) === JSON.stringify(verdict(w));
        }),
      );
    });
  });

  describe('HistogramP99 (AD-03)', () => {
    it('[D-HIST-a] property: P99 of a non-empty histogram is a multiple of 200 in [200, 20,000]', () => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 100, maxLength: 100 }).filter((c) => c.some((x) => x > 0)), (counts) => {
          const p = HistogramP99.p99UpperEdgeMs(counts);
          return p >= 200 && p <= 20_000 && p % 200 === 0;
        }),
      );
    });

    it('[D-HIST-b] property: adding a sample that lands in bucket 99 never lowers P99', () => {
      fc.assert(
        fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 100, maxLength: 100 }).filter((c) => c.some((x) => x > 0)), (counts) => {
          const more = counts.map((c, i) => (i === 99 ? c + 1 : c));
          return HistogramP99.p99UpperEdgeMs(more) >= HistogramP99.p99UpperEdgeMs(counts);
        }),
      );
    });

    it('[D-HIST-c] property: bucketIndex is monotone in latency and always within 0..99', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 100_000, noNaN: true }), fc.double({ min: 0, max: 100_000, noNaN: true }), (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const i = HistogramP99.bucketIndex(lo);
          const j = HistogramP99.bucketIndex(hi);
          return i <= j && i >= 0 && j <= 99;
        }),
      );
    });
  });

  describe('BucketDecimator (AD-01)', () => {
    const rig = () => {
      const w = createWorld();
      const closed: any[] = [];
      const dec = new BucketDecimator({ clock: w.clock, ring: new TelemetryRingBuffer(SERIES_IDS), onDispatch: (c) => closed.push(c) });
      return { w, dec, closed };
    };

    it('[D-DEC-a] a closed window carries min / max / sum / count / last of each metric of each series', () => {
      const { w, dec, closed } = rig();
      const mk = (t: number, util: number) => w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: T0, temperature_celsius: t, gpu_utilization_pct: util, vram_used_bytes: 1000 });
      dec.accumulate([mk(50, 10), mk(70, 30), mk(60, 20)]);
      w.clock.advanceBy(250);
      dec.accumulate([mk(1, 1)]); // first event of the next window closes the previous one
      expect(closed).toHaveLength(1);
      const bucket = closed[0].find((b: any) => b.node_id === 'ws-gpu-05');
      expect(bucket.bucket_start_ms).toBe(T0);
      expect(bucket.temperature_celsius).toEqual({ min: 50, max: 70, sum: 180, count: 3, last: 60 });
      expect(bucket.gpu_utilization_pct).toEqual({ min: 10, max: 30, sum: 60, count: 3, last: 20 });
      expect(bucket.vram_used_bytes).toEqual({ min: 1000, max: 1000, sum: 3000, count: 3, last: 1000 });
    });

    it('[D-DEC-b] windows are half-open: +249 ms stays in the window, +250 ms closes it', () => {
      const { w, dec, closed } = rig();
      dec.accumulate(w.sim.events(10, T0));
      w.clock.advanceBy(249);
      dec.accumulate(w.sim.events(10, w.clock.nowMs()));
      expect(closed).toHaveLength(0);
      w.clock.advanceBy(1);
      dec.accumulate(w.sim.events(10, w.clock.nowMs()));
      expect(closed).toHaveLength(1);
    });

    it('[D-DEC-c] occupancy counts accepted raw events and returns to the new window\'s events after a close', () => {
      const { w, dec } = rig();
      dec.accumulate(w.sim.events(100, T0));
      dec.accumulate(w.sim.events(50, T0));
      expect(dec.occupancy).toBe(150);
      w.clock.advanceBy(250);
      dec.accumulate(w.sim.events(7, w.clock.nowMs()));
      expect(dec.occupancy).toBe(7);
    });

    it('[D-DEC-d] the two GPUs of server-gpu-01 produce two separate summaries in the same window', () => {
      const { w, dec, closed } = rig();
      dec.accumulate([
        w.sim.packet({ node_id: 'server-gpu-01', gpu_index: 0, timestamp_ms: T0, temperature_celsius: 40 }),
        w.sim.packet({ node_id: 'server-gpu-01', gpu_index: 1, timestamp_ms: T0, temperature_celsius: 80 }),
      ]);
      w.clock.advanceBy(250);
      dec.accumulate(w.sim.events(1, w.clock.nowMs()));
      const server = closed[0].filter((b: any) => b.node_id === 'server-gpu-01');
      expect(server.map((b: any) => [b.gpu_index, b.temperature_celsius.last])).toEqual([[0, 40], [1, 80]]);
    });
  });

  describe('TelemetryRingBuffer (AD-02)', () => {
    it('[D-RING-a] property: after n commits the pointer is (start + n) mod 7,200 and the byte length never changes', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 15_000 }), (n) => {
          const ring = new TelemetryRingBuffer(SERIES_IDS);
          const start = ring.writePointer;
          for (let k = 0; k < n; k++) ring.commitTick([{ seriesId: SERIES_IDS[0]!, values: [k, 0, 0, 0, 0, 0] }]);
          return ring.writePointer === (start + n) % 7200 && ring.byteLength === RING_BYTES;
        }),
        { numRuns: 8 },
      );
    });
  });

  describe('NodeHeartbeatWatchdog (AD-04)', () => {
    it('[D-WD-a] property: state is a pure function of the silence Δ: HEALTHY < 5,000 <= STALE < 15,000 <= SILENT_TIMEOUT', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 60_000 }), (silence) => {
          const clock = newClock();
          const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
          NODE_IDS.forEach((n) => wd.recordHeartbeat(n, T0));
          clock.advanceBy(silence);
          wd.check();
          const expected = silence < 5000 ? 'HEALTHY' : silence < 15_000 ? 'STALE' : 'SILENT_TIMEOUT';
          return wd.stateOf(SILENT_NODE) === expected;
        }),
        { numRuns: 60 },
      );
    });

    it('[D-WD-b] 14,999 ms of silence is not yet a timeout; 15,000 ms is (NFR-04: exactly 15.0 s)', () => {
      const clock = newClock();
      const wd = new NodeHeartbeatWatchdog(clock, NODE_IDS);
      NODE_IDS.forEach((n) => wd.recordHeartbeat(n, T0));
      clock.advanceBy(14_999);
      wd.check();
      expect(wd.stateOf(SILENT_NODE)).toBe('STALE');
      clock.advanceBy(1);
      wd.check();
      expect(wd.stateOf(SILENT_NODE)).toBe('SILENT_TIMEOUT');
    });
  });
});

// ================================================================================================================
// Cross-cutting
// ================================================================================================================
describe('Cross-cutting', () => {
  it('test_standalone_execution_requires_zero_cloud_network_io [X-AD07]', async () => {
    const w = seeded();
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(`fetch ${String(args[0])}`);
      return Promise.reject(new Error('network is forbidden'));
    }) as typeof fetch;
    try {
      const ingested = await w.sut.ingest.ingestMetricBatch(w.sim.batch(10, T0));
      const evaluated = await evaluate(w, breachWindow());
      const report = await w.sut.reports.buildUtilizationReport(reportQuery());
      expect([ingested.accepted_count, evaluated.status, report.is_empty]).toEqual([10, 'TRIGGERED', false]);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls, 'no outbound network call during a full ingest -> alert -> report flow').toEqual([]);
  });
});
