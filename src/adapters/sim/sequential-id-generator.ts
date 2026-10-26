import type { IdGeneratorPort } from '../../ports/out/id-generator.port';

/** Test double: deterministic ids so assertions can name them. */
export class SequentialIdGenerator implements IdGeneratorPort {
  private n = 0;

  uuid(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${this.n.toString(16).padStart(12, '0')}`;
  }

  alertId(): string {
    this.n += 1;
    return `ALT-${this.n.toString(36).toUpperCase().padStart(8, '0')}`;
  }
}
