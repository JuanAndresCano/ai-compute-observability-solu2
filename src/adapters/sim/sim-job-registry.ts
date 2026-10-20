import type { ForensicJobDTO } from '../../dto';
import type { JobRegistryPort } from '../../ports/out/job-registry.port';

/** Test double: the job each node is running. */
export class SimJobRegistry implements JobRegistryPort {
  private readonly jobs = new Map<string, ForensicJobDTO>();

  setJob(nodeId: string, job: ForensicJobDTO): void {
    this.jobs.set(nodeId, job);
  }

  async activeJob(nodeId: string): Promise<ForensicJobDTO | null> {
    return this.jobs.get(nodeId) ?? null;
  }
}
