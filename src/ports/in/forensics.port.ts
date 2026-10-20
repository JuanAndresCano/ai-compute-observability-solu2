import type { NodeForensicsDTO } from '../../dto';

/** contracts.md Operation 4. */
export interface ForensicsPort {
  getNodeForensics(nodeId: string): Promise<NodeForensicsDTO>;
}
