import type { ClockPort } from './ports/out/clock.port';
import type { IdGeneratorPort } from './ports/out/id-generator.port';
import type { MetricsPort } from './ports/out/metrics.port';
import type { EventDispatcherPort } from './ports/out/event-dispatcher.port';
import type { TelemetryRepositoryPort } from './ports/out/telemetry-repository.port';
import type { AlertRepositoryPort } from './ports/out/alert-repository.port';
import type { RollupRepositoryPort } from './ports/out/rollup-repository.port';
import type { UiDispatchPort } from './ports/out/ui-dispatch.port';
import { TelemetryRingBuffer } from './domain/models/telemetry-ring-buffer';
import { FLEET_SERIES_IDS } from './domain/models/fleet';
import type { TelemetryIngestionPort } from './ports/in/telemetry-ingestion.port';
import type { AlertEvaluationPort } from './ports/in/alert-evaluation.port';
import type { ReportingPort } from './ports/in/reporting.port';
import { TelemetryIngestionService } from './application/services/telemetry-ingestion.service';
import { AlertEvaluationService } from './application/services/alert-evaluation.service';
import { ReportingService } from './application/services/reporting.service';
import { SlidingWindowAssembler } from './application/services/sliding-window-assembler';

export interface Deps {
  clock: ClockPort;
  ids: IdGeneratorPort;
  metrics: MetricsPort;
  events: EventDispatcherPort;
  telemetry: TelemetryRepositoryPort;
  alerts: AlertRepositoryPort;
  rollups: RollupRepositoryPort;
  ui: UiDispatchPort;
}

export interface System {
  ingest: TelemetryIngestionPort;
  alertEvaluation: AlertEvaluationPort;
  reports: ReportingPort;
  windows: SlidingWindowAssembler;
  /** The process-wide ring buffer (AD-02); built on first access. */
  readonly ring: TelemetryRingBuffer;
}

/** Composition root: the only place that wires application services to ports. */
export function createSystem(deps: Deps): System {
  return {
    ingest: new TelemetryIngestionService(deps),
    alertEvaluation: new AlertEvaluationService(deps),
    reports: new ReportingService(deps),
    windows: new SlidingWindowAssembler(),
    get ring(): TelemetryRingBuffer {
      return new TelemetryRingBuffer(FLEET_SERIES_IDS);
    },
  };
}
