import { NotImplementedError } from '../../shared/errors';

/** AD-02 / INV-02: statically sized Float32Array storage, 33 GPU series x 6 metrics x 7,200 slots. */
export class TelemetryRingBuffer {
  constructor(public readonly seriesIds: readonly string[]) {
    throw new NotImplementedError('TelemetryRingBuffer constructor');
  }
  get byteLength(): number {
    throw new NotImplementedError('TelemetryRingBuffer.byteLength');
  }
  get writePointer(): number {
    throw new NotImplementedError('TelemetryRingBuffer.writePointer');
  }
  /** Writes one 6-metric sample per listed series at slot (writePointer + 1) % 7200, then advances writePointer (modulo 7,200). */
  commitTick(_samples: readonly { seriesId: string; values: readonly number[] }[]): void {
    throw new NotImplementedError('TelemetryRingBuffer.commitTick');
  }
  read(_seriesId: string, _metricIndex: number, _slot: number): number {
    throw new NotImplementedError('TelemetryRingBuffer.read');
  }
}
