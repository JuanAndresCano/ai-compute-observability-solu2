/** The 33 GPU series of the Plan-2 fleet: 31 workstation GPUs + 2 GPUs of server-gpu-01 (AD-08). Static data, no behaviour. */
export const FLEET_SERIES_IDS: readonly string[] = Object.freeze([
  ...Array.from({ length: 31 }, (_, i) => `ws-gpu-${String(i + 1).padStart(2, '0')}:0`),
  'server-gpu-01:0',
  'server-gpu-01:1',
]);

export const FLEET_NODE_IDS: readonly string[] = Object.freeze([
  ...Array.from({ length: 31 }, (_, i) => `ws-gpu-${String(i + 1).padStart(2, '0')}`),
  'server-gpu-01',
]);

export interface FleetSeriesInfo {
  readonly nodeId: string;
  readonly gpuIndex: number;
  readonly vramTotalBytes: number;
}

export const FLEET_SERIES_INFO: readonly FleetSeriesInfo[] = Object.freeze(
  FLEET_SERIES_IDS.map((s) => {
    const parts = s.split(':');
    const nodeId = parts[0]!;
    const gpuIndex = Number.parseInt(parts[1]!, 10);
    const vramTotalBytes = nodeId === 'server-gpu-01' ? 51539607552 : 25769803776;
    return Object.freeze({ nodeId, gpuIndex, vramTotalBytes });
  }),
);
