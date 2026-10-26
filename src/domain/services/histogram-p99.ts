/**
 * AD-03 / INV-03: P99 latency calculation over fixed-size 100-bucket histogram.
 * 100 buckets of 200 ms width: bucket 0 covers [0, 200), bucket 99 covers [19,800, 20,000) and any latency >= 20,000 ms.
 * Enforces deterministic O(1) memory and calculation.
 */

export class HistogramP99 {
  public static readonly BUCKET_COUNT = 100;
  public static readonly BUCKET_WIDTH_MS = 200;

  static bucketIndex(latencyMs: number): number {
    if (latencyMs <= 0 || Number.isNaN(latencyMs)) return 0;
    const idx = Math.floor(latencyMs / HistogramP99.BUCKET_WIDTH_MS);
    return Math.min(HistogramP99.BUCKET_COUNT - 1, Math.max(0, idx));
  }

  static p99UpperEdgeMs(counts: readonly number[]): number {
    let totalSamples = 0;
    for (let i = 0; i < counts.length; i++) {
      totalSamples += counts[i] ?? 0;
    }
    if (totalSamples === 0) return 0;

    const rank = Math.ceil(0.99 * totalSamples);
    let cumulative = 0;

    for (let i = 0; i < counts.length; i++) {
      cumulative += counts[i] ?? 0;
      if (cumulative >= rank) {
        return (i + 1) * HistogramP99.BUCKET_WIDTH_MS;
      }
    }

    return HistogramP99.BUCKET_COUNT * HistogramP99.BUCKET_WIDTH_MS;
  }
}
