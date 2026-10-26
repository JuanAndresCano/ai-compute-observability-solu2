/** Randomness enters only here (ports-and-adapters.md rule 2). */
export interface IdGeneratorPort {
  /** UUIDv4 string. */
  uuid(): string;
  /** Matches ^ALT-[A-Z0-9]{8,16}$ */
  alertId(): string;
}
