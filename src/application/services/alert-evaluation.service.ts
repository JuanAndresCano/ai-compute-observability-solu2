import type { AlertRuleDTO, SlidingWindowDTO, AlertEvaluationDTO } from '../../dto';
import type { AlertEvaluationPort } from '../../ports/in/alert-evaluation.port';
import { NotImplementedError } from '../../shared/errors';
import type { Deps } from '../../composition';

export class AlertEvaluationService implements AlertEvaluationPort {
  constructor(_deps: Deps) {}
  async evaluateAlertRule(_rule: AlertRuleDTO, _window: SlidingWindowDTO): Promise<AlertEvaluationDTO> {
    throw new NotImplementedError('AlertEvaluationService.evaluateAlertRule');
  }
}
