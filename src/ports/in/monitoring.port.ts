export interface NodeStateChangeDTO {
  node_id: string;
  previous_state: string;
  new_state: string;
  at_ms: number;
}

/**
 * The scheduler entry point, called every 1,000 ms (PRD FR-02): advances the heartbeat watchdog, captures the forensic
 * record when a node leaves HEALTHY (Op4 capture clause) and drops it when the node is HEALTHY again.
 */
export interface MonitoringPort {
  tick(): Promise<NodeStateChangeDTO[]>;
}
