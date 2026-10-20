/** AD-07: the only source of time for domain and application code. */
export interface ClockPort {
  nowMs(): number;
}
