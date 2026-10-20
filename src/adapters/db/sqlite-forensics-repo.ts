import type { Database } from 'better-sqlite3';
import type { ForensicsRepositoryPort, ForensicRecord } from '../../ports/out/forensics-repository.port';
import { NotImplementedError } from '../../shared/errors';

export class SqliteForensicsRepo implements ForensicsRepositoryPort {
  constructor(_db: Database) {}
  async captureIfAbsent(_record: ForensicRecord): Promise<boolean> {
    throw new NotImplementedError('SqliteForensicsRepo.captureIfAbsent');
  }
  async load(_nodeId: string): Promise<ForensicRecord | null> {
    throw new NotImplementedError('SqliteForensicsRepo.load');
  }
  async clear(_nodeId: string): Promise<void> {
    throw new NotImplementedError('SqliteForensicsRepo.clear');
  }
}
