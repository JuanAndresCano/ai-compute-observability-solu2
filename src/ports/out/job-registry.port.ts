import type { ForensicJobDTO } from '../../dto';

/** Simulated scheduler registry: which job was running on a node. */
export interface JobRegistryPort {
  activeJob(nodeId: string): Promise<ForensicJobDTO | null>;
}
