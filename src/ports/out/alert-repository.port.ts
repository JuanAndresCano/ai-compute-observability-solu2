export interface AlertRecord {
  alert_id: string;
  incident_key: string;
  node_id: string;
  trigger_rule: string;
  status: 'TRIGGERED' | 'CLEARED' | 'ACKNOWLEDGED';
  triggered_at_ms: number;
  resolved_at_ms: number | null;
  consecutive_clear_cycles: number;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  observed_baseline_tps?: number;
  observed_current_tps?: number;
  spike_ratio?: number;
  observed_p99_latency_ms?: number;
  explanation_json?: string;
  last_cycle_index?: number | null;
  created_at_ms?: number;
  updated_at_ms?: number;
}

export interface AlertRepositoryPort {
  /** One atomic INSERT ... ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING. */
  insertActiveIfAbsent(alert: AlertRecord): Promise<{ inserted: boolean; alert: AlertRecord }>;
  /** Unconditional reset used when a breach is seen while an alert is active (contracts.md Op2 Q2 step 5). */
  resetClearCounter(triggerRule: string, nodeId: string): Promise<AlertRecord | null>;
  /** One conditional UPDATE per 5,000 ms cycle (Op2 Q2 step 4); returns the alert after the update, or null if none is active. */
  countClearCycle(triggerRule: string, nodeId: string, cycleIndex: number, nowMs: number): Promise<AlertRecord | null>;
  /** Returns all currently active (unresolved) operational alerts. */
  getActiveAlerts?(): Promise<AlertRecord[]>;
}
