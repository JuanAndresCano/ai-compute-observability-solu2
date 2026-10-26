import type { AlertRuleDTO, InferenceMetricPacketDTO, MetricBatchDTO, NodeTelemetryPacketDTO, SlidingWindowDTO } from '../../dto';

export const GIB = 1024 ** 3;
export const WS_VRAM_BYTES = 24 * GIB; // 25,769,803,776
export const SERVER_VRAM_BYTES = 48 * GIB; // 51,539,607,552

/** mulberry32: small deterministic PRNG so every run of the simulator is identical. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GpuSeries {
  node_id: string;
  gpu_index: number;
}

/** 31 workstation GPUs + 2 GPUs of server-gpu-01 = 33 series. */
export const GPU_SERIES: readonly GpuSeries[] = Object.freeze([
  ...Array.from({ length: 31 }, (_, i) => ({ node_id: `ws-gpu-${String(i + 1).padStart(2, '0')}`, gpu_index: 0 })),
  { node_id: 'server-gpu-01', gpu_index: 0 },
  { node_id: 'server-gpu-01', gpu_index: 1 },
]);

export function vramTotalFor(nodeId: string): number {
  return nodeId === 'server-gpu-01' ? SERVER_VRAM_BYTES : WS_VRAM_BYTES;
}

/** Scripted telemetry source: a valid-by-default generator that tests bend with overrides (fault generator). */
export class SimulatedTelemetry {
  private readonly rand: () => number;
  private batchSeq = 0;
  private requestSeq = 0;

  constructor(seed = 42) {
    this.rand = mulberry32(seed);
  }

  packet(over: Partial<NodeTelemetryPacketDTO> & { timestamp_ms: number }): NodeTelemetryPacketDTO {
    const node_id = over.node_id ?? 'ws-gpu-05';
    const total = vramTotalFor(node_id);
    return {
      node_id,
      gpu_index: 0,
      temperature_celsius: Math.round((50 + this.rand() * 20) * 10) / 10,
      vram_used_bytes: Math.floor(this.rand() * 0.8 * total),
      vram_total_bytes: total,
      gpu_utilization_pct: Math.round(this.rand() * 1000) / 10,
      active_jobs_count: 1,
      current_subject: 'CS-480',
      ...over,
    };
  }

  /** n valid events rotating across the 33 series, all stamped at `timestampMs`. */
  events(n: number, timestampMs: number): NodeTelemetryPacketDTO[] {
    return Array.from({ length: n }, (_, i) => {
      const s = GPU_SERIES[i % GPU_SERIES.length]!;
      return this.packet({ node_id: s.node_id, gpu_index: s.gpu_index, timestamp_ms: timestampMs });
    });
  }

  batch(n: number, nowMs: number, over: Partial<MetricBatchDTO> = {}): MetricBatchDTO {
    this.batchSeq += 1;
    return {
      batch_id: `00000000-0000-4000-9000-${this.batchSeq.toString(16).padStart(12, '0')}`,
      client_timestamp_ms: nowMs,
      events: this.events(n, nowMs),
      ...over,
    };
  }

  /** One 250 ms slice of a 5,000 ev/s storm: exactly 1,250 events. */
  stormSlice(nowMs: number): MetricBatchDTO {
    return this.batch(1250, nowMs);
  }

  inference(over: Partial<InferenceMetricPacketDTO> & { timestamp_ms: number }): InferenceMetricPacketDTO {
    this.requestSeq += 1;
    const queue = over.queue_duration_ms ?? 100;
    const run = over.inference_duration_ms ?? 400;
    return {
      request_id: `00000000-0000-4000-a000-${this.requestSeq.toString(16).padStart(12, '0')}`,
      node_id: 'ws-gpu-10',
      gpu_index: 0,
      model_id: 'Llama-3-8B-Instruct',
      academic_subject: 'CS-480',
      prompt_tokens: 100,
      completion_tokens: 50,
      queue_duration_ms: queue,
      inference_duration_ms: run,
      total_latency_ms: queue + run,
      ...over,
    };
  }
}

export const TOKEN_RULE: AlertRuleDTO = Object.freeze({
  rule_id: 'TOKEN_SPIKE_AND_LATENCY_BREACH',
  throughput_spike_multiplier: 10.0,
  p99_latency_threshold_ms: 8000.0,
  hysteresis_cycles_required: 3,
});

/** Builds a SlidingWindowDTO from explicit counts: `shortBuckets` and `longBuckets` map bucket index -> sample count. */
export function windowOf(spec: {
  shortBuckets: Record<number, number>;
  longBuckets: Record<number, number>;
  shortTokens: number;
  longTokens: number;
}): SlidingWindowDTO {
  const hist = (m: Record<number, number>) => Array.from({ length: 100 }, (_, i) => m[i] ?? 0);
  return {
    short_window_seconds: 30,
    long_window_seconds: 300,
    histogram_bucket_count: 100,
    short_histogram: hist(spec.shortBuckets),
    long_histogram: hist(spec.longBuckets),
    short_window_prompt_tokens: spec.shortTokens,
    long_window_prompt_tokens: spec.longTokens,
  };
}
