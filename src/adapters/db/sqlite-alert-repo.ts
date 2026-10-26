import type { Database } from 'better-sqlite3';
import type { AlertRepositoryPort, AlertRecord } from '../../ports/out/alert-repository.port';
import { StorageUnavailableError } from '../../shared/errors';

export class SqliteAlertRepo implements AlertRepositoryPort {
  constructor(private readonly db: Database) {}

  async insertActiveIfAbsent(alert: AlertRecord): Promise<{ inserted: boolean; alert: AlertRecord }> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO operational_alerts (
          alert_id, incident_key, node_id, trigger_rule, severity, status,
          observed_baseline_tps, observed_current_tps, spike_ratio, observed_p99_latency_ms,
          explanation_json, triggered_at_ms, resolved_at_ms, consecutive_clear_cycles,
          last_cycle_index, created_at_ms, updated_at_ms
        ) VALUES (
          @alert_id, @incident_key, @node_id, @trigger_rule, @severity, @status,
          @observed_baseline_tps, @observed_current_tps, @spike_ratio, @observed_p99_latency_ms,
          @explanation_json, @triggered_at_ms, @resolved_at_ms, @consecutive_clear_cycles,
          @last_cycle_index, @created_at_ms, @updated_at_ms
        ) ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING
      `);

      const res = stmt.run({
        alert_id: alert.alert_id,
        incident_key: alert.incident_key,
        node_id: alert.node_id,
        trigger_rule: alert.trigger_rule,
        severity: alert.severity ?? 'CRITICAL',
        status: alert.status ?? 'TRIGGERED',
        observed_baseline_tps: alert.observed_baseline_tps ?? 0,
        observed_current_tps: alert.observed_current_tps ?? 0,
        spike_ratio: alert.spike_ratio ?? 0,
        observed_p99_latency_ms: alert.observed_p99_latency_ms ?? 0,
        explanation_json: alert.explanation_json ?? '{}',
        triggered_at_ms: alert.triggered_at_ms,
        resolved_at_ms: alert.resolved_at_ms,
        consecutive_clear_cycles: alert.consecutive_clear_cycles ?? 0,
        last_cycle_index: alert.last_cycle_index ?? null,
        created_at_ms: alert.created_at_ms ?? alert.triggered_at_ms,
        updated_at_ms: alert.updated_at_ms ?? alert.triggered_at_ms,
      });

      if (res.changes === 1) {
        return { inserted: true, alert };
      }

      const existing = this.db
        .prepare(
          `SELECT * FROM operational_alerts WHERE trigger_rule = ? AND node_id = ? AND resolved_at_ms IS NULL`,
        )
        .get(alert.trigger_rule, alert.node_id) as any;

      if (!existing) {
        return { inserted: false, alert };
      }

      return {
        inserted: false,
        alert: {
          alert_id: existing.alert_id,
          incident_key: existing.incident_key,
          node_id: existing.node_id,
          trigger_rule: existing.trigger_rule,
          status: existing.status,
          triggered_at_ms: existing.triggered_at_ms,
          resolved_at_ms: existing.resolved_at_ms,
          consecutive_clear_cycles: existing.consecutive_clear_cycles,
          severity: existing.severity,
          observed_baseline_tps: existing.observed_baseline_tps,
          observed_current_tps: existing.observed_current_tps,
          spike_ratio: existing.spike_ratio,
          observed_p99_latency_ms: existing.observed_p99_latency_ms,
          explanation_json: existing.explanation_json,
          last_cycle_index: existing.last_cycle_index,
          created_at_ms: existing.created_at_ms,
          updated_at_ms: existing.updated_at_ms,
        },
      };
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async resetClearCounter(triggerRule: string, nodeId: string): Promise<AlertRecord | null> {
    try {
      this.db
        .prepare(
          `UPDATE operational_alerts
           SET consecutive_clear_cycles = 0
           WHERE trigger_rule = ? AND node_id = ? AND resolved_at_ms IS NULL`,
        )
        .run(triggerRule, nodeId);

      const existing = this.db
        .prepare(
          `SELECT * FROM operational_alerts WHERE trigger_rule = ? AND node_id = ? AND resolved_at_ms IS NULL`,
        )
        .get(triggerRule, nodeId) as any;

      if (!existing) return null;

      return {
        alert_id: existing.alert_id,
        incident_key: existing.incident_key,
        node_id: existing.node_id,
        trigger_rule: existing.trigger_rule,
        status: existing.status,
        triggered_at_ms: existing.triggered_at_ms,
        resolved_at_ms: existing.resolved_at_ms,
        consecutive_clear_cycles: existing.consecutive_clear_cycles,
        severity: existing.severity,
        observed_baseline_tps: existing.observed_baseline_tps,
        observed_current_tps: existing.observed_current_tps,
        spike_ratio: existing.spike_ratio,
        observed_p99_latency_ms: existing.observed_p99_latency_ms,
        explanation_json: existing.explanation_json,
        last_cycle_index: existing.last_cycle_index,
        created_at_ms: existing.created_at_ms,
        updated_at_ms: existing.updated_at_ms,
      };
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async countClearCycle(triggerRule: string, nodeId: string, cycleIndex: number, nowMs: number): Promise<AlertRecord | null> {
    try {
      const stmt = this.db.prepare(`
        UPDATE operational_alerts
        SET consecutive_clear_cycles = consecutive_clear_cycles + 1,
            last_cycle_index = @cycle,
            resolved_at_ms = CASE WHEN consecutive_clear_cycles + 1 >= 3 THEN @now END,
            status = CASE WHEN consecutive_clear_cycles + 1 >= 3 THEN 'CLEARED' ELSE status END,
            updated_at_ms = @now
        WHERE trigger_rule = @rule AND node_id = @nodeId AND resolved_at_ms IS NULL
          AND (last_cycle_index IS NULL OR last_cycle_index < @cycle)
      `);

      const res = stmt.run({
        cycle: cycleIndex,
        now: nowMs,
        rule: triggerRule,
        nodeId,
      });

      const current = this.db
        .prepare(
          `SELECT * FROM operational_alerts
           WHERE trigger_rule = ? AND node_id = ?
           ORDER BY triggered_at_ms DESC
           LIMIT 1`,
        )
        .get(triggerRule, nodeId) as any;

      if (!current) return null;

      if (res.changes === 0 && current.resolved_at_ms !== null) {
        // Was already resolved in a prior cycle; no active alert existed
        return null;
      }

      return {
        alert_id: current.alert_id,
        incident_key: current.incident_key,
        node_id: current.node_id,
        trigger_rule: current.trigger_rule,
        status: current.status,
        triggered_at_ms: current.triggered_at_ms,
        resolved_at_ms: current.resolved_at_ms,
        consecutive_clear_cycles: current.consecutive_clear_cycles,
        severity: current.severity,
        observed_baseline_tps: current.observed_baseline_tps,
        observed_current_tps: current.observed_current_tps,
        spike_ratio: current.spike_ratio,
        observed_p99_latency_ms: current.observed_p99_latency_ms,
        explanation_json: current.explanation_json,
        last_cycle_index: current.last_cycle_index,
        created_at_ms: current.created_at_ms,
        updated_at_ms: current.updated_at_ms,
      };
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }

  async getActiveAlerts(): Promise<AlertRecord[]> {
    try {
      const rows = this.db
        .prepare(`SELECT * FROM operational_alerts WHERE resolved_at_ms IS NULL ORDER BY triggered_at_ms DESC`)
        .all() as any[];

      return rows.map((r) => ({
        alert_id: r.alert_id,
        incident_key: r.incident_key,
        node_id: r.node_id,
        trigger_rule: r.trigger_rule,
        status: r.status,
        triggered_at_ms: r.triggered_at_ms,
        resolved_at_ms: r.resolved_at_ms,
        consecutive_clear_cycles: r.consecutive_clear_cycles,
        severity: r.severity,
        observed_baseline_tps: r.observed_baseline_tps,
        observed_current_tps: r.observed_current_tps,
        spike_ratio: r.spike_ratio,
        observed_p99_latency_ms: r.observed_p99_latency_ms,
        explanation_json: r.explanation_json,
        last_cycle_index: r.last_cycle_index,
        created_at_ms: r.created_at_ms,
        updated_at_ms: r.updated_at_ms,
      }));
    } catch (err: any) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError(err?.message);
    }
  }
}
