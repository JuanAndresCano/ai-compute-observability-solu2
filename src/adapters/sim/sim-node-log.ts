import type { NodeLogPort } from '../../ports/out/node-log.port';

/** Test double: scripted stderr / syslog per node. Keeps every line ever emitted; tail() returns the newest n. */
export class SimNodeLog implements NodeLogPort {
  private readonly lines = new Map<string, string[]>();

  emit(nodeId: string, line: string): void {
    const list = this.lines.get(nodeId) ?? [];
    list.push(line);
    this.lines.set(nodeId, list);
  }

  async tail(nodeId: string, n: number): Promise<string[]> {
    return (this.lines.get(nodeId) ?? []).slice(-n);
  }
}
