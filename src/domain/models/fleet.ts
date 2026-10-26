/** The 33 GPU series of the Plan-2 fleet: 31 workstation GPUs + 2 GPUs of server-gpu-01 (AD-08). Static data, no behaviour. */
export const FLEET_SERIES_IDS: readonly string[] = Object.freeze([
  ...Array.from({ length: 31 }, (_, i) => `ws-gpu-${String(i + 1).padStart(2, '0')}:0`),
  'server-gpu-01:0',
  'server-gpu-01:1',
]);
