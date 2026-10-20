export {
  SimulatedTelemetry,
  GPU_SERIES,
  TOKEN_RULE,
  windowOf,
  vramTotalFor,
  GIB,
  WS_VRAM_BYTES,
  SERVER_VRAM_BYTES,
} from '../../src/adapters/sim/simulated-telemetry-gen';

import { SimulatedTelemetry } from '../../src/adapters/sim/simulated-telemetry-gen';
import type { MetricBatchDTO } from '../../src/dto';

/** Fault generator: telemetry storm. `seconds` of virtual time at 5,000 ev/s = 4 slices of 1,250 events per second. */
export function* stormSlices(sim: SimulatedTelemetry, startMs: number, seconds: number): Generator<{ atMs: number; batch: MetricBatchDTO }> {
  for (let i = 0; i < seconds * 4; i++) {
    const atMs = startMs + i * 250;
    yield { atMs, batch: sim.stormSlice(atMs) };
  }
}
