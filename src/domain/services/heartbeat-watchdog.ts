import type { NodeStateType } from '../../dto';
import type { ClockPort } from '../../ports/out/clock.port';
import { NotImplementedError } from '../../shared/errors';

export interface NodeStateChange {
  node_id: string;
  previous_state: NodeStateType;
  new_state: NodeStateType;
  at_ms: number;
}

/** AD-04 / INV-04: HEALTHY < 5 s, STALE 5-15 s, SILENT_TIMEOUT >= 15 s, RECOVERING needs 3 consecutive heartbeats. */
export class NodeHeartbeatWatchdog {
  constructor(_clock: ClockPort, _nodeIds: readonly string[]) {
    throw new NotImplementedError('NodeHeartbeatWatchdog constructor');
  }
  recordHeartbeat(_nodeId: string, _atMs: number): void {
    throw new NotImplementedError('NodeHeartbeatWatchdog.recordHeartbeat');
  }
  /** Evaluates every node against the clock and returns the state changes it applied. */
  check(): NodeStateChange[] {
    throw new NotImplementedError('NodeHeartbeatWatchdog.check');
  }
  stateOf(_nodeId: string): NodeStateType {
    throw new NotImplementedError('NodeHeartbeatWatchdog.stateOf');
  }
}
