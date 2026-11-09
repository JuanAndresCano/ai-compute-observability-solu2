/**
 * Inbound Telemetry Ingestion Application Service (Operation 1 / Story 11.1).
 * Enforces contract preconditions P1, P2, P3, decimation windowing,
 * idempotency, and audit logging.
 */
import type {
  MetricBatchDTO,
  IngestionResultDTO,
  FleetSnapshotDTO,
  FleetCellDTO,
  CellFreshnessType,
  AcademicSubjectType,
} from '../../dto';
import type { TelemetryIngestionPort } from '../../ports/in/telemetry-ingestion.port';
import type { Deps } from '../../composition';
import { BucketDecimator, type DecimatedBucket } from '../../domain/services/bucket-decimator';
import { TelemetryRingBuffer } from '../../domain/models/telemetry-ring-buffer';
import { NodeHeartbeatWatchdog } from '../../domain/services/heartbeat-watchdog';
import { SlidingWindowAssembler } from './sliding-window-assembler';
import { ContractError, StorageUnavailableError } from '../../shared/errors';
import { FLEET_NODE_IDS, FLEET_SERIES_INFO } from '../../domain/models/fleet';

const NODE_ID_REGEX = /^(ws-gpu-(0[1-9]|[12][0-9]|3[01])|server-gpu-01)$/;
/** Any UUID shape (36 chars, matching the ingested_batches CHECK); stricter v4-only checking is reserved for inference request_id. */
const BATCH_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_SUBJECTS = new Set<AcademicSubjectType>(['CS-101', 'CS-480', 'CS-530', 'FAC-RES', 'IDLE']);

export class TelemetryIngestionService implements TelemetryIngestionPort {
  private readonly decimator: BucketDecimator;
  private readonly watchdog: NodeHeartbeatWatchdog;
  private readonly windows: SlidingWindowAssembler;
  private readonly ring: TelemetryRingBuffer;

  private cumulativeDropped = 0;
  private arrivalHistory: { timeMs: number; count: number }[] = [];
  private latestCellDTOs = new Map<string, FleetCellDTO>();

  constructor(
    private readonly deps: Deps,
    options?: {
      watchdog?: NodeHeartbeatWatchdog;
      windows?: SlidingWindowAssembler;
      ring?: TelemetryRingBuffer;
    },
  ) {
    this.ring = options?.ring ?? new TelemetryRingBuffer(FLEET_SERIES_INFO.map((s) => `${s.nodeId}:${s.gpuIndex}`));
    this.watchdog = options?.watchdog ?? new NodeHeartbeatWatchdog(deps.clock, FLEET_NODE_IDS);
    this.windows = options?.windows ?? new SlidingWindowAssembler();

    this.decimator = new BucketDecimator({
      clock: deps.clock,
      ring: this.ring,
      onDispatch: (closed) => {
        this.handleWindowClosed(closed).catch(() => {});
      },
    });
  }

  getWatchdog(): NodeHeartbeatWatchdog {
    return this.watchdog;
  }

  nowMs(): number {
    return this.deps.clock.nowMs();
  }

  getWindows(): SlidingWindowAssembler {
    return this.windows;
  }

  async ingestMetricBatch(batch: MetricBatchDTO): Promise<IngestionResultDTO> {
    const nowMs = this.deps.clock.nowMs();

    // --------------------------------------------------------------------------
    // Precondition P1: Payload range and structural validation
    // --------------------------------------------------------------------------
    if (!batch || !Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > 5000) {
      throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, 'Invalid events array length (must be 1..5000)');
    }

    // The ingested_batches table enforces length(batch_id) = 36 and INSERT OR IGNORE would swallow a violation as a
    // "duplicate", silently discarding the events. Refuse a malformed id loudly instead.
    if (batch.batch_id !== undefined && (typeof batch.batch_id !== 'string' || !BATCH_ID_REGEX.test(batch.batch_id))) {
      throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, 'batch_id must be a UUID (8-4-4-4-12 hexadecimal, 36 characters)');
    }

    for (let i = 0; i < batch.events.length; i++) {
      const ev = batch.events[i]!;
      if (!ev || !NODE_ID_REGEX.test(ev.node_id)) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `Invalid node_id: "${ev?.node_id}"`);
      }

      if (ev.node_id === 'server-gpu-01') {
        if (ev.gpu_index !== 0 && ev.gpu_index !== 1) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `server-gpu-01 gpu_index must be 0 or 1, got ${ev.gpu_index}`);
        }
        if (ev.vram_total_bytes !== 51539607552) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `server-gpu-01 vram_total_bytes must be 51539607552, got ${ev.vram_total_bytes}`);
        }
      } else {
        if (ev.gpu_index !== 0) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `workstation ${ev.node_id} gpu_index must be 0, got ${ev.gpu_index}`);
        }
        if (ev.vram_total_bytes !== 25769803776) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `workstation ${ev.node_id} vram_total_bytes must be 25769803776, got ${ev.vram_total_bytes}`);
        }
      }

      if (ev.temperature_celsius < -20.0 || ev.temperature_celsius > 120.0) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `temperature_celsius out of bounds: ${ev.temperature_celsius}`);
      }

      if (ev.vram_used_bytes < 0 || ev.vram_used_bytes > ev.vram_total_bytes) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `vram_used_bytes ${ev.vram_used_bytes} exceeds total ${ev.vram_total_bytes}`);
      }

      if (ev.gpu_utilization_pct < 0.0 || ev.gpu_utilization_pct > 100.0) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `gpu_utilization_pct out of bounds: ${ev.gpu_utilization_pct}`);
      }

      if (ev.timestamp_ms <= 0) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `timestamp_ms must be positive: ${ev.timestamp_ms}`);
      }
    }

    if (batch.inference_metrics !== undefined) {
      if (!Array.isArray(batch.inference_metrics) || batch.inference_metrics.length > 5000) {
        throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, 'inference_metrics length must be <= 5000');
      }

      for (let i = 0; i < batch.inference_metrics.length; i++) {
        const inf = batch.inference_metrics[i]!;
        if (!inf || !UUID_V4_REGEX.test(inf.request_id)) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `request_id must be a UUIDv4: ${inf?.request_id}`);
        }
        if (!NODE_ID_REGEX.test(inf.node_id)) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `inference node_id invalid: ${inf.node_id}`);
        }
        if (!VALID_SUBJECTS.has(inf.academic_subject)) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `Invalid academic_subject: ${inf.academic_subject}`);
        }
        if (!Number.isInteger(inf.prompt_tokens) || inf.prompt_tokens < 0) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `prompt_tokens must be non-negative integer: ${inf.prompt_tokens}`);
        }
        if (!Number.isInteger(inf.completion_tokens) || inf.completion_tokens < 0) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `completion_tokens must be non-negative integer: ${inf.completion_tokens}`);
        }
        if (inf.queue_duration_ms < 0 || inf.inference_duration_ms < 0) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, 'Latencies must be >= 0');
        }
        const expectedTotal = inf.queue_duration_ms + inf.inference_duration_ms;
        if (Math.abs(inf.total_latency_ms - expectedTotal) > 0.001) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `total_latency_ms ${inf.total_latency_ms} != queue + inference (${expectedTotal})`);
        }
        if (inf.timestamp_ms <= 0) {
          throw this.contractError('ERR_INVALID_TELEMETRY_PAYLOAD', 422, false, `inference timestamp_ms must be > 0`);
        }
      }
    }

    // --------------------------------------------------------------------------
    // Precondition P2: Anti-clock-drift barrier (<= now + 5000 ms)
    // --------------------------------------------------------------------------
    if (batch.client_timestamp_ms > nowMs + 5000) {
      throw this.contractError(
        'ERR_FUTURE_TIMESTAMP_DRIFT',
        400,
        false,
        `Client timestamp ${batch.client_timestamp_ms} drifts ${batch.client_timestamp_ms - nowMs} ms into the future (limit: 5000 ms)`,
      );
    }

    // --------------------------------------------------------------------------
    // Precondition P3: Capacity rule (10,000 slots)
    // --------------------------------------------------------------------------
    const free = Math.max(0, 10000 - this.decimator.occupancy);
    if (free === 0) {
      throw this.contractError('ERR_BUFFER_OVERFLOW', 429, true, 'Buffer queue full (0 of 10000 slots free)');
    }

    // --------------------------------------------------------------------------
    // Concurrency / Idempotency: register batch_id (1-hour window)
    // --------------------------------------------------------------------------
    if (batch.batch_id) {
      try {
        const isNew = await this.deps.telemetry.registerBatch(batch.batch_id);
        if (!isNew) {
          const bucketStart = Math.floor(nowMs / 250) * 250;
          return {
            accepted_count: 0,
            dropped_count: 0,
            decimation_bucket_id: `BUCKET-${bucketStart}`,
            ingested_at_ms: nowMs,
            explanation: {
              rule_id: 'AD-01-DECIMATION-4HZ',
              observed_values: { observed_rate: batch.events.length, free_slots: free },
              thresholds: { buffer_capacity: 10000, decimation_window_ms: 250 },
              justification_text: `Duplicate batch ${batch.batch_id} ignored idempotently.`,
            },
          };
        }
      } catch (err) {
        throw this.contractError('ERR_DATABASE_UNAVAILABLE', 503, true, 'Storage engine unavailable');
      }
    }

    const acceptedCount = Math.min(batch.events.length, free);
    const droppedCount = batch.events.length - acceptedCount;

    const acceptedEvents = batch.events.slice(0, acceptedCount);
    const droppedEvents = batch.events.slice(acceptedCount);

    // Q2b: Accepted events and capacity-dropped events record heartbeats (AMD-17b)
    for (const ev of acceptedEvents) {
      this.watchdog.recordHeartbeat(ev.node_id, nowMs);
    }
    for (const ev of droppedEvents) {
      this.watchdog.recordHeartbeat(ev.node_id, nowMs);
    }

    // Accumulate in decimator
    try {
      for (const ev of acceptedEvents) {
        (this.deps.telemetry as any).setLastSnapshot?.(ev.node_id, JSON.stringify(ev));
        const key = `${ev.node_id}:${ev.gpu_index}`;
        this.latestCellDTOs.set(key, {
          node_id: ev.node_id,
          gpu_index: ev.gpu_index,
          state: this.watchdog.stateOf(ev.node_id),
          freshness: 'LIVE',
          temperature_celsius: ev.temperature_celsius,
          vram_used_bytes: ev.vram_used_bytes,
          gpu_utilization_pct: ev.gpu_utilization_pct,
          vram_total_bytes: ev.vram_total_bytes,
        });
      }
      this.decimator.accumulate(acceptedEvents);
    } catch (err: any) {
      if (err instanceof StorageUnavailableError || err?.code === 'ERR_DATABASE_UNAVAILABLE') {
        throw this.contractError('ERR_DATABASE_UNAVAILABLE', 503, true, err.message);
      }
      throw err;
    }

    if (droppedCount > 0) {
      this.deps.metrics.increment('telemetry_events_dropped_total', {}, droppedCount);
      this.cumulativeDropped += droppedCount;
    }

    // Track arrival for storm mode (AMD-18b)
    this.arrivalHistory.push({ timeMs: nowMs, count: batch.events.length });

    // Fold inference metrics if provided
    if (batch.inference_metrics && batch.inference_metrics.length > 0) {
      this.windows.foldInference(batch.inference_metrics);
    }

    const bucketStartMs = Math.floor(nowMs / 250) * 250;
    const bucketId = `BUCKET-${bucketStartMs}`;

    // Q3: Audit event
    this.deps.events.emit({
      eventType: 'telemetry.batch.ingested',
      occurredAtMs: nowMs,
      payload: {
        accepted_count: acceptedCount,
        dropped_count: droppedCount,
        decimation_bucket_id: bucketId,
      },
    });

    return {
      accepted_count: acceptedCount,
      dropped_count: droppedCount,
      decimation_bucket_id: bucketId,
      ingested_at_ms: nowMs,
      explanation: {
        rule_id: 'AD-01-DECIMATION-4HZ',
        observed_values: {
          observed_rate: batch.events.length,
          free_slots: free,
        },
        thresholds: {
          buffer_capacity: 10000,
          decimation_window_ms: 250,
        },
        justification_text: `Batch of ${batch.events.length} events processed at ${nowMs} ms: ${acceptedCount} accepted into ${bucketId}, ${droppedCount} dropped. Free slots: ${free}.`,
      },
    };
  }

  private async handleWindowClosed(closed: readonly DecimatedBucket[]): Promise<void> {
    if (closed.length === 0) return;

    const bucketStartMs = closed[0]!.bucket_start_ms;

    // Convert DecimatedBucket to TelemetryBucketRecord for persistence
    const records = closed.map((b) => ({
      node_id: b.node_id,
      gpu_index: b.gpu_index,
      bucket_start_ms: b.bucket_start_ms,
      temperature_min: b.temperature_celsius.min,
      temperature_max: b.temperature_celsius.max,
      temperature_avg: b.temperature_celsius.sum / b.temperature_celsius.count,
      vram_used_bytes: Math.round(b.vram_used_bytes.sum / b.vram_used_bytes.count),
      gpu_utilization_pct: b.gpu_utilization_pct.sum / b.gpu_utilization_pct.count,
      event_count: b.temperature_celsius.count,
    }));

    try {
      await this.deps.telemetry.commitBuckets(records);
    } catch (err: any) {
      throw new ContractError({
        error_code: 'ERR_DATABASE_UNAVAILABLE',
        http_status: 503,
        message: err?.message || 'Database unavailable during bucket commit',
        timestamp_ms: this.deps.clock.nowMs(),
        retryable: true,
        details: {},
      });
    }

    // Update latest cell cache
    for (const b of closed) {
      const key = `${b.node_id}:${b.gpu_index}`;
      const seriesInfo = FLEET_SERIES_INFO.find((s) => s.nodeId === b.node_id && s.gpuIndex === b.gpu_index);
      const vramTotal = seriesInfo?.vramTotalBytes ?? (b.node_id === 'server-gpu-01' ? 51539607552 : 25769803776);
      this.latestCellDTOs.set(key, {
        node_id: b.node_id,
        gpu_index: b.gpu_index,
        state: this.watchdog.stateOf(b.node_id),
        freshness: this.watchdog.stateOf(b.node_id) === 'HEALTHY' ? 'LIVE' : 'STALE_CACHED',
        temperature_celsius: b.temperature_celsius.max,
        vram_used_bytes: b.vram_used_bytes.max,
        gpu_utilization_pct: b.gpu_utilization_pct.sum / b.gpu_utilization_pct.count,
        vram_total_bytes: vramTotal,
      });
    }

    // Evaluate storm mode (> 1,000 events arrived in the 1,000 ms before window closed)
    const now = this.deps.clock.nowMs();
    this.arrivalHistory = this.arrivalHistory.filter((a) => a.timeMs >= now - 1000 && a.timeMs <= now);
    const totalArrivedLastSec = this.arrivalHistory.reduce((sum, a) => sum + a.count, 0);
    const stormMode = totalArrivedLastSec > 1000;

    // Build 33 cells in exact GPU_SERIES order
    const cells: FleetCellDTO[] = FLEET_SERIES_INFO.map((series) => {
      const key = `${series.nodeId}:${series.gpuIndex}`;
      const state = this.watchdog.stateOf(series.nodeId);
      const isHealthy = state === 'HEALTHY';
      const freshness: CellFreshnessType = isHealthy ? 'LIVE' : 'STALE_CACHED';

      const cached = this.latestCellDTOs.get(key);
      if (cached) {
        return {
          ...cached,
          state,
          freshness,
        };
      }

      return {
        node_id: series.nodeId,
        gpu_index: series.gpuIndex,
        state,
        freshness,
        temperature_celsius: 0,
        vram_used_bytes: 0,
        gpu_utilization_pct: 0,
        vram_total_bytes: series.vramTotalBytes,
      };
    });

    const snapshot: FleetSnapshotDTO = {
      bucket_start_ms: bucketStartMs,
      storm_mode: stormMode,
      dropped_total: this.cumulativeDropped,
      cells,
    };

    this.deps.ui.dispatch(snapshot);
  }

  private contractError(
    code: 'ERR_INVALID_TELEMETRY_PAYLOAD' | 'ERR_FUTURE_TIMESTAMP_DRIFT' | 'ERR_BUFFER_OVERFLOW' | 'ERR_DATABASE_UNAVAILABLE',
    http: number,
    retryable: boolean,
    message: string,
  ): ContractError {
    return new ContractError({
      error_code: code,
      http_status: http,
      message,
      timestamp_ms: this.deps.clock.nowMs(),
      retryable,
      details: {},
    });
  }

  getClusterSummary(): {
    average_gpu_utilization_pct: number;
    total_memory_consumed_bytes: number;
    total_memory_capacity_bytes: number;
    active_nodes_count: number;
    total_nodes_count: number;
    timestamp_ms: number;
  } {
    let totalUtil = 0;
    let totalMemory = 0;
    let totalCapacity = 0;
    let activeCount = 0;

    for (const node of FLEET_NODE_IDS) {
      const state = this.watchdog.stateOf(node);
      if (state === 'HEALTHY') activeCount++;
    }

    for (const series of FLEET_SERIES_INFO) {
      const key = `${series.nodeId}:${series.gpuIndex}`;
      const cell = this.latestCellDTOs.get(key);
      if (cell) {
        totalUtil += cell.gpu_utilization_pct;
        totalMemory += cell.vram_used_bytes;
      }
      totalCapacity += series.vramTotalBytes;
    }

    const count = FLEET_SERIES_INFO.length;
    const avgUtil = count === 0 ? 0 : totalUtil / count;

    return {
      average_gpu_utilization_pct: Math.round(avgUtil * 100) / 100,
      total_memory_consumed_bytes: totalMemory,
      total_memory_capacity_bytes: totalCapacity,
      active_nodes_count: activeCount,
      total_nodes_count: FLEET_NODE_IDS.length,
      timestamp_ms: this.deps.clock.nowMs(),
    };
  }

  getFleetHeatmap(): {
    node_id: string;
    hostname: string;
    temperature_celsius: number;
    temperature_band: 'NORMAL' | 'WARM' | 'CRITICAL';
    utilization_pct: number;
    vram_used_bytes: number;
    vram_total_bytes: number;
    status: string;
  }[] {
    return FLEET_NODE_IDS.map((nodeId) => {
      const seriesList = FLEET_SERIES_INFO.filter((s) => s.nodeId === nodeId);
      let maxTemp = 0;
      let totalUtil = 0;
      let totalVramUsed = 0;
      let totalVramCap = 0;

      for (const s of seriesList) {
        const key = `${s.nodeId}:${s.gpuIndex}`;
        const cell = this.latestCellDTOs.get(key);
        if (cell) {
          maxTemp = Math.max(maxTemp, cell.temperature_celsius);
          totalUtil += cell.gpu_utilization_pct;
          totalVramUsed += cell.vram_used_bytes;
        }
        totalVramCap += s.vramTotalBytes;
      }

      const avgUtil = seriesList.length === 0 ? 0 : totalUtil / seriesList.length;
      const state = this.watchdog.stateOf(nodeId);

      let tempBand: 'NORMAL' | 'WARM' | 'CRITICAL' = 'NORMAL';
      if (maxTemp >= 85) {
        tempBand = 'CRITICAL';
      } else if (maxTemp >= 75) {
        tempBand = 'WARM';
      }

      return {
        node_id: nodeId,
        hostname: `${nodeId}.cluster.local`,
        temperature_celsius: maxTemp,
        temperature_band: tempBand,
        utilization_pct: Math.round(avgUtil * 100) / 100,
        vram_used_bytes: totalVramUsed,
        vram_total_bytes: totalVramCap,
        status: state,
      };
    });
  }
}
