import type { AlertRuleDTO, SlidingWindowDTO } from '../../dto';
import { HistogramP99 } from './histogram-p99';

export interface AnomalyVerdict {
  suppressedColdStart: boolean;
  breach: boolean;
  observedSamples: number;
  baselineTps: number;
  currentTps: number;
  spikeRatio: number | null;
  p99Ms: number;
  /** P99 > 8,000 ms: the incident is still degrading latency, whatever the spike ratio (AMD-14b clearing rule). */
  p99Exceeded: boolean;
}

/** AD-03 / INV-03: pure function of (rule, window). */
export class AnomalyDetectionEngine {
  evaluate(_rule: AlertRuleDTO, window: SlidingWindowDTO): AnomalyVerdict {
    let longSamples = 0;
    for (let i = 0; i < window.long_histogram.length; i++) {
      longSamples += window.long_histogram[i]!;
    }

    const shortTokens = window.short_window_prompt_tokens;
    const longTokens = window.long_window_prompt_tokens;
    const baselineTokens = longTokens - shortTokens;
    const baselineTps = baselineTokens / 270;
    const currentTps = shortTokens / 30;

    let spikeRatio: number | null = null;
    if (baselineTps > 0) {
      spikeRatio = currentTps / baselineTps;
    }

    const p99Ms = HistogramP99.p99UpperEdgeMs(window.short_histogram);
    const p99Exceeded = p99Ms > 8000.0;

    if (longSamples < 50) {
      return {
        suppressedColdStart: true,
        breach: false,
        observedSamples: longSamples,
        baselineTps,
        currentTps,
        spikeRatio,
        p99Ms,
        p99Exceeded,
      };
    }

    const breach = spikeRatio !== null && spikeRatio >= 10.0 && p99Exceeded;

    return {
      suppressedColdStart: false,
      breach,
      observedSamples: longSamples,
      baselineTps,
      currentTps,
      spikeRatio,
      p99Ms,
      p99Exceeded,
    };
  }
}
