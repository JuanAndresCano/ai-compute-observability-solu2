/** Simulated stderr / syslog source of a node (hardware agnostic, AD-07). */
export interface NodeLogPort {
  /** Up to `n` most recent lines, oldest first. */
  tail(nodeId: string, n: number): Promise<string[]>;
}
