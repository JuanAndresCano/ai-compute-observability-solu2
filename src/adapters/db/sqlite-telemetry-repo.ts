import type { Database } from 'better-sqlite3';
import type { TelemetryRepositoryPort, TelemetryBucketRecord, TimelinePoint } from '../../ports/out/telemetry-repository.port';
import { NotImplementedError } from '../../shared/errors';

export class SqliteTelemetryRepo implements TelemetryRepositoryPort {
  constructor(_db: Database) {}
  async commitBuckets(_buckets: readonly TelemetryBucketRecord[]): Promise<void> {
    throw new NotImplementedError('SqliteTelemetryRepo.commitBuckets');
  }
  async lastSnapshot(_nodeId: string): Promise<string | null> {
    throw new NotImplementedError('SqliteTelemetryRepo.lastSnapshot');
  }
  async readTimeline(_nodeId: string, _fromMs: number, _toMs: number): Promise<TimelinePoint[]> {
    throw new NotImplementedError('SqliteTelemetryRepo.readTimeline');
  }
  async registerBatch(_batchId: string): Promise<boolean> {
    throw new NotImplementedError('SqliteTelemetryRepo.registerBatch');
  }
}
