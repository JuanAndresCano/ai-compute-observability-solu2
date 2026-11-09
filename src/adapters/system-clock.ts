import type { ClockPort } from '../ports/out/clock.port';

/**
 * Production Wall-Clock Adapter (ClockPort).
 * Provides the real system time in milliseconds for production and Docker runtimes.
 */
export class SystemClock implements ClockPort {
  nowMs(): number {
    return Date.now();
  }
}
