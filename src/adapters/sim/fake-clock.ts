import type { ClockPort } from '../../ports/out/clock.port';

/** Test double: deterministic, advanceable time. Never sleeps (AD-07). */
export class FakeClock implements ClockPort {
  private current: number;

  constructor(startMs: number) {
    if (!Number.isInteger(startMs) || startMs <= 0) throw new RangeError('startMs must be a positive integer');
    this.current = startMs;
  }

  nowMs(): number {
    return this.current;
  }

  advanceBy(ms: number): number {
    if (!Number.isInteger(ms) || ms < 0) throw new RangeError('advanceBy requires an integer ms >= 0');
    this.current += ms;
    return this.current;
  }

  setTo(ms: number): void {
    if (!Number.isInteger(ms) || ms < this.current) throw new RangeError('time cannot move backwards');
    this.current = ms;
  }
}
