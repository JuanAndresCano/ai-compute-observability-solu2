/**
 * Regression: a batch_id that violates the ingested_batches CHECK (length 36) used to be swallowed by INSERT OR IGNORE
 * and reported as an idempotent duplicate (HTTP 200, accepted_count 0): the events were silently discarded.
 * Found when the k6 load test (hosted CI run) measured only that no-op path. A malformed id must be refused loudly.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '../support/world';
import { ContractError } from '../../src/shared/errors';
import { T0 } from '../fixtures/fake_clock';

const VALID_ID = '11111111-2222-4333-8444-555555555555';

const batchWith = (w: ReturnType<typeof createWorld>, batch_id: string | undefined) => {
  const events = [w.sim.packet({ node_id: 'ws-gpu-05', timestamp_ms: T0 })];
  return { ...w.sim.batch(1, T0, { events }), batch_id } as never;
};

describe('telemetry batch_id validation', () => {
  it.each(['k6-12-3-1794239570940', 'short', '', '11111111-2222-4333-8444-5555555555555', 'x'.repeat(36), '11111111_2222_4333_8444_555555555555', '1111111g-2222-4333-8444-555555555555'])('rejects malformed batch_id %j with a 422 and stores nothing', async (id) => {
    const w = createWorld();
    const err = await w.sut.ingest.ingestMetricBatch(batchWith(w, id)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_INVALID_TELEMETRY_PAYLOAD', http_status: 422, retryable: false });
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM ingested_batches').get()).toEqual({ n: 0 });
    expect(w.events.events).toEqual([]);
  });

  it('accepts a well-formed batch_id and really ingests the event', async () => {
    const w = createWorld();
    const result = await w.sut.ingest.ingestMetricBatch(batchWith(w, VALID_ID));
    expect(result.accepted_count).toBe(1);
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM ingested_batches').get()).toEqual({ n: 1 });
  });

  it('still treats a repeated well-formed batch_id as an idempotent duplicate', async () => {
    const w = createWorld();
    await w.sut.ingest.ingestMetricBatch(batchWith(w, VALID_ID));
    const again = await w.sut.ingest.ingestMetricBatch(batchWith(w, VALID_ID));
    expect(again.accepted_count).toBe(0);
    expect(again.explanation.justification_text).toContain('Duplicate batch');
  });

  it('a batch without a batch_id is processed (the HTTP adapter assigns one for array bodies)', async () => {
    const w = createWorld();
    const result = await w.sut.ingest.ingestMetricBatch(batchWith(w, undefined));
    expect(result.accepted_count).toBe(1);
  });
});

describe('events array length bound (contracts.md Op1 P1: 1 <= length <= 5,000)', () => {
  const batchOf = (w: ReturnType<typeof createWorld>, n: number) => w.sim.batch(n, T0, { events: w.sim.events(n, T0) });

  it.each([5000, 1])('accepts a batch of exactly %i events', async (n) => {
    const w = createWorld();
    const result = await w.sut.ingest.ingestMetricBatch(batchOf(w, n));
    expect(result.accepted_count).toBe(n);
  });

  it.each([0, 5001, 5002, 9000, 10_000, 10_001])('rejects a batch of %i events with 422 and stores nothing', async (n) => {
    const w = createWorld();
    const err = await w.sut.ingest.ingestMetricBatch(batchOf(w, n)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect((err as ContractError).body).toMatchObject({ error_code: 'ERR_INVALID_TELEMETRY_PAYLOAD', http_status: 422 });
    expect(w.db.prepare('SELECT COUNT(*) AS n FROM ingested_batches').get()).toEqual({ n: 0 });
  });
});
