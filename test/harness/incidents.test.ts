/**
 * Story 11.5 end to end through the real HTTP server: telemetry batches -> anomaly detection -> correlator -> incident feed.
 * Nothing under test is mocked; the only double is the deterministic clock of the test world.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createWorld, type World } from '../support/world';
import { createHttpServer, type HttpServerInstance } from '../../src/adapters/inbound/http-server';
import { TelemetryIngestionService } from '../../src/application/services/telemetry-ingestion.service';
import { T0 } from '../fixtures/fake_clock';
import type { AppConfig } from '../../src/config';

const CONFIG: AppConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 0, dbPath: ':memory:',
  maxRawQueueCapacity: 10_000, decimationWindowMs: 250, logLevel: 'error',
};
const NODE = 'ws-gpu-15';

let w: World;
let http: HttpServerInstance;
let base: string;

beforeEach(async () => {
  w = createWorld();
  http = createHttpServer(w.sut, CONFIG);
  await http.start();
  base = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await http.stop();
  w.db.close();
});

type Extra = { fan_rpm?: unknown; dropped_tokens?: unknown };
const post = (node: string, temp: number, extra: Extra = {}) =>
  fetch(`${base}/v1/telemetry/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      batch_id: randomUUID(),
      client_timestamp_ms: T0,
      events: [{ ...w.sim.packet({ node_id: node, timestamp_ms: T0, temperature_celsius: temp }), ...extra }],
    }),
  });
const incidents = async () =>
  ((await (await fetch(`${base}/v1/incidents`)).json()) as { incidents: Array<{ incident_type: string; node_id: string; suppressed_count: number; supporting_evidence: Array<{ anomaly_type: string }> }> }).incidents;

describe('GET /v1/incidents (Story 11.5, AD-28)', () => {
  it('starts empty', async () => {
    expect(await incidents()).toEqual([]);
  });

  it('three batches (thermal, fan failure, dropped tokens) on ws-gpu-15 produce exactly one CRITICAL_COOLING_FAILURE', async () => {
    expect((await post(NODE, 90)).status).toBe(200);
    expect(await incidents()).toEqual([]); // one signal is not an incident
    expect((await post(NODE, 60, { fan_rpm: 0 })).status).toBe(200);
    expect(await incidents()).toEqual([]);
    expect((await post(NODE, 60, { dropped_tokens: 120 })).status).toBe(200);

    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ incident_type: 'CRITICAL_COOLING_FAILURE', node_id: NODE, suppressed_count: 0 });
    expect(list[0]!.supporting_evidence.map((e) => e.anomaly_type)).toEqual(['THERMAL_SPIKE', 'FAN_FAILURE', 'DROPPED_TOKENS']);
    expect(w.events.ofType('incident.created')).toHaveLength(1);
    expect(w.events.ofType('incident.created')[0]!.payload).toMatchObject({ node_id: NODE, incident_type: 'CRITICAL_COOLING_FAILURE', evidence_count: 3 });
    expect(w.metrics.total('incidents_created_total', { type: 'CRITICAL_COOLING_FAILURE' })).toBe(1);
  });

  it('further anomalies on the same node are suppressed: still one incident, no second audit event', async () => {
    await post(NODE, 90, { fan_rpm: 0, dropped_tokens: 5 }); // all three signals in a single event
    for (let i = 0; i < 5; i++) await post(NODE, 92);

    const list = await incidents();
    expect(list).toHaveLength(1);
    expect(list[0]!.suppressed_count).toBe(5);
    expect(w.events.ofType('incident.created')).toHaveLength(1);
  });

  it('signals reported by different nodes never combine', async () => {
    await post('ws-gpu-01', 90);
    await post('ws-gpu-02', 60, { fan_rpm: 0 });
    await post('ws-gpu-03', 60, { dropped_tokens: 9 });
    expect(await incidents()).toEqual([]);
  });

  it.each([
    ['fan_rpm 300 (spinning)', { fan_rpm: 300 }, { dropped_tokens: 9 }],
    ['dropped_tokens 0', { fan_rpm: 0 }, { dropped_tokens: 0 }],
  ])('does not raise an incident when %s', async (_n, a, b) => {
    await post(NODE, 90);
    await post(NODE, 60, a);
    await post(NODE, 60, b);
    expect(await incidents()).toEqual([]);
  });

  it('a node that does not report fan_rpm or dropped_tokens can never trigger the signature', async () => {
    for (let i = 0; i < 5; i++) await post(NODE, 99);
    expect(await incidents()).toEqual([]);
  });

  it('the incident leaves the feed after a full window of silence and a new failure opens a new one', async () => {
    await post(NODE, 90, { fan_rpm: 0, dropped_tokens: 5 });
    expect(await incidents()).toHaveLength(1);

    w.clock.advanceBy(31_000);
    expect(await incidents()).toEqual([]);

    await post(NODE, 91, { fan_rpm: 0, dropped_tokens: 7 });
    expect(await incidents()).toHaveLength(1);
    expect(w.events.ofType('incident.created')).toHaveLength(2);
  });

  it('works through the array stream format (/api/v1/metrics/stream) too', async () => {
    const res = await fetch(`${base}/api/v1/metrics/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ node_id: NODE, gpu_util_pct: 80, mem_used_mb: 9000, temp_c: 91, fan_rpm: 0, dropped_tokens: 12 }]),
    });
    expect(res.status).toBe(200);
    expect(await incidents()).toHaveLength(1);
  });
});

describe('validation of the optional fields (contracts.md AMD-21)', () => {
  it.each([[-1], [30_001], ['fast'], [null], [Number.NaN]])('rejects fan_rpm %j with 422 and no side effect', async (fan) => {
    const res = await post(NODE, 90, { fan_rpm: fan });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error_code: 'ERR_INVALID_TELEMETRY_PAYLOAD', http_status: 422 });
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM ingested_batches').get()).toEqual({ n: 0 });
  });

  it.each([[-1], [1.5], ['many'], [null]])('rejects dropped_tokens %j with 422', async (tokens) => {
    const res = await post(NODE, 90, { dropped_tokens: tokens });
    expect(res.status).toBe(422);
  });

  it.each([[0], [30_000]])('accepts fan_rpm %i (inclusive bounds)', async (fan) => {
    expect((await post(NODE, 50, { fan_rpm: fan })).status).toBe(200);
  });
});

describe('failure isolation', () => {
  it('an observer that throws never fails the ingestion; the failure is counted', async () => {
    const ingest = new TelemetryIngestionService(w.deps, {
      anomalies: { observe: () => { throw new Error('correlator exploded'); } },
    });
    const result = await ingest.ingestMetricBatch(w.sim.batch(1, T0, { events: [w.sim.packet({ node_id: NODE, timestamp_ms: T0, temperature_celsius: 90 })] }));
    expect(result.accepted_count).toBe(1);
    expect(w.metrics.total('incident_correlation_errors_total', {})).toBe(1);
  });
});
