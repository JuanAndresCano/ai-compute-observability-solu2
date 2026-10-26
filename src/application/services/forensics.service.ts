import type { NodeForensicsDTO, ForensicNodeStateType } from '../../dto';
import type { ForensicsPort } from '../../ports/in/forensics.port';
import type { Deps } from '../../composition';
import type { NodeHeartbeatWatchdog } from '../../domain/services/heartbeat-watchdog';
import { ContractError, StorageUnavailableError } from '../../shared/errors';

const NODE_ID_REGEX = /^(ws-gpu-(0[1-9]|[12][0-9]|3[01])|server-gpu-01)$/;

export class ForensicsService implements ForensicsPort {
  constructor(
    private readonly deps: Deps,
    private readonly watchdog?: NodeHeartbeatWatchdog,
  ) {}

  async getNodeForensics(nodeId: string): Promise<NodeForensicsDTO> {
    const nowMs = this.deps.clock.nowMs();

    // P1: Validate node ID
    if (!nodeId || !NODE_ID_REGEX.test(nodeId)) {
      throw new ContractError({
        error_code: 'ERR_UNKNOWN_NODE_ID',
        http_status: 404,
        message: `Node '${nodeId}' is not registered in the 32-node cluster fleet.`,
        timestamp_ms: nowMs,
        retryable: false,
        details: { node_id: nodeId },
      });
    }

    // P2: Node state must not be HEALTHY
    const state = (this.watchdog?.stateOf(nodeId) ?? 'HEALTHY') as ForensicNodeStateType;
    if (state === ('HEALTHY' as any)) {
      throw new ContractError({
        error_code: 'ERR_NODE_HEALTHY',
        http_status: 409,
        message: `Node '${nodeId}' is HEALTHY; forensics exist only for STALE, SILENT_TIMEOUT, RECOVERING or CORDONED nodes.`,
        timestamp_ms: nowMs,
        retryable: false,
        details: { node_id: nodeId, state },
      });
    }

    try {
      const record = await this.deps.forensics.load(nodeId);
      const lastHeartbeatMs = record?.last_heartbeat_ms ?? nowMs - 5000;
      const silenceDurationMs = nowMs - lastHeartbeatMs;

      const timeline = await this.deps.telemetry.readTimeline(nodeId, lastHeartbeatMs - 300_000, lastHeartbeatMs);
      const degradationTimeline = timeline.slice(-1200).map((t) => ({
        timestamp_ms: (t as any).timestamp_ms ?? (t as any).bucket_start_ms,
        temperature_celsius: (t as any).temperature_celsius ?? (t as any).temperature_max,
        vram_used_bytes: t.vram_used_bytes,
      }));

      const logTail: string[] = record?.log_tail_json ? JSON.parse(record.log_tail_json) : [];
      let lastSnapshot = record?.last_snapshot_json ? JSON.parse(record.last_snapshot_json) : null;
      if (typeof lastSnapshot === 'string') {
        try {
          lastSnapshot = JSON.parse(lastSnapshot);
        } catch {
          // keep as is
        }
      }
      const lastJob = record?.last_job_json ? JSON.parse(record.last_job_json) : null;
      const recommendation = state === 'SILENT_TIMEOUT' ? 'CORDON_RECOMMENDED' : 'NONE';

      // Q3: Audit event and metric
      this.deps.events.emit({
        eventType: 'node.forensics.viewed',
        occurredAtMs: nowMs,
        payload: {
          node_id: nodeId,
          state,
          actor: 'OPERATOR',
        },
      });

      this.deps.metrics.increment('forensic_views_total', { state }, 1);

      return {
        node_id: nodeId,
        state,
        silence_duration_ms: silenceDurationMs,
        last_snapshot: lastSnapshot,
        degradation_timeline: degradationTimeline,
        log_tail: logTail,
        last_job: lastJob,
        recommendation,
        explanation: {
          rule_id: 'AD-04-WATCHDOG',
          observed_values: {
            silence_duration_ms: silenceDurationMs,
            consecutive_missed: Math.floor(silenceDurationMs / 5000),
            state,
          },
          thresholds: {
            timeout_ms: 15_000,
            heartbeat_interval_ms: 5000,
          },
          justification_text: `Forensics captured for node ${nodeId} in state ${state} after ${silenceDurationMs} ms silence.`,
        },
      };
    } catch (err: any) {
      if (err instanceof ContractError) throw err;
      throw new ContractError({
        error_code: 'ERR_DATABASE_UNAVAILABLE',
        http_status: 503,
        message: err?.message || 'Storage unavailable',
        timestamp_ms: nowMs,
        retryable: true,
        details: {},
      });
    }
  }
}
