/**
 * Pure Domain Service: Stream Downsampler & Peak-Preserving Token Bucket (Invariant AD-27).
 * Throttles high-frequency telemetry storm arrivals (up to 5,000 ev/s) into a stable <= 10 Hz
 * client-bound stream while strictly preserving true maximum temperature and VRAM peaks.
 */

export interface DownsampledNodeMetrics {
  node_id: string;
  gpu_index: number;
  peak_temperature_celsius: number;
  peak_vram_used_bytes: number;
  avg_gpu_utilization_pct: number;
  event_count: number;
}

export interface DownsampledFrame {
  timestamp_ms: number;
  frame_index: number;
  nodes: DownsampledNodeMetrics[];
}

export interface StreamDownsamplerOptions {
  maxOutputHz?: number; // default: 10 Hz (100 ms per frame)
}

export class StreamDownsampler {
  private readonly intervalMs: number;
  private readonly maxFramesPerSec: number;
  private activeWindow: Map<string, {
    node_id: string;
    gpu_index: number;
    maxTemp: number;
    maxVram: number;
    sumUtil: number;
    count: number;
  }> = new Map();

  private frameCounter = 0;
  private lastEmitTimeMs = 0;
  private tokens: number;
  private lastTokenRefillMs = 0;

  constructor(options: StreamDownsamplerOptions = {}) {
    this.maxFramesPerSec = options.maxOutputHz ?? 10;
    this.intervalMs = Math.floor(1000 / this.maxFramesPerSec); // 100 ms for 10 Hz
    this.tokens = this.maxFramesPerSec;
  }

  /**
   * Ingest a single raw telemetry event into the current downsampling window.
   */
  public ingest(event: {
    node_id: string;
    gpu_index: number;
    timestamp_ms: number;
    temperature_celsius: number;
    vram_used_bytes: number;
    gpu_utilization_pct: number;
  }): void {
    const key = `${event.node_id}:${event.gpu_index}`;
    const existing = this.activeWindow.get(key);

    if (!existing) {
      this.activeWindow.set(key, {
        node_id: event.node_id,
        gpu_index: event.gpu_index,
        maxTemp: event.temperature_celsius,
        maxVram: event.vram_used_bytes,
        sumUtil: event.gpu_utilization_pct,
        count: 1,
      });
    } else {
      existing.maxTemp = Math.max(existing.maxTemp, event.temperature_celsius);
      existing.maxVram = Math.max(existing.maxVram, event.vram_used_bytes);
      existing.sumUtil += event.gpu_utilization_pct;
      existing.count += 1;
    }
  }

  /**
   * Refill token bucket for rate-limiting.
   */
  private refillTokens(nowMs: number): void {
    if (this.lastTokenRefillMs === 0) {
      this.lastTokenRefillMs = nowMs;
      return;
    }
    const elapsed = nowMs - this.lastTokenRefillMs;
    if (elapsed >= 1000) {
      this.tokens = this.maxFramesPerSec;
      this.lastTokenRefillMs = nowMs;
    }
  }

  /**
   * Harvest the downsampled frame if interval has passed and token is available.
   * Returns DownsampledFrame or null if throttled/not ready.
   */
  public harvest(nowMs: number): DownsampledFrame | null {
    this.refillTokens(nowMs);

    if (nowMs - this.lastEmitTimeMs < this.intervalMs) {
      return null;
    }

    if (this.tokens <= 0) {
      return null; // Rate limit capacity reached
    }

    if (this.activeWindow.size === 0) {
      return null; // Nothing to emit
    }

    const nodes: DownsampledNodeMetrics[] = [];
    for (const entry of this.activeWindow.values()) {
      nodes.push({
        node_id: entry.node_id,
        gpu_index: entry.gpu_index,
        peak_temperature_celsius: Number(entry.maxTemp.toFixed(2)),
        peak_vram_used_bytes: entry.maxVram,
        avg_gpu_utilization_pct: Number((entry.sumUtil / entry.count).toFixed(2)),
        event_count: entry.count,
      });
    }

    // Reset window
    this.activeWindow.clear();
    this.lastEmitTimeMs = nowMs;
    this.tokens -= 1;
    this.frameCounter += 1;

    return {
      timestamp_ms: nowMs,
      frame_index: this.frameCounter,
      nodes,
    };
  }

  public getPendingNodeCount(): number {
    return this.activeWindow.size;
  }
}
