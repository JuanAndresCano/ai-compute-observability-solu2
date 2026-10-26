import type { Database } from 'better-sqlite3';
import { SEED_FLEET } from './seed_fleet';

export const HOUR_S = 3600;

/** Subject of each GPU in the 7-day fixture: ws-gpu-01..10 CS-101, 11..20 CS-480, 21..31 CS-530, server-gpu-01 FAC-RES. */
export function subjectOf(nodeId: string): 'CS-101' | 'CS-480' | 'CS-530' | 'FAC-RES' {
  if (nodeId === 'server-gpu-01') return 'FAC-RES';
  const n = Number(nodeId.slice(-2));
  return n <= 10 ? 'CS-101' : n <= 20 ? 'CS-480' : 'CS-530';
}

/**
 * 7-day hourly rollup fixture: 168 hours x 33 GPUs = 5,544 rows ending at `endHourS` (exclusive, unix seconds).
 * Every healthy row: busy 0.5, idle 0.5, unavailable 0, 100 prompt + 50 completion tokens.
 * ws-gpu-22 is SILENT_TIMEOUT for the last `outageHours` hours: busy 0, idle 0, unavailable 1.0, 0 tokens.
 * `zeroBusy` makes every row idle (busy 0, idle 1, no tokens) for the "no workloads" case.
 */
export function seedRollups(db: Database, endHourS: number, opts: { outageHours?: number; zeroBusy?: boolean } = {}): void {
  const outage = opts.outageHours ?? 0;
  const insert = db.prepare(
    `INSERT INTO rollup_hourly_metrics
     (node_id, gpu_index, hour_epoch, gpu_hours_busy, gpu_hours_idle, gpu_hours_unavailable, prompt_tokens_total, completion_tokens_total, primary_subject, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const gpu of SEED_FLEET) {
      for (let h = 0; h < 168; h++) {
        const hourEpoch = endHourS - (168 - h) * HOUR_S;
        const down = gpu.node_id === 'ws-gpu-22' && h >= 168 - outage;
        const idleOnly = opts.zeroBusy === true;
        const busy = down || idleOnly ? 0 : 0.5;
        const idle = down ? 0 : idleOnly ? 1 : 0.5;
        const unavailable = down ? 1 : 0;
        const tokens = down || idleOnly ? [0, 0] : [100, 50];
        insert.run(gpu.node_id, gpu.gpu_index, hourEpoch, busy, idle, unavailable, tokens[0], tokens[1], subjectOf(gpu.node_id), endHourS * 1000);
      }
    }
  })();
}
