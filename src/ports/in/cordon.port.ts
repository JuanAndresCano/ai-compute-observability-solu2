export interface CordonResultDTO {
  node_id: string;
  state: 'CORDONED';
  cordoned_at_ms: number;
  cordoned_by: string;
  /** false when the node was already cordoned: the call is idempotent and emits no second audit event. */
  newly_cordoned: boolean;
}

/** Story 11.6: operator isolates an unhealthy node from the scheduler (Flow E, "Cordon Node from Cluster"). */
export interface CordonPort {
  /** Rejects with ContractError ERR_UNKNOWN_NODE_ID (404) for ids outside the 32-node fleet. */
  cordonNode(nodeId: string, operator: string): Promise<CordonResultDTO>;
  listCordonedNodeIds(): string[];
}
