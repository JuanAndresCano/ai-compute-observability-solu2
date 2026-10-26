/** Self-tests of the test doubles: a red ATDD suite is only trustworthy if the fixtures it stands on are verified. */
import { describe, it, expect } from 'vitest';
import { newClock, T0, FakeClock } from '../fixtures/fake_clock';
import { SEED_FLEET, NODE_IDS, seedFleet } from '../fixtures/seed_fleet';
import { SimulatedTelemetry, GPU_SERIES, windowOf, stormSlices, TOKEN_RULE, WS_VRAM_BYTES, SERVER_VRAM_BYTES } from '../fixtures/sim_telemetry';
import { createTestDb, count, fingerprint, traceSql } from '../fixtures/db';
import { seedRollups, HOUR_S } from '../fixtures/rollups';
import { assertExplanation } from '../fixtures/explain_assert';
import { expectContractError } from '../support/assert';
import { createWorld } from '../support/world';
import { SimNodeLog } from '../../src/adapters/sim/sim-node-log';
import { SimJobRegistry } from '../../src/adapters/sim/sim-job-registry';
import { SequentialIdGenerator } from '../../src/adapters/sim/sequential-id-generator';
import { ContractError, NotImplementedError } from '../../src/shared/errors';
import type { NodeTelemetryPacketDTO } from '../../src/dto';

describe('fake_clock', () => {
  it('starts at T0 (aligned to 250 ms, 5,000 ms and the hour)', () => {
    const c = newClock();
    expect(c.nowMs()).toBe(T0);
    expect(T0 % 250).toBe(0);
    expect(T0 % 5000).toBe(0);
    expect(T0 % 3_600_000).toBe(0);
  });
  it('advances 15 s of virtual time instantly, with no real sleep', () => {
    const c = newClock();
    const t = performance.now();
    c.advanceBy(15_000);
    expect(c.nowMs()).toBe(T0 + 15_000);
    expect(performance.now() - t).toBeLessThan(50);
  });
  it('refuses negative, fractional and backwards moves', () => {
    const c = new FakeClock(T0);
    expect(() => c.advanceBy(-1)).toThrow(RangeError);
    expect(() => c.advanceBy(0.5)).toThrow(RangeError);
    expect(() => c.setTo(T0 - 1)).toThrow(RangeError);
    expect(() => new FakeClock(0)).toThrow(RangeError);
  });
});

describe('seed_fleet', () => {
  it('is the Plan-2 fleet: 32 nodes, 33 GPUs, 31 x 24 GB + 1 x 2 x 48 GB, all HEALTHY', () => {
    expect(NODE_IDS).toHaveLength(32);
    expect(SEED_FLEET).toHaveLength(33);
    expect(SEED_FLEET.filter((r) => r.node_type === 'WORKSTATION')).toHaveLength(31);
    expect(SEED_FLEET.filter((r) => r.node_id === 'server-gpu-01').map((r) => r.gpu_index)).toEqual([0, 1]);
    expect(SEED_FLEET.filter((r) => r.node_type === 'WORKSTATION').every((r) => r.vram_total_bytes === 25_769_803_776)).toBe(true);
    expect(SEED_FLEET.filter((r) => r.node_id === 'server-gpu-01').every((r) => r.vram_total_bytes === 51_539_607_552)).toBe(true);
    expect(SEED_FLEET.every((r) => r.current_state === 'HEALTHY')).toBe(true);
    expect(NODE_IDS).toContain('ws-gpu-22');
  });
  it('is immutable', () => {
    expect(Object.isFrozen(SEED_FLEET)).toBe(true);
    expect(Object.isFrozen(SEED_FLEET[0])).toBe(true);
    expect(() => {
      (SEED_FLEET[0] as { current_state: string }).current_state = 'STALE';
    }).toThrow(TypeError);
  });
  it('is loaded into SQLite by seedFleet', () => {
    const db = createTestDb({ seed: false });
    expect(count(db, 'cluster_nodes')).toBe(0);
    seedFleet(db, T0);
    expect(count(db, 'cluster_nodes')).toBe(33);
  });
});

/** Independent oracle for "valid telemetry" (contracts.md Op1 P1), so fixtures are proven valid before tests bend them. */
function violations(e: NodeTelemetryPacketDTO): string[] {
  const v: string[] = [];
  if (!/^(ws-gpu-(0[1-9]|[12][0-9]|3[01])|server-gpu-01)$/.test(e.node_id)) v.push('node_id');
  const server = e.node_id === 'server-gpu-01';
  if (!(server ? [0, 1].includes(e.gpu_index) : e.gpu_index === 0)) v.push('gpu_index');
  if (!(e.temperature_celsius >= -20 && e.temperature_celsius <= 120)) v.push('temperature');
  if (e.vram_total_bytes !== (server ? SERVER_VRAM_BYTES : WS_VRAM_BYTES)) v.push('vram_total');
  if (!(e.vram_used_bytes >= 0 && e.vram_used_bytes <= e.vram_total_bytes)) v.push('vram_used');
  if (!(e.gpu_utilization_pct >= 0 && e.gpu_utilization_pct <= 100)) v.push('util');
  if (!(e.timestamp_ms > 0)) v.push('timestamp');
  return v;
}

describe('sim_telemetry', () => {
  it('is deterministic: same seed, same events', () => {
    expect(new SimulatedTelemetry(7).events(50, T0)).toEqual(new SimulatedTelemetry(7).events(50, T0));
    expect(new SimulatedTelemetry(7).events(50, T0)).not.toEqual(new SimulatedTelemetry(8).events(50, T0));
  });
  it('generates only contract-valid packets by default', () => {
    const evs = new SimulatedTelemetry().events(2000, T0);
    expect(evs.flatMap(violations)).toEqual([]);
  });
  it('covers all 33 GPU series, including both GPUs of server-gpu-01', () => {
    const series = new Set(new SimulatedTelemetry().events(66, T0).map((e) => `${e.node_id}:${e.gpu_index}`));
    expect(series.size).toBe(33);
    expect(GPU_SERIES).toHaveLength(33);
  });
  it('overrides make exactly the intended violation', () => {
    const sim = new SimulatedTelemetry();
    expect(violations(sim.packet({ timestamp_ms: T0, temperature_celsius: 120.1 }))).toEqual(['temperature']);
    expect(violations(sim.packet({ timestamp_ms: T0, node_id: 'ws-gpu-00' }))).toEqual(['node_id']);
    expect(violations(sim.packet({ timestamp_ms: T0, gpu_index: 1 }))).toEqual(['gpu_index']);
  });
  it('a 1-second storm is 4 slices of 1,250 events = 5,000 events, 250 ms apart', () => {
    const slices = [...stormSlices(new SimulatedTelemetry(), T0, 1)];
    expect(slices.map((s) => s.atMs)).toEqual([T0, T0 + 250, T0 + 500, T0 + 750]);
    expect(slices.map((s) => s.batch.events.length)).toEqual([1250, 1250, 1250, 1250]);
    expect(new Set(slices.map((s) => s.batch.batch_id)).size).toBe(4);
  });
  it('inference packets keep total_latency = queue + inference', () => {
    const p = new SimulatedTelemetry().inference({ timestamp_ms: T0, queue_duration_ms: 1500, inference_duration_ms: 7000 });
    expect(p.total_latency_ms).toBe(8500);
  });
  it('windowOf builds two 100-bucket histograms and the token totals', () => {
    const w = windowOf({ shortBuckets: { 5: 98, 47: 2 }, longBuckets: { 5: 300, 47: 2 }, shortTokens: 403_200, longTokens: 360_000 });
    expect(w.short_histogram).toHaveLength(100);
    expect(w.long_histogram).toHaveLength(100);
    expect(w.short_histogram[47]).toBe(2);
    expect(w.long_histogram.reduce((a, b) => a + b, 0)).toBe(302);
    expect(TOKEN_RULE.rule_id).toBe('TOKEN_SPIKE_AND_LATENCY_BREACH');
  });
  it('SequentialIdGenerator emits contract-shaped ids', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids.alertId()).toMatch(/^ALT-[A-Z0-9]{8,16}$/);
  });
});

describe('db', () => {
  it('migrates all seven tables from 001_observability_schema.sql', () => {
    const db = createTestDb();
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[];
    expect(names.map((n) => n.name)).toEqual(expect.arrayContaining(['audit_events', 'cluster_nodes', 'node_heartbeats', 'operational_alerts', 'rollup_hourly_metrics', 'telemetry_buckets', 'node_forensics']));
  });
  it('fingerprint is stable when nothing changes and differs after any write', () => {
    const db = createTestDb();
    const before = fingerprint(db);
    expect(fingerprint(db)).toBe(before);
    db.prepare(`UPDATE cluster_nodes SET current_state = 'STALE' WHERE node_id = 'ws-gpu-22'`).run();
    expect(fingerprint(db)).not.toBe(before);
  });
  it('databases are isolated from each other', () => {
    const a = createTestDb();
    const b = createTestDb({ seed: false });
    expect(count(a, 'cluster_nodes')).toBe(33);
    expect(count(b, 'cluster_nodes')).toBe(0);
  });
});

describe('traceSql', () => {
  it('sees statements executed after tracing starts, even if they were prepared before (adapter-constructor style)', () => {
    const db = createTestDb();
    const prepared = db.prepare('SELECT COUNT(*) AS n FROM cluster_nodes');
    const before = traceSql(db);
    prepared.get();
    prepared.get();
    expect(before).toHaveLength(2);
    expect(before[0]).toMatch(/cluster_nodes/);
  });
  it('is empty when nothing runs and does not include earlier migration or seed statements', () => {
    const db = createTestDb();
    const log = traceSql(db);
    expect(log).toEqual([]);
  });
  it('separate traces are independent', () => {
    const db = createTestDb();
    const a = traceSql(db);
    db.prepare('SELECT 1').get();
    const b = traceSql(db);
    db.prepare('SELECT 2').get();
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
  });
});

describe('7-day rollup fixture', () => {
  it('is 168 h x 33 GPUs = 5,544 rows and respects the hourly CHECK', () => {
    const db = createTestDb();
    seedRollups(db, T0 / 1000);
    expect(count(db, 'rollup_hourly_metrics')).toBe(5544);
    const first = db.prepare(`SELECT MIN(hour_epoch_s) AS m FROM rollup_hourly_metrics`).get() as { m: number };
    expect(first.m).toBe(T0 / 1000 - 168 * HOUR_S);
  });
  it('outage hours of ws-gpu-22 are fully unavailable, not idle', () => {
    const db = createTestDb();
    seedRollups(db, T0 / 1000, { outageHours: 3 });
    const sums = db.prepare(`SELECT SUM(gpu_hours_unavailable) AS u, SUM(gpu_hours_busy) AS b, SUM(gpu_hours_idle) AS i FROM rollup_hourly_metrics`).get();
    expect(sums).toEqual({ u: 3, b: (5544 - 3) * 0.5, i: (5544 - 3) * 0.5 });
  });
});

describe('sim_node_log and sim_job_registry (forensic doubles)', () => {
  it('tail returns the newest n lines, oldest first, per node', async () => {
    const log = new SimNodeLog();
    for (let i = 1; i <= 80; i++) log.emit('ws-gpu-22', `l${i}`);
    log.emit('ws-gpu-01', 'other');
    const tail = await log.tail('ws-gpu-22', 50);
    expect(tail).toHaveLength(50);
    expect(tail[0]).toBe('l31');
    expect(tail[49]).toBe('l80');
    expect(await log.tail('ws-gpu-01', 50)).toEqual(['other']);
    expect(await log.tail('ws-gpu-99', 50)).toEqual([]);
  });
  it('tail is a snapshot: lines emitted later do not change an array already returned', async () => {
    const log = new SimNodeLog();
    log.emit('ws-gpu-22', 'a');
    const before = await log.tail('ws-gpu-22', 50);
    log.emit('ws-gpu-22', 'b');
    expect(before).toEqual(['a']);
  });
  it('the job registry returns the registered job or null', async () => {
    const jobs = new SimJobRegistry();
    const job = { job_id: 'j1', user: 'u', subject: 'CS-480', model: 'm', submitted_at_ms: 1 };
    jobs.setJob('ws-gpu-22', job);
    expect(await jobs.activeJob('ws-gpu-22')).toEqual(job);
    expect(await jobs.activeJob('ws-gpu-01')).toBeNull();
  });
});

describe('rollup fixture: hourBusy', () => {
  it('forces every GPU of the chosen hour to the given busy fraction with idle = 1 - busy, and keeps the table valid', () => {
    const db = createTestDb();
    seedRollups(db, T0 / 1000, { hourBusy: { 10: 1, 11: 0.999 } });
    const hour = (h: number) => T0 / 1000 - (168 - h) * HOUR_S;
    const sums = (h: number) => db.prepare('SELECT SUM(gpu_hours_busy) AS b, SUM(gpu_hours_idle) AS i, COUNT(*) AS n FROM rollup_hourly_metrics WHERE hour_epoch_s = ?').get(hour(h)) as { b: number; i: number; n: number };
    expect(sums(10)).toEqual({ b: 33, i: 0, n: 33 });
    expect(sums(11).b).toBeCloseTo(33 * 0.999, 9);
    expect(sums(12)).toEqual({ b: 16.5, i: 16.5, n: 33 });
    expect(count(db, 'rollup_hourly_metrics')).toBe(5544);
  });
});

describe('explain_assert cited', () => {
  const exp = { rule_id: 'R', observed_values: { a: 1 }, thresholds: { b: 2 }, justification_text: 'x' };
  it('accepts a cited value in either map and rejects a wrong or missing one', () => {
    expect(() => assertExplanation(exp, { ruleId: 'R', cited: { a: 1, b: 2 } })).not.toThrow();
    expect(() => assertExplanation(exp, { ruleId: 'R', cited: { a: 9 } })).toThrow();
    expect(() => assertExplanation(exp, { ruleId: 'R', cited: { zzz: 1 } })).toThrow();
  });
});

describe('explain_assert', () => {
  const good = { rule_id: 'AD-01-DECIMATION-4HZ', observed_values: { observed_rate: 1250 }, thresholds: { buffer_capacity: 10000 }, justification_text: 'x' };
  it('accepts an explanation with rule id, observed values and thresholds', () => {
    expect(() => assertExplanation(good, { ruleId: 'AD-01-DECIMATION-4HZ', observed: { observed_rate: 1250 }, thresholds: { buffer_capacity: 10000 } })).not.toThrow();
  });
  it.each([
    ['missing explanation', undefined],
    ['empty rule id', { ...good, rule_id: '' }],
    ['no observed values', { ...good, observed_values: {} }],
    ['wrong rule id', { ...good, rule_id: 'AD-99' }],
  ])('rejects %s', (_n, exp) => {
    expect(() => assertExplanation(exp as never, { ruleId: 'AD-01-DECIMATION-4HZ' })).toThrow();
  });
  it('rejects a wrong observed value and a missing key', () => {
    expect(() => assertExplanation(good, { ruleId: 'AD-01-DECIMATION-4HZ', observed: { observed_rate: 999 } })).toThrow();
    expect(() => assertExplanation(good, { ruleId: 'AD-01-DECIMATION-4HZ', observedKeys: ['free_slots'] })).toThrow();
  });
});

describe('red seam and assertions helper', () => {
  it('every system entry point is an interface stub that throws NotImplementedError', async () => {
    const w = createWorld();
    await expect(w.sut.ingest.ingestMetricBatch(w.sim.batch(1, w.clock.nowMs()))).rejects.toBeInstanceOf(NotImplementedError);
    await expect(w.sut.alertEvaluation.evaluateAlertRule(TOKEN_RULE, windowOf({ shortBuckets: {}, longBuckets: {}, shortTokens: 0, longTokens: 0 }))).rejects.toBeInstanceOf(NotImplementedError);
    await expect(w.sut.reports.buildUtilizationReport({ query_id: 'q', from_timestamp_ms: 1, to_timestamp_ms: 2, academic_subjects: ['ALL'] })).rejects.toBeInstanceOf(NotImplementedError);
    expect(() => w.sut.windows.assemble()).toThrow(NotImplementedError);
  });
  const body = (code: string, http: number, retryable: boolean) =>
    new ContractError({ error_code: code as never, http_status: http, message: 'm', timestamp_ms: T0, retryable, details: {} });
  it('expectContractError passes on the right code and fails on a wrong code, status or retryable flag', async () => {
    const spec = { code: 'ERR_BUFFER_OVERFLOW' as const, http: 429, retryable: true };
    await expect(expectContractError(Promise.reject(body('ERR_BUFFER_OVERFLOW', 429, true)), spec)).resolves.toBeDefined();
    await expect(expectContractError(Promise.reject(body('ERR_FUTURE_TIMESTAMP_DRIFT', 429, true)), spec)).rejects.toThrow();
    await expect(expectContractError(Promise.reject(body('ERR_BUFFER_OVERFLOW', 400, true)), spec)).rejects.toThrow();
    await expect(expectContractError(Promise.reject(body('ERR_BUFFER_OVERFLOW', 429, false)), spec)).rejects.toThrow();
    await expect(expectContractError(Promise.resolve('ok'), spec)).rejects.toThrow();
  });
  it('expectContractError re-throws NotImplementedError so red tests fail for the right reason', async () => {
    await expect(expectContractError(Promise.reject(new NotImplementedError('x')), { code: 'ERR_BUFFER_OVERFLOW', http: 429, retryable: true })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
