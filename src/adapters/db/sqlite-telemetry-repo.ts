import type { Database } from 'better-sqlite3';
import type { TelemetryRepositoryPort, TelemetryBucketRecord } from '../../ports/out/telemetry-repository.port';
import { NotImplementedError } from '../../shared/errors';

export class SqliteTelemetryRepo implements TelemetryRepositoryPort {
  constructor(_db: Database) {}
  async commitBuckets(_buckets: readonly TelemetryBucketRecord[]): Promise<void> {
    throw new NotImplementedError('SqliteTelemetryRepo.commitBuckets');
  }
  async registerBatch(_batchId: string): Promise<boolean> {
    throw new NotImplementedError('SqliteTelemetryRepo.registerBatch');
  }
}
