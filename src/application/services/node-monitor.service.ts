import type { MonitoringPort, NodeStateChangeDTO } from '../../ports/in/monitoring.port';
import { NotImplementedError } from '../../shared/errors';
import type { Deps } from '../../composition';

export class NodeMonitorService implements MonitoringPort {
  constructor(_deps: Deps) {}
  async tick(): Promise<NodeStateChangeDTO[]> {
    throw new NotImplementedError('NodeMonitorService.tick');
  }
}
