import type { Database } from 'better-sqlite3';
import type { AlertRepositoryPort, AlertRecord } from '../../ports/out/alert-repository.port';
import { NotImplementedError } from '../../shared/errors';

export class SqliteAlertRepo implements AlertRepositoryPort {
  constructor(_db: Database) {}
  async insertActiveIfAbsent(_alert: AlertRecord): Promise<{ inserted: boolean; alert: AlertRecord }> {
    throw new NotImplementedError('SqliteAlertRepo.insertActiveIfAbsent');
  }
  async resetClearCounter(_triggerRule: string, _nodeId: string): Promise<void> {
    throw new NotImplementedError('SqliteAlertRepo.resetClearCounter');
  }
  async countClearCycle(_r: string, _n: string, _c: number, _t: number): Promise<AlertRecord | null> {
    throw new NotImplementedError('SqliteAlertRepo.countClearCycle');
  }
}
