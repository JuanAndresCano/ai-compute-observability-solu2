import { FakeClock } from '../../src/adapters/sim/fake-clock';

export { FakeClock };

/** 2026-10-19T17:00:00Z: divisible by 250 ms, 5,000 ms and 3,600,000 ms (top of an hour, start of a decimation window). */
export const T0 = 1_792_429_200_000;

export function newClock(startMs: number = T0): FakeClock {
  return new FakeClock(startMs);
}
