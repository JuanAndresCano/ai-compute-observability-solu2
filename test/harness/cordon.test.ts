/**
 * Story 11.6 backend: node cordon use case + the HTTP routes the heatmap view calls.
 * Real service, real in-memory audit trail, real HTTP server on an ephemeral port: nothing under test is mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createWorld, type World } from '../support/world';
import { createHttpServer, type HttpServerInstance } from '../../src/adapters/inbound/http-server';
import { InMemoryAuditTrail } from '../../src/adapters/memory/in-memory-audit-trail';
import { ContractError } from '../../src/shared/errors';
import type { AppConfig } from '../../src/config';

const CONFIG: AppConfig = {
  nodeEnv: 'test', host: '127.0.0.1', port: 0, dbPath: ':memory:',
  maxRawQueueCapacity: 10_000, decimationWindowMs: 250, logLevel: 'error',
};

let world: World;
let trail: InMemoryAuditTrail;
let http: HttpServerInstance;
let base: string;

beforeEach(async () => {
  trail = new InMemoryAuditTrail();
  world = createWorld({ events: trail, auditTrail: trail });
  http = createHttpServer(world.sut, CONFIG);
  await http.start();
  base = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await http.stop();
  world.db.close();
});

describe('NodeCordonService', () => {
  it('cordons a fleet node and emits exactly one node.cordoned audit event', async () => {
    const result = await world.sut.cordon.cordonNode('ws-gpu-22', 'liam');

    expect(result).toMatchObject({ node_id: 'ws-gpu-22', state: 'CORDONED', cordoned_by: 'liam', newly_cordoned: true });
    expect(world.sut.cordon.listCordonedNodeIds()).toEqual(['ws-gpu-22']);
    expect(trail.recent(10)).toEqual([
      { eventType: 'node.cordoned', occurredAtMs: world.clock.nowMs(), payload: { node_id: 'ws-gpu-22', cordoned_by: 'liam', reason: 'operator_triage' } },
    ]);
  });

  it('is idempotent: a second cordon reports newly_cordoned=false and emits no second event', async () => {
    await world.sut.cordon.cordonNode('ws-gpu-22', 'liam');
    const again = await world.sut.cordon.cordonNode('ws-gpu-22', 'someone-else');

    expect(again).toMatchObject({ newly_cordoned: false, cordoned_by: 'liam' });
    expect(trail.recent(10)).toHaveLength(1);
  });

  it('concurrent cordon requests for one node produce a single audit event', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => world.sut.cordon.cordonNode('server-gpu-01', 'liam')));

    expect(results.filter((r) => r.newly_cordoned)).toHaveLength(1);
    expect(trail.recent(50, 'node.')).toHaveLength(1);
  });

  it.each(['ws-gpu-00', 'ws-gpu-32', 'ws-gpu-1', 'server-gpu-02', '', '../etc/passwd'])('rejects unknown node %j with ERR_UNKNOWN_NODE_ID (404) and no side effect', async (id) => {
    const err = await world.sut.cordon.cordonNode(id, 'liam').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_UNKNOWN_NODE_ID', http_status: 404 });
    expect(world.sut.cordon.listCordonedNodeIds()).toEqual([]);
    expect(trail.recent(10)).toEqual([]);
  });
});

describe('InMemoryAuditTrail', () => {
  it('returns newest first, filters by type prefix and is bounded', () => {
    const small = new InMemoryAuditTrail(3);
    for (let i = 1; i <= 5; i++) small.emit({ eventType: i % 2 ? 'node.cordoned' : 'telemetry.batch.ingested', occurredAtMs: i, payload: {} });

    expect(small.recent(10).map((e) => e.occurredAtMs)).toEqual([5, 4, 3]);
    expect(small.recent(10, 'node.').map((e) => e.occurredAtMs)).toEqual([5, 3]);
    expect(small.recent(1).map((e) => e.occurredAtMs)).toEqual([5]);
  });
});

describe('HTTP: observability routes', () => {
  it('serves the heatmap page and its assets', async () => {
    const page = await fetch(`${base}/observability/heatmap`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('data-testid="fleet-grid"');

    expect((await fetch(`${base}/observability/assets/heatmap.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${base}/observability/assets/heatmap.css`)).headers.get('content-type')).toContain('text/css');
  });

  it('does not serve arbitrary files under /observability/assets (no path traversal)', async () => {
    for (const path of ['/observability/assets/../../server.js', '/observability/assets/heatmap.html', '/observability/assets/%2e%2e/config.js']) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }
  });

  it('POST /v1/nodes/:id/cordon cordons, lists it and surfaces the audit event in the feed', async () => {
    const res = await fetch(`${base}/v1/nodes/ws-gpu-22/cordon`, { method: 'POST', headers: { 'x-operator': 'liam' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ node_id: 'ws-gpu-22', state: 'CORDONED', newly_cordoned: true });

    expect(await (await fetch(`${base}/v1/nodes/cordoned`)).json()).toEqual({ node_ids: ['ws-gpu-22'] });
    const feed = (await (await fetch(`${base}/v1/audit-events?type_prefix=node.`)).json()) as { events: Array<{ event_type: string; payload: { node_id: string } }> };
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ event_type: 'node.cordoned', payload: { node_id: 'ws-gpu-22' } });
  });

  it('cordon of an unknown node returns the typed 404 error body', async () => {
    const res = await fetch(`${base}/v1/nodes/ws-gpu-99/cordon`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error_code: 'ERR_UNKNOWN_NODE_ID', http_status: 404, retryable: false });
  });

  it('GET /v1/nodes/:id/logs returns the newest lines of that node only', async () => {
    world.logs.emit('ws-gpu-22', 'line-a');
    world.logs.emit('ws-gpu-22', 'line-b');
    world.logs.emit('ws-gpu-01', 'other-node');

    const body = await (await fetch(`${base}/v1/nodes/ws-gpu-22/logs`)).json();
    expect(body).toEqual({ node_id: 'ws-gpu-22', lines: ['line-a', 'line-b'] });
  });

  it('audit feed clamps an out-of-range limit instead of failing', async () => {
    const res = await fetch(`${base}/v1/audit-events?limit=-5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [] });
  });
});
