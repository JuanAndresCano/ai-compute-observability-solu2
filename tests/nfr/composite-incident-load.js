import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * k6 NFR (Flow D, Story 11.5 / AD-28): an alert storm must collapse into one incident per failing node.
 * 50 virtual users hammer the 31 workstations with telemetry that carries all three cooling-failure signals
 * (temperature > 85 C, fan_rpm 0, dropped_tokens > 0). Thousands of anomalies must produce exactly 31 incidents,
 * one per node, while latency and error budgets hold.
 */
export const options = {
  stages: [
    { duration: '4s', target: 50 },
    { duration: '10s', target: 50 },
    { duration: '2s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<100'],
    http_req_failed: ['rate<0.01'],
    incident_dedup_ok: ['rate==1'], // evaluated once, in teardown()
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:8080';
const NODES = 31; // ws-gpu-01 .. ws-gpu-31

http.setResponseCallback(http.expectedStatuses(200, 429));

const RUN_ID = Date.now().toString(16).padStart(12, '0').slice(-12);
const hex = (n, width) => n.toString(16).padStart(width, '0').slice(-width);
const batchId = (vu, iter) => `${hex(vu, 8)}-${hex(iter, 4)}-4000-8000-${RUN_ID}`;
const incidentDedupOk = new Rate('incident_dedup_ok');

export default function () {
  const nodeId = `ws-gpu-${String(((__VU - 1) % NODES) + 1).padStart(2, '0')}`;
  const now = Date.now();
  const res = http.post(
    `${BASE_URL}/v1/telemetry/batches`,
    JSON.stringify({
      batch_id: batchId(__VU, __ITER),
      client_timestamp_ms: now,
      events: [{
        node_id: nodeId, gpu_index: 0, timestamp_ms: now,
        temperature_celsius: 91, vram_used_bytes: 14000000000, vram_total_bytes: 25769803776,
        gpu_utilization_pct: 65.0, active_jobs_count: 1, current_subject: 'CS-101',
        fan_rpm: 0, dropped_tokens: 12,
      }],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'event was accepted': (r) => r.status === 429 || r.json('accepted_count') === 1,
  });
  sleep(0.05);
}

// After the storm: exactly one incident per node, no per-request alert flood.
export function teardown() {
  const res = http.get(`${BASE_URL}/v1/incidents`);
  const incidents = res.status === 200 ? res.json('incidents') : [];
  const nodes = new Set(incidents.map((i) => i.node_id));
  const types = new Set(incidents.map((i) => i.incident_type));
  incidentDedupOk.add(
    res.status === 200 &&
      incidents.length === NODES &&
      nodes.size === NODES &&
      types.size === 1 &&
      types.has('CRITICAL_COOLING_FAILURE'),
  );
}
