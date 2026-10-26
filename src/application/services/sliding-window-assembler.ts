/**
 * AMD-9: Folds inference metrics into fixed-size accumulators and builds the Op2 SlidingWindowDTO.
 * Windows are the half-open intervals [now-30000, now) and [now-300000, now).
 */
import type { InferenceMetricPacketDTO, SlidingWindowDTO } from '../../dto';
import { HistogramP99 } from '../../domain/services/histogram-p99';
import type { ClockPort } from '../../ports/out/clock.port';

interface InferenceSample {
  timestamp_ms: number;
  latency_ms: number;
  prompt_tokens: number;
}

export class SlidingWindowAssembler {
  private samples: InferenceSample[] = [];

  constructor(private readonly clock?: ClockPort) {}

  foldInference(packets: readonly InferenceMetricPacketDTO[]): void {
    for (const p of packets) {
      this.samples.push({
        timestamp_ms: p.timestamp_ms,
        latency_ms: p.total_latency_ms,
        prompt_tokens: p.prompt_tokens,
      });
    }
  }

  assemble(evaluationTimeMs?: number): SlidingWindowDTO {
    const nowMs = evaluationTimeMs ?? (this.clock ? this.clock.nowMs() : 0);

    const shortHistogram = new Array<number>(100).fill(0);
    const longHistogram = new Array<number>(100).fill(0);
    let shortPromptTokens = 0;
    let longPromptTokens = 0;

    const shortCutoff = nowMs - 30_000;
    const longCutoff = nowMs - 300_000;

    // Filter samples in long window and short window
    // Prune very old samples
    this.samples = this.samples.filter((s) => s.timestamp_ms >= longCutoff && s.timestamp_ms <= nowMs);

    for (const s of this.samples) {
      const idx = HistogramP99.bucketIndex(s.latency_ms);

      // Long window: [nowMs - 300_000, nowMs)
      if (s.timestamp_ms >= longCutoff && s.timestamp_ms < nowMs) {
        longHistogram[idx] = (longHistogram[idx] ?? 0) + 1;
        longPromptTokens += s.prompt_tokens;
      }

      // Short window: [nowMs - 30_000, nowMs)
      if (s.timestamp_ms >= shortCutoff && s.timestamp_ms < nowMs) {
        shortHistogram[idx] = (shortHistogram[idx] ?? 0) + 1;
        shortPromptTokens += s.prompt_tokens;
      }
    }

    return {
      short_window_seconds: 30,
      long_window_seconds: 300,
      histogram_bucket_count: 100,
      short_histogram: shortHistogram,
      long_histogram: longHistogram,
      short_window_prompt_tokens: shortPromptTokens,
      long_window_prompt_tokens: longPromptTokens,
    };
  }
}
