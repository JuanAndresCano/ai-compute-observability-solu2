/**
 * AD-02 / INV-02: Statically sized Float32Array storage for high-frequency telemetry.
 * Memory footprint: exactly 33 GPU series x 6 metrics x 7,200 slots x 4 bytes = 5,702,400 bytes (~5.70 MB).
 * Zero dynamic heap allocations during streaming.
 */

export class TelemetryRingBuffer {
  public static readonly SERIES_COUNT = 33;
  public static readonly METRICS_PER_SERIES = 6;
  public static readonly SLOTS = 7200;

  private readonly storage: Float32Array;
  private readonly seriesIndexMap: Map<string, number>;
  private _writePointer = 0;

  constructor(public readonly seriesIds: readonly string[]) {
    this.storage = new Float32Array(
      TelemetryRingBuffer.SERIES_COUNT * TelemetryRingBuffer.METRICS_PER_SERIES * TelemetryRingBuffer.SLOTS,
    );
    this.seriesIndexMap = new Map();
    for (let i = 0; i < seriesIds.length; i++) {
      const id = seriesIds[i];
      if (id !== undefined) {
        this.seriesIndexMap.set(id, i);
      }
    }
  }

  get byteLength(): number {
    return this.storage.byteLength;
  }

  get writePointer(): number {
    return this._writePointer;
  }

  /**
   * Writes one 6-metric sample per listed series at slot (writePointer + 1) % 7200,
   * then advances writePointer (modulo 7,200).
   */
  commitTick(samples: readonly { seriesId: string; values: readonly number[] }[]): void {
    const nextSlot = (this._writePointer + 1) % TelemetryRingBuffer.SLOTS;

    for (const sample of samples) {
      const seriesIdx = this.seriesIndexMap.get(sample.seriesId);
      if (seriesIdx === undefined) continue;

      const baseOffset = seriesIdx * TelemetryRingBuffer.METRICS_PER_SERIES * TelemetryRingBuffer.SLOTS;
      const count = Math.min(sample.values.length, TelemetryRingBuffer.METRICS_PER_SERIES);

      for (let m = 0; m < count; m++) {
        const val = sample.values[m];
        if (val !== undefined) {
          const slotOffset = baseOffset + m * TelemetryRingBuffer.SLOTS + nextSlot;
          this.storage[slotOffset] = val;
        }
      }
    }

    this._writePointer = nextSlot;
  }

  read(seriesId: string, metricIndex: number, slot: number): number {
    const seriesIdx = this.seriesIndexMap.get(seriesId);
    if (seriesIdx === undefined) return 0;
    if (metricIndex < 0 || metricIndex >= TelemetryRingBuffer.METRICS_PER_SERIES) return 0;
    if (slot < 0 || slot >= TelemetryRingBuffer.SLOTS) return 0;

    const offset = (seriesIdx * TelemetryRingBuffer.METRICS_PER_SERIES + metricIndex) * TelemetryRingBuffer.SLOTS + slot;
    return this.storage[offset] ?? 0;
  }
}
