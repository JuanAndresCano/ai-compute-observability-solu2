import type { Database } from 'better-sqlite3';
import { createSystem, type Deps, type System } from '../../src/composition';
import { SequentialIdGenerator } from '../../src/adapters/sim/sequential-id-generator';
import { SqliteTelemetryRepo } from '../../src/adapters/db/sqlite-telemetry-repo';
import { SqliteAlertRepo } from '../../src/adapters/db/sqlite-alert-repo';
import { SqliteRollupRepo } from '../../src/adapters/db/sqlite-rollup-repo';
import { newClock, FakeClock } from '../fixtures/fake_clock';
import { createTestDb } from '../fixtures/db';
import { SimulatedTelemetry } from '../fixtures/sim_telemetry';
import { EventSpy, MetricsSpy, UiSpy } from './spies';

export interface World {
  clock: FakeClock;
  db: Database;
  sim: SimulatedTelemetry;
  events: EventSpy;
  metrics: MetricsSpy;
  ui: UiSpy;
  deps: Deps;
  sut: System;
}

/** Everything a contract test needs: fake clock, migrated+seeded SQLite, scripted telemetry, spies, and the system under test. */
export function createWorld(over: Partial<Deps> = {}, shared?: { db: Database; clock: FakeClock }): World {
  const clock = shared?.clock ?? newClock();
  const db = shared?.db ?? createTestDb();
  const events = new EventSpy();
  const metrics = new MetricsSpy();
  const ui = new UiSpy();
  const deps: Deps = {
    clock,
    ids: new SequentialIdGenerator(),
    metrics,
    events,
    telemetry: new SqliteTelemetryRepo(db),
    alerts: new SqliteAlertRepo(db),
    rollups: new SqliteRollupRepo(db),
    ui,
    ...over,
  };
  return { clock, db, sim: new SimulatedTelemetry(), events, metrics, ui, deps, sut: createSystem(deps) };
}
