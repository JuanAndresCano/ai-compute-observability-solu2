import type { NodeForensicsDTO } from '../../dto';
import type { ForensicsPort } from '../../ports/in/forensics.port';
import { NotImplementedError } from '../../shared/errors';
import type { Deps } from '../../composition';

export class ForensicsService implements ForensicsPort {
  constructor(_deps: Deps) {}
  async getNodeForensics(_nodeId: string): Promise<NodeForensicsDTO> {
    throw new NotImplementedError('ForensicsService.getNodeForensics');
  }
}
