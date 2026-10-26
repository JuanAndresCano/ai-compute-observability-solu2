import type { ClockPort } from './ports/out/clock.port';
import type { IdGeneratorPort } from './ports/out/id-generator.port';
import type { MetricsPort } from './ports/out/metrics.port';
import type { EventDispatcherPort } from './ports/out/event-dispatcher.port';
import type { TelemetryRepositoryPort } from './ports/out/telemetry-repository.port';
import type { AlertRepositoryPort } from './ports/out/alert-repository.port';
import type { RollupRepositoryPort } from './ports/out/rollup-repository.port';
import type { UiDispatchPort } from './ports/out/ui-dispatch.port';
import type { NodeLogPort } from './ports/out/node-log.port';
import type { JobRegistryPort } from './ports/out/job-registry.port';
import type { ForensicsRepositoryPort } from './ports/out/forensics-repository.port';
import type { ForensicsPort } from './ports/in/forensics.port';
import type { MonitoringPort } from './ports/in/monitoring.port';
import { TelemetryRingBuffer } from './domain/models/telemetry-ring-buffer';
import { FLEET_SERIES_IDS } from './domain/models/fleet';
import type { TelemetryIngestionPort } from './ports/in/telemetry-ingestion.port';
import type { AlertEvaluationPort } from './ports/in/alert-evaluation.port';
import type { ReportingPort } from './ports/in/reporting.port';
import { TelemetryIngestionService } from './application/services/telemetry-ingestion.service';
import { AlertEvaluationService } from './application/services/alert-evaluation.service';
import { ReportingService } from './application/services/reporting.service';
import { ForensicsService } from './application/services/forensics.service';
import { NodeMonitorService } from './application/services/node-monitor.service';
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
  logs: NodeLogPort;
  jobs: JobRegistryPort;
  forensics: ForensicsRepositoryPort;
}

export interface System {
  ingest: TelemetryIngestionPort;
  alertEvaluation: AlertEvaluationPort;
  reports: ReportingPort;
  windows: SlidingWindowAssembler;
  forensics: ForensicsPort;
  monitor: MonitoringPort;
  /** The process-wide ring buffer (AD-02); built on first access. */
  readonly ring: TelemetryRingBuffer;
  getActiveAlerts?(): Promise<any[]>;
}

/** Composition root: the only place that wires application services to ports. */
export function createSystem(deps: Deps): System {
  const ring = new TelemetryRingBuffer(FLEET_SERIES_IDS);
  const windows = new SlidingWindowAssembler(deps.clock);
  const ingest = new TelemetryIngestionService(deps, { ring, windows });
  const watchdog = ingest.getWatchdog();
  const monitor = new NodeMonitorService(watchdog, deps);

  return {
    ingest,
    alertEvaluation: new AlertEvaluationService(deps),
    reports: new ReportingService(deps),
    windows,
    forensics: new ForensicsService(deps, watchdog),
    monitor,
    ring,
    getActiveAlerts: () => (deps.alerts.getActiveAlerts ? deps.alerts.getActiveAlerts() : Promise.resolve([])),
  };
}
