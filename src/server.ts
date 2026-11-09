/**
 * Server Entrypoint for AI Infrastructure Observability Console (Module 11).
 * Wires configuration, composition root, database, and inbound HTTP adapter.
 */
import { loadConfig } from './config';
import { initDatabase } from './adapters/db/database';
import { createSystem, type Deps } from './composition';
import { FakeClock } from './adapters/sim/fake-clock';
import { SequentialIdGenerator } from './adapters/sim/sequential-id-generator';
import { SqliteTelemetryRepo } from './adapters/db/sqlite-telemetry-repo';
import { SqliteAlertRepo } from './adapters/db/sqlite-alert-repo';
import { SqliteRollupRepo } from './adapters/db/sqlite-rollup-repo';
import { SqliteForensicsRepo } from './adapters/db/sqlite-forensics-repo';
import { SimNodeLog } from './adapters/sim/sim-node-log';
import { SimJobRegistry } from './adapters/sim/sim-job-registry';
import { InMemoryAuditTrail } from './adapters/memory/in-memory-audit-trail';
import { createHttpServer } from './adapters/inbound/http-server';
import type { MetricsPort } from './ports/out/metrics.port';
import type { UiDispatchPort } from './ports/out/ui-dispatch.port';
import type { FleetSnapshotDTO } from './dto';

class ConsoleMetrics implements MetricsPort {
  increment(_name: string, _labels: Readonly<Record<string, string>>, _by: number): void {
    // Metrics accumulator
  }
}

class ConsoleUiDispatch implements UiDispatchPort {
  dispatch(_snapshot: FleetSnapshotDTO): void {
    // UI dispatch pipeline
  }
}

export async function bootstrap(): Promise<{ stop: () => Promise<void> }> {
  const config = loadConfig();
  const db = initDatabase({ dbPath: config.dbPath });

  const clock = new FakeClock(Date.now());
  const ids = new SequentialIdGenerator();
  const auditTrail = new InMemoryAuditTrail();
  const metrics = new ConsoleMetrics();
  const ui = new ConsoleUiDispatch();
  const logs = new SimNodeLog();
  const jobs = new SimJobRegistry();
  if (config.seedDemoLogs) {
    for (const line of [
      '[19:13:52.401] kernel: nvidia: GPU 0000:01:00.0 temperature 91C exceeds threshold (88C)',
      '[19:13:58.120] kernel: NVRM: GPU at PCI:0000:01:00.0 thermal throttling engaged',
      '[19:14:01.890] vllm-worker: CUDA warning: clocks reduced due to thermal slowdown',
    ]) {
      logs.emit('ws-gpu-22', line);
    }
  }

  const deps: Deps = {
    clock,
    ids,
    metrics,
    events: auditTrail,
    auditTrail,
    telemetry: new SqliteTelemetryRepo(db),
    alerts: new SqliteAlertRepo(db),
    rollups: new SqliteRollupRepo(db),
    ui,
    logs,
    jobs,
    forensics: new SqliteForensicsRepo(db),
  };

  const system = createSystem(deps);
  const httpServer = createHttpServer(system, config);

  await httpServer.start();
  // eslint-disable-next-line no-console
  console.log(`AI Infrastructure Observability Console listening on http://${config.host}:${config.port}`);

  return {
    async stop(): Promise<void> {
      await httpServer.stop();
      db.close();
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
