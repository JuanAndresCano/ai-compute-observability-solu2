/**
 * Server Entrypoint for AI Infrastructure Observability Console (Module 11).
 * Wires configuration, composition root, database, and inbound HTTP adapter.
 */
import { loadConfig } from './config';
import { initDatabase } from './adapters/db/database';
import { createSystem, type Deps } from './composition';
import { SystemClock } from './adapters/system-clock';
import { SequentialIdGenerator } from './adapters/sim/sequential-id-generator';
import { SqliteTelemetryRepo } from './adapters/db/sqlite-telemetry-repo';
import { SqliteAlertRepo } from './adapters/db/sqlite-alert-repo';
import { SqliteRollupRepo } from './adapters/db/sqlite-rollup-repo';
import { SqliteForensicsRepo } from './adapters/db/sqlite-forensics-repo';
import { SimNodeLog } from './adapters/sim/sim-node-log';
import { SimJobRegistry } from './adapters/sim/sim-job-registry';
import { createHttpServer } from './adapters/inbound/http-server';
import { StreamDownsampler } from './domain/services/stream-downsampler';
import { WebSocketStreamHandler } from './adapters/inbound/websocket-server';
import type { EventDispatcherPort, AuditEvent } from './ports/out/event-dispatcher.port';
import type { MetricsPort } from './ports/out/metrics.port';
import type { UiDispatchPort } from './ports/out/ui-dispatch.port';
import type { FleetSnapshotDTO } from './dto';

class ConsoleEventDispatcher implements EventDispatcherPort {
  emit(_event: AuditEvent): void {
    // Audit event logging
  }
}

class ConsoleMetrics implements MetricsPort {
  increment(_name: string, _labels: Readonly<Record<string, string>>, _by: number): void {
    // Metrics accumulator
  }
}

class ConsoleUiDispatch implements UiDispatchPort {
  private wsHandler?: WebSocketStreamHandler;

  setWsHandler(ws: WebSocketStreamHandler): void {
    this.wsHandler = ws;
  }

  dispatch(snapshot: FleetSnapshotDTO): void {
    if (!this.wsHandler) return;
    for (const cell of snapshot.cells) {
      this.wsHandler.broadcastTelemetryEvent({
        node_id: cell.node_id,
        gpu_index: cell.gpu_index,
        timestamp_ms: snapshot.bucket_start_ms,
        temperature_celsius: cell.temperature_celsius,
        vram_used_bytes: cell.vram_used_bytes,
        vram_total_bytes: cell.vram_total_bytes,
        gpu_utilization_pct: cell.gpu_utilization_pct,
      });
    }
  }
}

export async function bootstrap(): Promise<{ stop: () => Promise<void> }> {
  const config = loadConfig();
  const db = initDatabase({ dbPath: config.dbPath });

  const clock = new SystemClock();
  const ids = new SequentialIdGenerator();
  const events = new ConsoleEventDispatcher();
  const metrics = new ConsoleMetrics();
  const ui = new ConsoleUiDispatch();
  const logs = new SimNodeLog();
  const jobs = new SimJobRegistry();

  const deps: Deps = {
    clock,
    ids,
    metrics,
    events,
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

  const downsampler = new StreamDownsampler({ maxOutputHz: 10 });
  const wsHandler = new WebSocketStreamHandler(httpServer.server, downsampler);
  ui.setWsHandler(wsHandler);
  wsHandler.start();

  await httpServer.start();
  // eslint-disable-next-line no-console
  console.log(`AI Infrastructure Observability Console listening on http://${config.host}:${config.port} (WebSocket on /ws/telemetry)`);

  return {
    async stop(): Promise<void> {
      await wsHandler.stop();
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
