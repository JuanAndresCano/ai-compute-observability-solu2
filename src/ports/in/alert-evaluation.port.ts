import type { AlertRuleDTO, SlidingWindowDTO, AlertEvaluationDTO } from '../../dto';

/** contracts.md Operation 2. */
export interface AlertEvaluationPort {
  evaluateAlertRule(rule: AlertRuleDTO, window: SlidingWindowDTO): Promise<AlertEvaluationDTO>;
}
