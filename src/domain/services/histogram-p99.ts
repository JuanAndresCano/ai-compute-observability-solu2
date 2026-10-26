import { NotImplementedError } from '../../shared/errors';

/** AD-03: 100 buckets of 200 ms; bucket 99 also holds latencies >= 20,000 ms. */
export class HistogramP99 {
  static bucketIndex(_latencyMs: number): number {
    throw new NotImplementedError('HistogramP99.bucketIndex');
  }
  static p99UpperEdgeMs(_counts: readonly number[]): number {
    throw new NotImplementedError('HistogramP99.p99UpperEdgeMs');
  }
}
