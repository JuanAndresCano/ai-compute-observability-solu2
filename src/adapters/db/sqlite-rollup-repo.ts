import type { Database } from 'better-sqlite3';
import type { RollupRepositoryPort, HourlyRollupRecord } from '../../ports/out/rollup-repository.port';
import { NotImplementedError } from '../../shared/errors';

export class SqliteRollupRepo implements RollupRepositoryPort {
  constructor(_db: Database) {}
  async queryHourly(_f: number, _t: number, _s: readonly string[]): Promise<HourlyRollupRecord[]> {
    throw new NotImplementedError('SqliteRollupRepo.queryHourly');
  }
}
