import type { CordonPort, CordonResultDTO } from '../../ports/in/cordon.port';
import type { ClockPort } from '../../ports/out/clock.port';
import type { EventDispatcherPort } from '../../ports/out/event-dispatcher.port';
import { FLEET_NODE_IDS } from '../../domain/models/fleet';
import { ContractError } from '../../shared/errors';

/**
 * Tracks which nodes an operator has cordoned and emits one `node.cordoned` audit event per transition.
 * Node.js runs this synchronously between awaits, so check-then-add on the Set cannot interleave: two concurrent
 * requests for the same node produce exactly one event.
 */
export class NodeCordonService implements CordonPort {
  private readonly cordoned = new Map<string, CordonResultDTO>();

  constructor(
    private readonly clock: ClockPort,
    private readonly events: EventDispatcherPort,
  ) {}

  async cordonNode(nodeId: string, operator: string): Promise<CordonResultDTO> {
    const nowMs = this.clock.nowMs();
    if (!FLEET_NODE_IDS.includes(nodeId)) {
      throw new ContractError({
        error_code: 'ERR_UNKNOWN_NODE_ID',
        http_status: 404,
        message: `Node '${nodeId}' is not registered in the 32-node cluster fleet.`,
        timestamp_ms: nowMs,
        retryable: false,
        details: { node_id: nodeId },
      });
    }

    const existing = this.cordoned.get(nodeId);
    if (existing) return { ...existing, newly_cordoned: false };

    const result: CordonResultDTO = {
      node_id: nodeId,
      state: 'CORDONED',
      cordoned_at_ms: nowMs,
      cordoned_by: operator,
      newly_cordoned: true,
    };
    this.cordoned.set(nodeId, result);
    this.events.emit({
      eventType: 'node.cordoned',
      occurredAtMs: nowMs,
      payload: { node_id: nodeId, cordoned_by: operator, reason: 'operator_triage' },
    });
    return result;
  }

  listCordonedNodeIds(): string[] {
    return [...this.cordoned.keys()];
  }
}
