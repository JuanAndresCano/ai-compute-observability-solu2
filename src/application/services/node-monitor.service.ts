/**
 * Application service for node monitoring & heartbeat tracking.
 * Advances the watchdog every scheduler tick (1,000 ms).
 */
import type { MonitoringPort, NodeStateChangeDTO } from '../../ports/in/monitoring.port';
import type { NodeHeartbeatWatchdog } from '../../domain/services/heartbeat-watchdog';
import type { Deps } from '../../composition';

export class NodeMonitorService implements MonitoringPort {
  constructor(
    private readonly watchdog: NodeHeartbeatWatchdog,
    private readonly deps?: Deps,
  ) {}

  async tick(): Promise<NodeStateChangeDTO[]> {
    const changes = this.watchdog.check();

    if (this.deps) {
      for (const c of changes) {
        if (c.previous_state === 'HEALTHY' && c.new_state !== 'HEALTHY') {
          try {
            // Node left HEALTHY -> capture forensics if absent
            const lastSnapshotStr = await this.deps.telemetry.lastSnapshot(c.node_id);
            let lastSnapshot: any = null;
            if (lastSnapshotStr) {
              try {
                lastSnapshot = typeof lastSnapshotStr === 'string' ? JSON.parse(lastSnapshotStr) : lastSnapshotStr;
              } catch {
                // ignore malformed snapshot
              }
            }
            const logs = await this.deps.logs.tail(c.node_id, 50);
            const job = await this.deps.jobs.activeJob(c.node_id);

            await this.deps.forensics.captureIfAbsent({
              node_id: c.node_id,
              last_heartbeat_ms: lastSnapshot?.timestamp_ms ?? c.at_ms - 5000,
              last_snapshot_json: lastSnapshot ? JSON.stringify(lastSnapshot) : null,
              log_tail_json: JSON.stringify(logs.slice(-50)),
              last_job_json: job ? JSON.stringify(job) : null,
              captured_at_ms: c.at_ms,
            });
          } catch {
            // Background tick capture errors are swallowed to keep monitor alive
          }
        } else if (c.new_state === 'HEALTHY') {
          try {
            // Node returned to HEALTHY -> clear forensics
            await this.deps.forensics.clear(c.node_id);
          } catch {
            // Background clear errors are swallowed
          }
        }
      }
    }

    return changes.map((c) => ({
      node_id: c.node_id,
      previous_state: c.previous_state,
      new_state: c.new_state,
      at_ms: c.at_ms,
    }));
  }
}
