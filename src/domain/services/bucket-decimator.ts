/**
 * AD-01 / INV-01: 250 ms decimation windowing service.
 * Enforces half-open temporal windows [bucket_start_ms, bucket_start_ms + 250).
 * Bounded UI dispatch frequency (at most 4 dispatches per second).
 */
import type { NodeTelemetryPacketDTO } from '../../dto';
import type { ClockPort } from '../../ports/out/clock.port';
import type { TelemetryRingBuffer } from '../models/telemetry-ring-buffer';

export interface ScalarStats {
  min: number;
  max: number;
  sum: number;
  count: number;
  last: number;
}

export interface DecimatedBucket {
  node_id: string;
  gpu_index: number;
  bucket_start_ms: number;
  temperature_celsius: ScalarStats;
  vram_used_bytes: ScalarStats;
  gpu_utilization_pct: ScalarStats;
}

interface MutableBucket {
  node_id: string;
  gpu_index: number;
  bucket_start_ms: number;
  temperature_celsius: ScalarStats;
  vram_used_bytes: ScalarStats;
  gpu_utilization_pct: ScalarStats;
}

function updateScalar(stat: ScalarStats | undefined, val: number): ScalarStats {
  if (!stat) {
    return { min: val, max: val, sum: val, count: 1, last: val };
  }
  return {
    min: Math.min(stat.min, val),
    max: Math.max(stat.max, val),
    sum: stat.sum + val,
    count: stat.count + 1,
    last: val,
  };
}

export class BucketDecimator {
  public static readonly WINDOW_SIZE_MS = 250;

  private activeWindowStartMs?: number;
  private activeBuckets = new Map<string, MutableBucket>();
  private _occupancy = 0;

  constructor(
    private readonly deps: {
      clock: ClockPort;
      ring: TelemetryRingBuffer;
      onDispatch: (closed: readonly DecimatedBucket[]) => void;
    },
  ) {}

  get occupancy(): number {
    this.checkWindowClose();
    return this._occupancy;
  }

  accumulate(events: readonly NodeTelemetryPacketDTO[]): void {
    this.checkWindowClose();

    const now = this.deps.clock.nowMs();
    if (this.activeWindowStartMs === undefined) {
      this.activeWindowStartMs = Math.floor(now / BucketDecimator.WINDOW_SIZE_MS) * BucketDecimator.WINDOW_SIZE_MS;
    }

    const windowStart = this.activeWindowStartMs;

    for (const ev of events) {
      const key = `${ev.node_id}:${ev.gpu_index}`;
      let b = this.activeBuckets.get(key);
      if (!b) {
        b = {
          node_id: ev.node_id,
          gpu_index: ev.gpu_index,
          bucket_start_ms: windowStart,
          temperature_celsius: { min: ev.temperature_celsius, max: ev.temperature_celsius, sum: ev.temperature_celsius, count: 1, last: ev.temperature_celsius },
          vram_used_bytes: { min: ev.vram_used_bytes, max: ev.vram_used_bytes, sum: ev.vram_used_bytes, count: 1, last: ev.vram_used_bytes },
          gpu_utilization_pct: { min: ev.gpu_utilization_pct, max: ev.gpu_utilization_pct, sum: ev.gpu_utilization_pct, count: 1, last: ev.gpu_utilization_pct },
        };
        this.activeBuckets.set(key, b);
      } else {
        b.temperature_celsius = updateScalar(b.temperature_celsius, ev.temperature_celsius);
        b.vram_used_bytes = updateScalar(b.vram_used_bytes, ev.vram_used_bytes);
        b.gpu_utilization_pct = updateScalar(b.gpu_utilization_pct, ev.gpu_utilization_pct);
      }
      this._occupancy++;
    }
  }

  private checkWindowClose(): void {
    const now = this.deps.clock.nowMs();
    if (this.activeWindowStartMs !== undefined && now - this.activeWindowStartMs >= BucketDecimator.WINDOW_SIZE_MS) {
      this.closeCurrentWindow();
    }
  }

  private closeCurrentWindow(): void {
    if (this.activeWindowStartMs === undefined) return;

    const closed: DecimatedBucket[] = Array.from(this.activeBuckets.values());

    const samples = closed.map((b) => ({
      seriesId: `${b.node_id}:${b.gpu_index}`,
      values: [
        b.temperature_celsius.min,
        b.temperature_celsius.max,
        b.temperature_celsius.sum / b.temperature_celsius.count,
        b.vram_used_bytes.sum / b.vram_used_bytes.count,
        b.gpu_utilization_pct.sum / b.gpu_utilization_pct.count,
        b.temperature_celsius.count,
      ],
    }));

    if (samples.length > 0) {
      this.deps.ring.commitTick(samples);
    }

    this.deps.onDispatch(closed);

    this.activeBuckets.clear();
    this._occupancy = 0;
    this.activeWindowStartMs = undefined;
  }
}
