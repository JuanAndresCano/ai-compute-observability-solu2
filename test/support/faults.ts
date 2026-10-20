import { StorageUnavailableError } from '../../src/shared/errors';
import type { TelemetryRepositoryPort } from '../../src/ports/out/telemetry-repository.port';
import type { AlertRepositoryPort } from '../../src/ports/out/alert-repository.port';
import type { ForensicsRepositoryPort } from '../../src/ports/out/forensics-repository.port';
import type { RollupRepositoryPort } from '../../src/ports/out/rollup-repository.port';

/** Fault injection: every call fails the way a dead storage engine does (maps to ERR_DATABASE_UNAVAILABLE, 503). */
const down = async (): Promise<never> => {
  throw new StorageUnavailableError();
};

export const failingTelemetryRepo: TelemetryRepositoryPort = { commitBuckets: down, registerBatch: down, lastSnapshot: down, readTimeline: down };
export const failingForensicsRepo: ForensicsRepositoryPort = { captureIfAbsent: down, load: down, clear: down };
export const failingAlertRepo: AlertRepositoryPort = { insertActiveIfAbsent: down, resetClearCounter: down, countClearCycle: down };
export const failingRollupRepo: RollupRepositoryPort = { queryHourly: down };
