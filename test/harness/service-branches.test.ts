/**
 * Branch-coverage tests for application services: forensics evidence fallbacks and monitor tick resilience.
 * Uses the real watchdog, real SQLite repos and the test world; storage faults are injected at the repository port only.
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type World } from '../support/world';
import { FLEET_NODE_IDS } from '../../src/domain/models/fleet';
import { SqliteTelemetryRepo } from '../../src/adapters/db/sqlite-telemetry-repo';
import { ContractError } from '../../src/shared/errors';
import { TOKEN_RULE, windowOf } from '../fixtures/sim_telemetry';
import { failingAlertRepo } from '../support/faults';
import type { TelemetryRepositoryPort } from '../../src/ports/out/telemetry-repository.port';

const SILENT = 'ws-gpu-22';

const heartbeat = (w: World, nodes: readonly string[]) =>
  w.sut.ingest.ingestMetricBatch(
    w.sim.batch(nodes.length, w.clock.nowMs(), { events: nodes.map((n) => w.sim.packet({ node_id: n, timestamp_ms: w.clock.nowMs() })) }),
  );

/** Everyone reports once, then only the other nodes keep reporting until `ws-gpu-22` has been silent for `silenceS` seconds. */
async function silentFor(w: World, silenceS: number): Promise<void> {
  await heartbeat(w, FLEET_NODE_IDS);
  const others = FLEET_NODE_IDS.filter((n) => n !== SILENT);
  for (let s = 1; s <= silenceS; s++) {
    w.clock.advanceBy(1000);
    await heartbeat(w, others);
    await w.sut.monitor.tick();
  }
}

describe('ForensicsService evidence fallbacks', () => {
  it('rejects an empty node id as unknown (404) without touching storage', async () => {
    const w = createWorld();
    const err = await w.sut.forensics.getNodeForensics('').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_UNKNOWN_NODE_ID', http_status: 404 });
  });

  it('answers with empty evidence when the stored record has vanished, estimating the last heartbeat 5 s back', async () => {
    const w = createWorld();
    await silentFor(w, 18);
    w.db.prepare('DELETE FROM node_forensics').run();

    const f = await w.sut.forensics.getNodeForensics(SILENT);

    expect(f.state).toBe('SILENT_TIMEOUT');
    expect(f.silence_duration_ms).toBe(5000);
    expect(f.last_snapshot).toBeNull();
    expect(f.log_tail).toEqual([]);
    expect(f.last_job).toBeNull();
    expect(f.recommendation).toBe('CORDON_RECOMMENDED');
  });

  it('tolerates a double-encoded snapshot string in the stored record', async () => {
    const w = createWorld();
    await silentFor(w, 18);
    const row = w.db.prepare('SELECT last_snapshot_json FROM node_forensics WHERE node_id = ?').get(SILENT) as { last_snapshot_json: string };
    const inner = JSON.parse(row.last_snapshot_json);
    w.db.prepare('UPDATE node_forensics SET last_snapshot_json = ? WHERE node_id = ?').run(JSON.stringify(JSON.stringify(inner)), SILENT);

    const f = await w.sut.forensics.getNodeForensics(SILENT);
    expect(f.last_snapshot).toMatchObject({ node_id: SILENT });
  });

  it('keeps a snapshot that is a plain non-JSON string instead of failing the view', async () => {
    const w = createWorld();
    await silentFor(w, 18);
    w.db.prepare('UPDATE node_forensics SET last_snapshot_json = ? WHERE node_id = ?').run(JSON.stringify('not json {'), SILENT);

    const f = await w.sut.forensics.getNodeForensics(SILENT);
    expect(f.last_snapshot).toBe('not json {');
  });

  it('maps an unexpected storage failure while loading evidence to a retryable 503 with the cause', async () => {
    const w = createWorld();
    await silentFor(w, 18);
    const real = w.deps.forensics;
    const w2 = createWorld({ forensics: { ...real, load: async () => { throw new Error('connection reset'); } } }, { db: w.db, clock: w.clock });
    // w2 has its own watchdog: bring it to the same state on the shared clock/db
    await silentFor(w2, 18);

    const err = await w2.sut.forensics.getNodeForensics(SILENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_DATABASE_UNAVAILABLE', http_status: 503, retryable: true, message: 'connection reset' });
  });
});

describe('NodeMonitorService capture resilience', () => {
  const withSnapshot = (w: World, snapshot: () => Promise<string | null>): TelemetryRepositoryPort => {
    const real = new SqliteTelemetryRepo(w.db);
    return {
      commitBuckets: (b) => real.commitBuckets(b),
      registerBatch: (id) => real.registerBatch(id),
      readTimeline: (n, f, t) => real.readTimeline(n, f, t),
      lastSnapshot: snapshot,
    };
  };

  it('captures evidence even when the stored last snapshot is malformed JSON, falling back to now − 5 s', async () => {
    const w = createWorld();
    const w2 = createWorld({ telemetry: withSnapshot(w, async () => '{malformed') }, { db: w.db, clock: w.clock });
    await silentFor(w2, 6);

    const row = w.db.prepare('SELECT last_snapshot_json, last_heartbeat_ms, captured_at_ms FROM node_forensics WHERE node_id = ?').get(SILENT) as {
      last_snapshot_json: string | null; last_heartbeat_ms: number; captured_at_ms: number;
    };
    expect(row.last_snapshot_json).toBeNull();
    expect(row.last_heartbeat_ms).toBe(row.captured_at_ms - 5000);
  });

  it('keeps the monitor alive when the evidence capture itself fails', async () => {
    const w = createWorld();
    const w2 = createWorld({ telemetry: withSnapshot(w, async () => { throw new Error('disk gone'); }) }, { db: w.db, clock: w.clock });
    await expect(silentFor(w2, 6)).resolves.toBeUndefined();
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM node_forensics').get()).toEqual({ n: 0 });
    expect(w2.sut.forensics.getNodeForensics(SILENT)).resolves.toMatchObject({ state: 'STALE' });
  });

  it('stores the registered job with the evidence when one is running', async () => {
    const w = createWorld();
    const job = { job_id: 'job-1', user: 'sam', subject: 'CS-101', model: 'tiny', submitted_at_ms: w.clock.nowMs() };
    w.jobs.setJob(SILENT, job);
    await silentFor(w, 6);
    expect((await w.sut.forensics.getNodeForensics(SILENT)).last_job).toEqual(job);
  });
});

describe('AlertEvaluationService failure mapping', () => {
  const breach = () => windowOf({ shortBuckets: { 5: 98, 47: 2 }, longBuckets: { 5: 298, 47: 2 }, shortTokens: 403_200, longTokens: 727_200 });

  it('maps a storage error without a message to the default 503 text and creates no alert', async () => {
    const w = createWorld({ alerts: { ...failingAlertRepo, insertActiveIfAbsent: async () => { throw new Error(''); } } });
    const err = await w.sut.alertEvaluation.evaluateAlertRule(TOKEN_RULE, breach()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_DATABASE_UNAVAILABLE', http_status: 503, retryable: true, message: 'Storage unavailable' });
    expect(w.events.events).toEqual([]);
  });

  it('a calm window does not raise an alert (negative control for the failure test above)', async () => {
    const w = createWorld();
    const calm = windowOf({ shortBuckets: { 5: 100 }, longBuckets: { 5: 400 }, shortTokens: 36_000, longTokens: 360_000 });
    const result = await w.sut.alertEvaluation.evaluateAlertRule(TOKEN_RULE, calm);
    expect(result.status).not.toBe('TRIGGERED');
  });
});
