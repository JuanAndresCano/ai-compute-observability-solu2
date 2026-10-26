import type { AlertRuleDTO, SlidingWindowDTO } from '../../dto';
import { NotImplementedError } from '../../shared/errors';

export interface AnomalyVerdict {
  suppressedColdStart: boolean;
  breach: boolean;
  observedSamples: number;
  baselineTps: number;
  currentTps: number;
  spikeRatio: number | null;
  p99Ms: number;
}

/** AD-03 / INV-03: pure function of (rule, window). */
export class AnomalyDetectionEngine {
  evaluate(_rule: AlertRuleDTO, _window: SlidingWindowDTO): AnomalyVerdict {
    throw new NotImplementedError('AnomalyDetectionEngine.evaluate');
  }
}
