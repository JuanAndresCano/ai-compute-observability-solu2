import type { Database } from 'better-sqlite3';
import { GIB, GPU_SERIES } from '../../src/adapters/sim/simulated-telemetry-gen';

export interface FleetRow {
  readonly node_id: string;
  readonly gpu_index: number;
  readonly node_type: 'WORKSTATION' | 'CENTRAL_SERVER';
  readonly vram_total_bytes: number;
  readonly current_state: 'HEALTHY';
}

/** Plan-2 fleet: 31 x (1 x 24 GB) + 1 x (2 x 48 GB) = 32 nodes, 33 GPUs, all HEALTHY. Immutable. */
export const SEED_FLEET: readonly FleetRow[] = Object.freeze(
  GPU_SERIES.map((s) =>
    Object.freeze({
      node_id: s.node_id,
      gpu_index: s.gpu_index,
      node_type: s.node_id === 'server-gpu-01' ? ('CENTRAL_SERVER' as const) : ('WORKSTATION' as const),
      vram_total_bytes: s.node_id === 'server-gpu-01' ? 48 * GIB : 24 * GIB,
      current_state: 'HEALTHY' as const,
    }),
  ),
);

export const NODE_IDS: readonly string[] = Object.freeze([...new Set(SEED_FLEET.map((r) => r.node_id))]);
export const SILENT_NODE = 'ws-gpu-22'; // Scenario 3

export function seedFleet(db: Database, nowMs: number): void {
  const insert = db.prepare(
    `INSERT INTO cluster_nodes (node_id, gpu_index, node_type, vram_total_bytes, current_state, created_at_ms, updated_at_ms)
     VALUES (@node_id, @gpu_index, @node_type, @vram_total_bytes, @current_state, @now, @now)`,
  );
  db.transaction(() => {
    for (const row of SEED_FLEET) insert.run({ ...row, now: nowMs });
  })();
}
