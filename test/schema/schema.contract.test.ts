/**
 * Physical-invariant tests: each one turns RED if the named constraint is removed from 001_observability_schema.sql.
 * They are green today because the DDL exists (Phase 2); the ATDD suite covers the behaviour that will sit on top.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createTestDb, count } from '../fixtures/db';
import { T0 } from '../fixtures/fake_clock';
import { WS_VRAM_BYTES, SERVER_VRAM_BYTES } from '../fixtures/sim_telemetry';

const RULE = 'TOKEN_SPIKE_AND_LATENCY_BREACH';
let db: Database;
beforeEach(() => {
  db = createTestDb();
});

function insertAlert(over: Record<string, unknown> = {}) {
  const row = {
    alert_id: 'ALT-00000001', incident_key: `INC-TOKEN-P99-CLUSTER-${T0}`, node_id: 'CLUSTER', trigger_rule: RULE,
    severity: 'CRITICAL', status: 'TRIGGERED', baseline: 1200, current: 13440, ratio: 11.2, p99: 9450, expl: '{}',
    trig: T0, res: null, now: T0, ...over,
  };
  return db
    .prepare(
      `INSERT INTO operational_alerts (alert_id, incident_key, node_id, trigger_rule, severity, status, observed_baseline_tps, observed_current_tps,
        spike_ratio, observed_p99_latency_ms, explanation_json, triggered_at_ms, resolved_at_ms, created_at_ms, updated_at_ms)
       VALUES (@alert_id, @incident_key, @node_id, @trigger_rule, @severity, @status, @baseline, @current, @ratio, @p99, @expl, @trig, @res, @now, @now)`,
    )
    .run(row);
}

describe('INV-05 / AD-05: at most one active alert per (trigger_rule, node_id)', () => {
  it('[S-05a] rejects a second active alert for the same rule and node', () => {
    insertAlert();
    expect(() => insertAlert({ alert_id: 'ALT-00000002', incident_key: 'INC-OTHER' })).toThrow(/UNIQUE/);
    expect(count(db, 'operational_alerts')).toBe(1);
  });

  it('[S-05b] ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING inserts once, then 0 rows', () => {
    const sql = `INSERT INTO operational_alerts (alert_id, incident_key, node_id, trigger_rule, severity, observed_baseline_tps, observed_current_tps,
      spike_ratio, observed_p99_latency_ms, explanation_json, triggered_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, 'CLUSTER', ?, 'CRITICAL', 1200, 13440, 11.2, 9450, '{}', ?, ?, ?)
      ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING`;
    expect(db.prepare(sql).run('ALT-0000000A', 'INC-A', RULE, T0, T0, T0).changes).toBe(1);
    expect(db.prepare(sql).run('ALT-0000000B', 'INC-B', RULE, T0, T0, T0).changes).toBe(0);
    expect(count(db, 'operational_alerts')).toBe(1);
  });

  it('[S-05c] allows a new incident once the previous one is resolved (recurrence)', () => {
    insertAlert();
    db.prepare(`UPDATE operational_alerts SET resolved_at_ms = ?, status = 'CLEARED' WHERE alert_id = 'ALT-00000001'`).run(T0 + 15_000);
    expect(() => insertAlert({ alert_id: 'ALT-00000002', incident_key: 'INC-TOKEN-P99-CLUSTER-2' })).not.toThrow();
    expect(count(db, 'operational_alerts')).toBe(2);
  });

  it('[S-05d] incident_key is unique across resolved and active rows', () => {
    insertAlert({ res: T0 + 1 });
    expect(() => insertAlert({ alert_id: 'ALT-00000002', node_id: 'server-gpu-01' })).toThrow(/UNIQUE/);
  });

  it('[S-05e] an incident that spans an hour boundary keeps one active row (AMD-3 regression)', () => {
    insertAlert({ trig: T0 + 3_599_000, incident_key: `INC-TOKEN-P99-CLUSTER-${T0 + 3_599_000}` });
    expect(() => insertAlert({ alert_id: 'ALT-00000002', incident_key: `INC-TOKEN-P99-CLUSTER-${T0 + 3_601_000}`, trig: T0 + 3_601_000 })).toThrow(/UNIQUE/);
  });

  it('[S-05f] node_id of an alert must be CLUSTER or one of the 32 registered nodes', () => {
    for (const bad of ['ws-gpu-00', 'ws-gpu-32', 'ws-gpu-5', 'gpu-01', '']) {
      expect(() => insertAlert({ node_id: bad, alert_id: `ALT-X${bad.length}`, incident_key: `K-${bad}` }), bad).toThrow(/CHECK/);
    }
    expect(() => insertAlert({ node_id: 'ws-gpu-31', alert_id: 'ALT-0000000C', incident_key: 'K-31' })).not.toThrow();
  });

  it('[S-05g] hysteresis counter is bounded 0..3 and resolution cannot precede the trigger', () => {
    insertAlert();
    expect(() => db.prepare(`UPDATE operational_alerts SET consecutive_clear_cycles = 4`).run()).toThrow(/CHECK/);
    expect(() => db.prepare(`UPDATE operational_alerts SET resolved_at_ms = ?`).run(T0 - 1)).toThrow(/CHECK/);
  });

  it('[S-05h] contract Op2 Q2 step 4 statement counts once per 5,000 ms cycle and resolves on the third', () => {
    insertAlert();
    const step = db.prepare(
      `UPDATE operational_alerts SET consecutive_clear_cycles = consecutive_clear_cycles + 1, last_cycle_index = @cycle,
         resolved_at_ms = CASE WHEN consecutive_clear_cycles + 1 >= 3 THEN @now END,
         status = CASE WHEN consecutive_clear_cycles + 1 >= 3 THEN 'CLEARED' ELSE status END
       WHERE trigger_rule = @rule AND node_id = 'CLUSTER' AND resolved_at_ms IS NULL AND (last_cycle_index IS NULL OR last_cycle_index < @cycle)`,
    );
    const run = (now: number) => step.run({ cycle: Math.floor(now / 5000), now, rule: RULE }).changes;
    const state = () => db.prepare(`SELECT consecutive_clear_cycles AS c, status, resolved_at_ms AS r FROM operational_alerts`).get();
    expect([run(T0 + 5000), run(T0 + 5100)]).toEqual([1, 0]);
    expect(run(T0 + 10_000)).toBe(1);
    expect(run(T0 + 15_000)).toBe(1);
    expect(state()).toEqual({ c: 3, status: 'CLEARED', r: T0 + 15_000 });
    expect(run(T0 + 20_000)).toBe(0);
  });
});

describe('INV-06 / AD-06: every GPU-hour is fully accounted for', () => {
  const insertRollup = (busy: number, idle: number, unavailable: number, hour = 3600) =>
    db
      .prepare(
        `INSERT INTO rollup_hourly_metrics (node_id, gpu_index, hour_epoch, gpu_hours_busy, gpu_hours_idle, gpu_hours_unavailable,
           prompt_tokens_total, completion_tokens_total, primary_subject, created_at_ms) VALUES ('ws-gpu-01', 0, ?, ?, ?, ?, 0, 0, 'IDLE', ?)`,
      )
      .run(hour, busy, idle, unavailable, T0);

  it.each([[0.5, 0.5, 0], [0.25, 0.25, 0.5], [0, 0, 1], [1, 0, 0]])('[S-06a] accepts busy=%s idle=%s unavailable=%s (sum = 1.0)', (b, i, u) => {
    expect(() => insertRollup(b, i, u)).not.toThrow();
  });

  it.each([[0.5, 0.4, 0], [0.7, 0.4, 0], [0, 0, 0], [0.5, 0.5, 0.1]])('[S-06b] rejects busy=%s idle=%s unavailable=%s (sum != 1.0)', (b, i, u) => {
    expect(() => insertRollup(b, i, u)).toThrow(/chk_hourly_gpu_sum|CHECK/);
  });

  it('[S-06c] one rollup row per (node, gpu, hour)', () => {
    insertRollup(0.5, 0.5, 0);
    expect(() => insertRollup(0.5, 0.5, 0)).toThrow(/UNIQUE|PRIMARY/);
  });

  it('[S-06d] a rollup row must reference a registered GPU (FK)', () => {
    expect(() =>
      db.prepare(`INSERT INTO rollup_hourly_metrics VALUES ('ws-gpu-99', 0, 3600, 0.5, 0.5, 0, 0, 0, 'IDLE', 1)`).run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('INV-08 / AD-08: server-gpu-01 tracks two GPUs, workstations exactly one', () => {
  const insertNode = (id: string, gpu: number, type: string, vram: number) =>
    db.prepare(`INSERT INTO cluster_nodes VALUES (?, ?, ?, ?, 'HEALTHY', ?, ?)`).run(id, gpu, type, vram, T0, T0);

  it('[S-08a] seed has 33 GPU rows: 31 workstations and 2 on server-gpu-01', () => {
    expect(count(db, 'cluster_nodes')).toBe(33);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM cluster_nodes WHERE node_id = 'server-gpu-01'`).get()).toEqual({ n: 2 });
  });
  it('[S-08b] rejects a second GPU on a workstation', () => {
    db.prepare(`DELETE FROM cluster_nodes WHERE node_id = 'ws-gpu-01'`).run();
    expect(() => insertNode('ws-gpu-01', 1, 'WORKSTATION', WS_VRAM_BYTES)).toThrow(/CHECK/);
  });
  it('[S-08c] rejects VRAM that does not match the node type', () => {
    db.prepare(`DELETE FROM cluster_nodes WHERE node_id = 'ws-gpu-01'`).run();
    expect(() => insertNode('ws-gpu-01', 0, 'WORKSTATION', SERVER_VRAM_BYTES)).toThrow(/CHECK/);
  });
  it('[S-08d] rejects a CENTRAL_SERVER row that is not server-gpu-01', () => {
    db.prepare(`DELETE FROM cluster_nodes WHERE node_id = 'ws-gpu-01'`).run();
    expect(() => insertNode('ws-gpu-01', 0, 'CENTRAL_SERVER', SERVER_VRAM_BYTES)).toThrow(/CHECK/);
  });
  it('[S-08e] rejects gpu_index outside {0, 1}', () => {
    expect(() => insertNode('server-gpu-01', 2, 'CENTRAL_SERVER', SERVER_VRAM_BYTES)).toThrow(/CHECK/);
  });
});

describe('AD-01 / AD-02: telemetry bucket integrity', () => {
  const bucket = (over: Record<string, unknown> = {}) => ({
    id: 'B', node: 'ws-gpu-05', gpu: 0, start: T0, tmin: 50, tmax: 60, tavg: 55, vram: 1, util: 50, count: 10, now: T0, ...over,
  });
  const insert = (b: ReturnType<typeof bucket>, verb = 'INSERT') =>
    db
      .prepare(
        `${verb} INTO telemetry_buckets (bucket_id, node_id, gpu_index, bucket_start_ms, temperature_min, temperature_max, temperature_avg,
           vram_used_bytes, gpu_utilization_pct, event_count, created_at_ms) VALUES (@id, @node, @gpu, @start, @tmin, @tmax, @tavg, @vram, @util, @count, @now)`,
      )
      .run(b);

  it('[S-01a] INSERT OR IGNORE makes a duplicate (node, gpu, bucket_start) idempotent', () => {
    expect(insert(bucket(), 'INSERT OR IGNORE').changes).toBe(1);
    expect(insert(bucket({ id: 'B2' }), 'INSERT OR IGNORE').changes).toBe(0);
    expect(count(db, 'telemetry_buckets')).toBe(1);
  });
  it('[S-01b] a plain duplicate insert is a constraint violation', () => {
    insert(bucket());
    expect(() => insert(bucket({ id: 'B2' }))).toThrow(/UNIQUE|PRIMARY/);
  });
  it('[S-01c] the two GPUs of server-gpu-01 are separate series', () => {
    insert(bucket({ node: 'server-gpu-01', gpu: 0, tmin: 40, tmax: 41, tavg: 40 }));
    insert(bucket({ id: 'B2', node: 'server-gpu-01', gpu: 1, tmin: 80, tmax: 81, tavg: 80 }));
    expect(db.prepare(`SELECT temperature_avg AS t FROM telemetry_buckets ORDER BY gpu_index`).all()).toEqual([{ t: 40 }, { t: 80 }]);
  });
  it.each([[-20.1, 55], [50, 120.1]])('[S-01d] rejects temperatures outside [-20, 120] (min=%s max=%s)', (tmin, tmax) => {
    expect(() => insert(bucket({ tmin, tmax }))).toThrow(/CHECK/);
  });
  it('[S-01e] rejects utilization above 100 and min above max', () => {
    expect(() => insert(bucket({ util: 100.1 }))).toThrow(/CHECK/);
    expect(() => insert(bucket({ tmin: 61 }))).toThrow(/CHECK/);
  });
});

describe('AD-04: node heartbeat state machine guard', () => {
  it('[S-04a] SILENT_TIMEOUT requires at least 3 missed intervals', () => {
    const ins = (missed: number) =>
      db.prepare(`INSERT OR REPLACE INTO node_heartbeats VALUES ('ws-gpu-22', ?, ?, 0, 'SILENT_TIMEOUT', ?)`).run(T0, missed, T0);
    expect(() => ins(2)).toThrow(/CHECK/);
    expect(() => ins(3)).not.toThrow();
  });
  it('[S-04b] rejects an unknown state name', () => {
    expect(() => db.prepare(`INSERT INTO node_heartbeats VALUES ('ws-gpu-22', ?, 0, 0, 'ASLEEP', ?)`).run(T0, T0)).toThrow(/CHECK/);
  });
});
