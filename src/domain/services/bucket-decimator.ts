import type { NodeTelemetryPacketDTO } from '../../dto';
import type { ClockPort } from '../../ports/out/clock.port';
import type { TelemetryRingBuffer } from '../models/telemetry-ring-buffer';
import { NotImplementedError } from '../../shared/errors';

export interface ScalarStats {
  min: number;
  max: number;
  sum: number;
  count: number;
  last: number;
}

/** Summary tuple of one GPU series over one closed 250 ms window [bucket_start_ms, bucket_start_ms + 250). */
export interface DecimatedBucket {
  node_id: string;
  gpu_index: number;
  bucket_start_ms: number;
  temperature_celsius: ScalarStats;
  vram_used_bytes: ScalarStats;
  gpu_utilization_pct: ScalarStats;
}

/** AD-01 / INV-01: 250 ms decimation windows, at most 4 dispatches per second. */
export class BucketDecimator {
  constructor(
    _deps: { clock: ClockPort; ring: TelemetryRingBuffer; onDispatch: (closed: readonly DecimatedBucket[]) => void },
  ) {
    throw new NotImplementedError('BucketDecimator constructor');
  }
  /** Raw events accepted and not yet folded into a closed bucket. */
  get occupancy(): number {
    throw new NotImplementedError('BucketDecimator.occupancy');
  }
  accumulate(_events: readonly NodeTelemetryPacketDTO[]): void {
    throw new NotImplementedError('BucketDecimator.accumulate');
  }
}
