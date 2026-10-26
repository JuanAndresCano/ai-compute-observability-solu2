/**
 * AD-04 / INV-04: Heartbeat Watchdog state machine for node liveness tracking.
 * State boundaries:
 *  - silence < 5,000 ms: HEALTHY
 *  - 5,000 ms <= silence < 15,000 ms: STALE
 *  - silence >= 15,000 ms: SILENT_TIMEOUT
 *  - Recovery from SILENT_TIMEOUT: requires 3 consecutive heartbeats (RECOVERING -> RECOVERING -> HEALTHY).
 */
import type { NodeStateType } from '../../dto';
import type { ClockPort } from '../../ports/out/clock.port';

export interface NodeStateChange {
  node_id: string;
  previous_state: NodeStateType;
  new_state: NodeStateType;
  at_ms: number;
}

interface NodeTrack {
  node_id: string;
  state: NodeStateType;
  lastStateInCheck: NodeStateType;
  lastHeartbeatMs: number;
  consecutiveRecoveryHeartbeats: number;
}

export class NodeHeartbeatWatchdog {
  private readonly nodes = new Map<string, NodeTrack>();

  constructor(private readonly clock: ClockPort, nodeIds: readonly string[]) {
    const now = clock.nowMs();
    for (const id of nodeIds) {
      this.nodes.set(id, {
        node_id: id,
        state: 'HEALTHY',
        lastStateInCheck: 'HEALTHY',
        lastHeartbeatMs: now,
        consecutiveRecoveryHeartbeats: 0,
      });
    }
  }

  recordHeartbeat(nodeId: string, atMs: number): void {
    let track = this.nodes.get(nodeId);
    if (!track) {
      track = {
        node_id: nodeId,
        state: 'HEALTHY',
        lastStateInCheck: 'HEALTHY',
        lastHeartbeatMs: atMs,
        consecutiveRecoveryHeartbeats: 0,
      };
      this.nodes.set(nodeId, track);
    }

    track.lastHeartbeatMs = atMs;

    if (track.state === 'SILENT_TIMEOUT') {
      track.state = 'RECOVERING';
      track.consecutiveRecoveryHeartbeats = 1;
    } else if (track.state === 'RECOVERING') {
      track.consecutiveRecoveryHeartbeats++;
      if (track.consecutiveRecoveryHeartbeats >= 3) {
        track.state = 'HEALTHY';
        track.consecutiveRecoveryHeartbeats = 0;
      }
    } else if (track.state === 'STALE') {
      track.state = 'HEALTHY';
      track.consecutiveRecoveryHeartbeats = 0;
    }
  }

  check(): NodeStateChange[] {
    const now = this.clock.nowMs();
    const changes: NodeStateChange[] = [];

    for (const track of this.nodes.values()) {
      const silence = now - track.lastHeartbeatMs;

      if (track.state === 'HEALTHY') {
        if (silence >= 15000) {
          track.state = 'SILENT_TIMEOUT';
          track.consecutiveRecoveryHeartbeats = 0;
        } else if (silence >= 5000) {
          track.state = 'STALE';
        }
      } else if (track.state === 'STALE') {
        if (silence >= 15000) {
          track.state = 'SILENT_TIMEOUT';
          track.consecutiveRecoveryHeartbeats = 0;
        } else if (silence < 5000) {
          track.state = 'HEALTHY';
        }
      } else if (track.state === 'RECOVERING') {
        if (silence >= 15000) {
          track.state = 'SILENT_TIMEOUT';
          track.consecutiveRecoveryHeartbeats = 0;
        } else if (silence >= 5000) {
          // Missed an expected 5-second interval; resets consecutive recovery count
          track.consecutiveRecoveryHeartbeats = 0;
        }
      }

      if (track.state !== track.lastStateInCheck) {
        changes.push({
          node_id: track.node_id,
          previous_state: track.lastStateInCheck,
          new_state: track.state,
          at_ms: now,
        });
        track.lastStateInCheck = track.state;
      }
    }

    return changes;
  }

  stateOf(nodeId: string): NodeStateType {
    return this.nodes.get(nodeId)?.state ?? 'HEALTHY';
  }
}
