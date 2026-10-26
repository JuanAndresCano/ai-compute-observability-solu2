import type { InferenceMetricPacketDTO, SlidingWindowDTO } from '../../dto';
import { NotImplementedError } from '../../shared/errors';

/** AMD-9: folds inference metrics into fixed-size accumulators and builds the Op2 SlidingWindowDTO. */
export class SlidingWindowAssembler {
  foldInference(_packets: readonly InferenceMetricPacketDTO[]): void {
    throw new NotImplementedError('SlidingWindowAssembler.foldInference');
  }
  /** Windows are the half-open intervals [now-30000, now) and [now-300000, now). */
  assemble(): SlidingWindowDTO {
    throw new NotImplementedError('SlidingWindowAssembler.assemble');
  }
}
