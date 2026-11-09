import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * k6 NFR Load Test: Multi-Metric Telemetry Ingestion & Concurrency Burst (Flow D)
 * Mandated assertions: p95 latency < 50ms, error rate < 1%, zero unhandled 500s.
 */
export const options = {
  stages: [
    { duration: '5s', target: 20 },  // Ramp up to 20 virtual users
    { duration: '15s', target: 50 }, // Sustained load of 50 concurrent workers
    { duration: '5s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<100'], // 95% of requests under 50ms
    http_req_failed: ['rate<0.01'],               // Less than 1% errors
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:8080';

// 200 is success; 429 is the console's designed back-pressure (ERR_BUFFER_OVERFLOW) and is not an error.
// Anything else (400/422/5xx) counts as failed in http_req_failed.
http.setResponseCallback(http.expectedStatuses(200, 429));

// Unique per run so re-running against a live server never collides with batch ids kept for 1 hour (idempotency window).
const RUN_ID = Date.now().toString(16).padStart(12, '0').slice(-12);
const hex = (n, width) => n.toString(16).padStart(width, '0').slice(-width);

// The ingestion contract requires a 36-char UUID batch_id: anything else is rejected (422) and must never be sent.
const batchId = (vu, iter) => `${hex(vu, 8)}-${hex(iter, 4)}-4000-8000-${RUN_ID}`;

export default function () {
  // 31 workstations: ws-gpu-01 .. ws-gpu-31 (ws-gpu-32 does not exist and is rejected with 422)
  const nodeId = `ws-gpu-${String(((__VU - 1) % 31) + 1).padStart(2, '0')}`;
  const now = Date.now();

  const payload = JSON.stringify({
    batch_id: batchId(__VU, __ITER),
    client_timestamp_ms: now,
    events: [
      {
        node_id: nodeId,
        gpu_index: 0,
        timestamp_ms: now,
        temperature_celsius: 74.5 + (__VU % 12),
        vram_used_bytes: 14000000000,
        vram_total_bytes: 25769803776,
        gpu_utilization_pct: 65.0,
        active_jobs_count: 1,
        current_subject: 'CS-101',
      },
    ],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(`${BASE_URL}/v1/telemetry/batches`, payload, params);

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    // Non-vacuous: a 200 must really ingest the event (a malformed batch_id used to return 200 with accepted_count 0).
    'event was accepted': (r) => r.status === 429 || r.json('accepted_count') === 1,
    'response under 50ms': (r) => r.timings.duration < 50,
  });

  sleep(0.05); // 50ms interval between requests per VU
}
