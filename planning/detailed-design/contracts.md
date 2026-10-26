# Formal Behavioral Contracts Matrix (P, Q, I)
## Module 11: AI Infrastructure Observability Console
**Document Path:** `planning/detailed-design/contracts.md`  
**Status:** APPROVED (Phase 1 Baseline)  
**Author:** Juand (Partner A — Architect Lead)  
**Reviewed by:** Partner B (Test Lead)  
**Applicable Standard:** Design-by-Contract (DbC), Hexagonal Architecture, BMad TEA Standards  
**Language Rule Enforcement:** ZERO elastic words (*efficiently, appropriately, securely, quickly, gracefully, reasonable, robust, properly, as needed, scalable, user-friendly, etc.* have been eliminated and replaced by explicit types, numbers, ranges, and status codes).

---

## 1. Operational Behavioral Contracts

### Operation 1: `ingestMetricBatch(batch: MetricBatchDTO, clock: ClockPort): IngestionResultDTO`
* **Layer:** Inbound Port (`TelemetryIngestionPort`) delegating to Core Domain (`BucketDecimator`).
* **Precondition (P):**
  * **P1:** `batch.events` is an array of non-null `NodeTelemetryPacketDTO` with $1 \le \text{length} \le 5,000$. For each event: `node_id` matches regex `^(ws-gpu-[0-3][0-9]|server-gpu-01)$`; `gpu_index` $\in \{0, 1\}$ (for `ws-gpu-01..31`, `gpu_index` must equal `0`; for `server-gpu-01`, `gpu_index` $\in \{0, 1\}$); `temperature_celsius` $\in [-20.0, 120.0]$; `vram_used_bytes` $\le \text{vram_total_bytes}$; `vram_total_bytes` $\in \{25769803776, 51539607552\}$; `gpu_utilization_pct` $\in [0.0, 100.0]$; `timestamp_ms` $> 0$.  
    $\to$ *Violation:* `ERR_INVALID_TELEMETRY_PAYLOAD` (HTTP 422 Unprocessable Entity / WebSocket Close 1008).
  * **P2:** `batch.client_timestamp_ms` $\le \text{clock.nowMs()} + 5,000$ (anti-clock-drift barrier: timestamp must not exceed current virtual clock time by $> 5.0\text{ s}$).  
    $\to$ *Violation:* `ERR_FUTURE_TIMESTAMP_DRIFT` (HTTP 400 Bad Request).
  * **P3:** Ingestion buffer queue occupancy $\le 10,000\text{ raw events}$. If queue exceeds $10,000$, incoming batch is throttled.  
    $\to$ *Violation:* `ERR_BUFFER_OVERFLOW` (HTTP 429 Too Many Requests, with header `Retry-After: 1`).
* **Postcondition (Q):**
  * **Q1:** Returns `IngestionResultDTO` with schema:
    ```typescript
    {
      accepted_count: number;       // Exact number of frames incorporated into bucket
      dropped_count: number;        // Exact number of frames dropped due to queue saturation
      decimation_bucket_id: string; // Format: "BUCKET-<node_id>-<gpu_idx>-<timestamp_ms>"
      ingested_at_ms: number;       // Equal to clock.nowMs()
    }
    ```
  * **Q2:** For each valid event, state mutation in the active $250\text{ ms}$ decimation window computes updated scalar statistics: $\text{min} = \min(\text{current\_min}, x)$, $\text{max} = \max(\text{current\_max}, x)$, $\text{sum} = \text{sum} + x$, $\text{count} = \text{count} + 1$, $\text{last} = x$. If `clock.nowMs() - window.started_at_ms >= 250`, the active bucket is closed and its summary tuple is committed to `TelemetryRingBuffer` at slot `(write_ptr + 1) % 7200`. In the SQLite persistence store, duplicate points with identical `(node_id, gpu_index, timestamp_ms)` trigger an idempotent `INSERT OR IGNORE`.
  * **Q3:** Emits audit event `telemetry.batch.ingested` with payload `{ accepted_count, dropped_count, decimation_bucket_id }`. If `dropped_count > 0`, increments Prometheus counter metric `telemetry_events_dropped_total`.
  * **Q4:** Explainability payload in result cites `rule_id: "AD-01-DECIMATION-4HZ"`, `observed_rate: batch.events.length`, `buffer_capacity: 10000`, `decimation_window_ms: 250`.
  * **Q-fail:** If P1 or P2 is violated, zero events are written to the database or ring buffer, `accepted_count = 0`, and no state mutation occurs.
* **Invariant (I):**
  * **I1:** Ring buffer memory footprint is statically bounded to exactly $32\text{ nodes} \times 6\text{ metrics} \times 7,200\text{ slots} \times 4\text{ bytes} = 5,529,600\text{ bytes}$ ($\approx 5.53\text{ MB}$); zero dynamic heap allocations occur during streaming. Bound to: **AD-01, AD-02**.
  * **I2:** Main UI state dispatch frequency is bounded to exactly $\le 4.0\text{ dispatches/second}$ ($1\text{ tick per } 250\text{ ms}$). Bound to: **AD-01**.
* **Concurrency / Idempotency:** Concurrent batch calls across ingestion threads are serialized via SQLite atomic transaction `BEGIN IMMEDIATE` or Web Worker single-threaded event loop. Resending a batch with identical `batch_id` is idempotent and returns `accepted_count: 0, dropped_count: 0` without advancing ring buffer write pointers.
* **Time:** Governed by `clock: ClockPort`. Bucket interval follows half-open temporal window $[T_{\text{bucket\_start}}, T_{\text{bucket\_start}} + 250\text{ ms})$.
* **Latency Budget (NFR):** Processing of a 1,250-event batch ($250\text{ ms}$ slice of $5,000\text{ ev/s}$ burst) completes with $P_{95} \le 15.0\text{ ms}$ on a single CPU core (derived from PRD NFR-01 and NFR-05).

---

### Operation 2: `evaluateAlertRule(rule: AlertRuleDTO, window: SlidingWindowDTO, clock: ClockPort): AlertEvaluationDTO`
* **Layer:** Core Domain (`AnomalyDetectionEngine`).
* **Precondition (P):**
  * **P1:** `rule.rule_id` $\in \{\text{"TOKEN_SPIKE_AND_LATENCY_BREACH"}, \text{"NODE_HEARTBEAT_TIMEOUT"}, \text{"THERMAL_CRITICAL_THRESHOLD"}\}$; `window.short_window_seconds` $= 30$; `window.long_window_seconds` $= 300$; `window.histogram_bucket_count` $= 100$ ($200\text{ ms}$ width per bucket from $0$ to $20,000\text{ ms}$).  
    $\to$ *Violation:* `ERR_INVALID_ALERT_RULE_SPEC` (HTTP 422 Unprocessable Entity).
  * **P2:** Baseline sample quorum requirement: the long window ($W_{300\text{s}}$) must contain $\ge 50$ completed inference request samples.  
    $\to$ *Violation:* `ERR_COLD_START_INSUFFICIENT_SAMPLES` (HTTP 412 Precondition Failed). Status evaluates to `SUPPRESSED_COLD_START`.
* **Postcondition (Q):**
  * **Q1:** Returns `AlertEvaluationDTO` with schema:
    ```typescript
    {
      evaluation_id: string;        // UUIDv4
      rule_id: string;              // "TOKEN_SPIKE_AND_LATENCY_BREACH"
      status: "TRIGGERED" | "CLEARED" | "SUPPRESSED_COLD_START";
      evaluated_at_ms: number;      // Equal to clock.nowMs()
      alert_payload: AnomalyAlertPayload | null; // Non-null iff status === "TRIGGERED"
    }
    ```
  * **Q2:** When $\frac{\text{Throughput}(W_{30\text{s}})}{\text{Throughput}(W_{300\text{s}})} \ge 10.0$ AND $P_{99}(W_{30\text{s}}) > 8,000.0\text{ ms}$:  
    State transitions to `TRIGGERED`. Exactly 1 record is persisted to `operational_alerts` table with `incident_key = "INC-TOKEN-P99-" || strftime('%Y%m%d%H', clock.nowMs() / 1000, 'unixepoch')` iff no active alert with identical `incident_key` has `resolved_at IS NULL`.  
    When condition fails for 3 consecutive 5-second evaluation cycles ($15.0\text{ s}$ hysteresis), existing active alert record is mutated with `resolved_at = clock.nowMs()`, and status transitions to `CLEARED`.
  * **Q3:** Emits audit event `alert.anomaly.triggered` or `alert.anomaly.resolved`. Increments counter metric `alerts_emitted_total{rule_id="TOKEN_SPIKE_AND_LATENCY_BREACH"}`.
  * **Q4:** Explainability payload in `AnomalyAlertPayload` cites:
    * `rule_id: "AD-03-ANOMALY-EVAL"`
    * `observed_baseline_tok_per_sec`: numeric float
    * `observed_current_tok_per_sec`: numeric float
    * `spike_ratio`: numeric float ($\ge 10.0$)
    * `observed_p99_latency_ms`: numeric float ($> 8,000.0\text{ ms}$)
    * `threshold_ms`: `8000.0`
    * `saturated_nodes`: array of string node IDs
    * `primary_subject`: `"CS-480"`
  * **Q-fail:** If P1 or P2 is violated, zero alert records are created, active alerts remain unaltered, and `alert_payload = null`.
* **Invariant (I):**
  * **I1:** Exactly 1 active alert exists per incident until cleared; duplicate active alerts for the same condition on the same node/cluster are physically barred by `UNIQUE(incident_key)` where `resolved_at IS NULL`. Bound to: **AD-03, AD-05**.
  * **I2:** $P_{99}$ latency calculation uses a static 100-bucket histogram, enforcing deterministic $O(1)$ memory ($< 1\text{ KB}$) and execution time $\le 5.0\text{ ms}$. Bound to: **AD-03**.
* **Concurrency / Idempotency:** Atomic SQLite check-and-insert using conditional SQL: `INSERT INTO operational_alerts (...) VALUES (...) ON CONFLICT(incident_key) DO NOTHING`. Two parallel calls evaluate to the same deterministic state.
* **Time:** Governed by `clock: ClockPort`. Windows evaluate over half-open intervals: $W_{\text{short}} = [\text{now} - 30000, \text{now})$ and $W_{\text{long}} = [\text{now} - 300000, \text{now})$.
* **Latency Budget (NFR):** Alert rule evaluation across all 32 nodes completes with $P_{95} \le 5.0\text{ ms}$ (derived from PRD NFR-03).

---

### Operation 3: `buildUtilizationReport(query: ReportQueryDTO, clock: ClockPort): ExecutiveReportDTO`
* **Layer:** Inbound Port (`ReportingPort`) delegating to Driven Adapter (`LocalRollupRepository`).
* **Precondition (P):**
  * **P1:** `query.from_timestamp_ms < query.to_timestamp_ms`; both values are valid positive integers; duration $(query.to_timestamp_ms - query.from_timestamp_ms) \le 604,800,000$ (exactly $168\text{ hours}$ / $7\text{ days}$).  
    $\to$ *Violation:* `ERR_INVALID_DATE_RANGE` (HTTP 400 Bad Request).
  * **P2:** `query.to_timestamp_ms \le clock.nowMs()` (future query barrier).  
    $\to$ *Violation:* `ERR_FUTURE_REPORT_QUERY` (HTTP 422 Unprocessable Entity).
  * **P3:** `query.academic_subjects` is a non-empty subset of `["CS-101", "CS-480", "CS-530", "FAC-RES", "ALL"]`.  
    $\to$ *Violation:* `ERR_INVALID_ACADEMIC_SUBJECT` (HTTP 400 Bad Request).
* **Postcondition (Q):**
  * **Q1:** Returns `ExecutiveReportDTO` with schema:
    ```typescript
    {
      report_id: string;               // UUIDv4
      generated_at_ms: number;         // Equal to clock.nowMs()
      query_window: { from_ms: number; to_ms: number };
      summary: {
        total_cluster_gpu_hours: number;
        utilized_gpu_hours: number;
        idle_gpu_hours: number;
        overall_utilization_pct: number;
        total_prompt_tokens: number;
        total_completion_tokens: number;
      };
      by_subject: Record<string, SubjectBreakdownDTO>;
      node_aggregates: NodeRollupDTO[];
      is_empty: boolean;               // True iff total_cluster_gpu_hours === 0 or zero jobs recorded
      explanation: ExplanationDTO;
    }
    ```
  * **Q2:** Zero database mutations occur (pure read-only query). The query executes strictly against `rollup_hourly_metrics` table, scanning at most $168\text{ buckets} \times 32\text{ nodes} = 5,376\text{ records}$. Direct table scan on raw telemetry is blocked.
  * **Q3:** Emits audit event `report.utilization.generated` with `{ report_id, actor: "MANAGEMENT", range_hours }`. Increments metric `executive_reports_generated_total{status="SUCCESS"}`.
  * **Q4:** Explainability payload in `explanation` cites:
    * `rule_id: "AD-06-HOURLY-ROLLUPS"`
    * `scanned_buckets_count`: integer $\le 5376$
    * `resolution_minutes`: `60`
    * `empty_state_reason`: `"NO_WORKLOADS_FOUND_IN_WINDOW"` iff `is_empty === true`, otherwise `null`.
  * **Q-fail:** On any precondition failure, zero database queries are dispatched, returning typed `ErrorBodyDTO`.
* **Invariant (I):**
  * **I1:** Raw streaming telemetry is never scanned for time horizons exceeding $30\text{ minutes}$. Bound to: **AD-06**.
  * **I2:** The sum of `utilized_gpu_hours + idle_gpu_hours` equals exactly `total_cluster_gpu_hours` with precision tolerance $< 0.001\text{ hours}$. Bound to: **AD-06**.
* **Concurrency / Idempotency:** Pure idempotent query. Parallel executions return identical JSON results with zero data race.
* **Time:** Governed by `clock: ClockPort`. Query interval $[from, to)$ is half-open.
* **Latency Budget (NFR):** Query execution and JSON serialization complete with $P_{95} \le 1,500.0\text{ ms}$ under 5 concurrent management requests (derived from PRD NFR-04).

---

## 2. Typed Error Catalog

All system errors conform to the canonical error payload schema `ErrorBodyDTO`:
```typescript
interface ErrorBodyDTO {
  error_code: string;
  http_status: number;
  message: string;
  timestamp_ms: number;
  retryable: boolean;
  details: Record<string, unknown>;
}
```

| Error Code | HTTP / WS Status | Trigger Condition | Human-Readable Explanation Template | Retryable (Y/N) |
|---|:---:|---|---|:---:|
| `ERR_INVALID_TELEMETRY_PAYLOAD` | **422** / **1008** | Inbound metric packet fails range validation (e.g. Temp $> 120^\circ\text{C}$, invalid node ID, negative VRAM). | `"Telemetry frame for node '{node_id}' failed validation: field '{field}' value '{value}' exceeds allowed range [{min}, {max}]."` | **N** |
| `ERR_FUTURE_TIMESTAMP_DRIFT` | **400** | Telemetry timestamp exceeds server virtual clock by $> 5,000\text{ ms}$. | `"Packet rejected: timestamp {timestamp_ms} is {drift_ms}ms ahead of cluster clock {now_ms} (max allowed drift: 5000ms)."` | **N** |
| `ERR_BUFFER_OVERFLOW` | **429** | Ingestion worker queue exceeds $10,000\text{ raw events}$ ceiling during 5k ev/s storm. | `"Ingestion queue saturated at 10,000 events. Ingestion throttled to preserve UI responsiveness under AD-01."` | **Y** |
| `ERR_UNKNOWN_NODE_ID` | **404** | Frame references an uncatalogued node identifier. | `"Node '{node_id}' is not registered in the 32-node cluster fleet."` | **N** |
| `ERR_INVALID_ALERT_RULE_SPEC` | **422** | Alert evaluation called with unknown rule ID or invalid window size. | `"Alert rule '{rule_id}' is unknown or window configuration ({short_window}s/{long_window}s) violates AD-03."` | **N** |
| `ERR_COLD_START_INSUFFICIENT_SAMPLES` | **412** | Anomaly rule evaluated before baseline window accumulates 50 samples. | `"Anomaly evaluation suppressed under AD-03: baseline window contains only {count} samples (minimum required: 50)."` | **Y** |
| `ERR_DUPLICATE_ACTIVE_ALERT` | **409** | Attempted to insert an active alert when an unresolved incident exists. | `"Active alert with incident key '{incident_key}' already exists in unresolved state."` | **N** |
| `ERR_INVALID_DATE_RANGE` | **400** | Report query range is inverted ($from \ge to$) or duration $> 7\text{ days}$. | `"Invalid reporting window [{from_ms}, {to_ms}): duration must be positive and <= 168 hours (7 days)."` | **N** |
| `ERR_FUTURE_REPORT_QUERY` | **422** | Report query `to_timestamp_ms` extends beyond current clock time. | `"Report query upper bound {to_ms} extends into the future relative to current clock {now_ms}."` | **N** |
| `ERR_INVALID_ACADEMIC_SUBJECT` | **400** | Report requested for an uncatalogued subject filter. | `"Academic subject filter '{subject}' is invalid. Allowed: CS-101, CS-480, CS-530, FAC-RES, ALL."` | **N** |
| `ERR_DATABASE_UNAVAILABLE` | **503** | Local SQLite engine or ring buffer connection failure. | `"Internal observability storage engine is temporarily unavailable."` | **Y** |

---

## 3. Invariant Binding Table

Every architectural invariant from `planning/ARCHITECTURE.md` (AD-01 to AD-08) is physically anchored to a machine-enforceable enforcement point and a corresponding red-phase ATDD test:

| Invariant ID | AD-n Enforced | Physical Enforcement Point (Function / DB Constraint / Guard) | Test that Turns RED if Removed |
|:---:|:---:|---|---|
| **INV-01** | **AD-01** | `BucketDecimator.accumulate()`: Throttles dispatches to exactly 4 Hz ($250\text{ ms}$ interval); drops raw frames when buffer queue $> 10,000$. | `test_ingestion_enforces_4hz_dispatch_cap_under_5000_ev_storm` |
| **INV-02** | **AD-02** | `TelemetryRingBuffer`: Statically sized `Float32Array(7200)` with pointer wrap modulo 7,200; zero heap reallocations. | `test_ring_buffer_memory_remains_static_after_100k_events` |
| **INV-03** | **AD-03** | `AnomalyDetectionEngine.evaluate()`: Guard `if (baseline_samples < 50) return SUPPRESSED_COLD_START`. | `test_cold_start_suppresses_anomaly_alarm_below_50_samples` |
| **INV-04** | **AD-04** | `NodeHeartbeatWatchdog.check()` + SQLite `CHECK(state IN ('HEALTHY','STALE','SILENT_TIMEOUT','RECOVERING','CORDONED'))`: Transitions node to `SILENT_TIMEOUT` at $\ge 15.0\text{ s}$ of silence; requires 3 consecutive heartbeats for recovery. | `test_node_ws22_transitions_to_silent_timeout_after_15s` |
| **INV-05** | **AD-05** | `AlertDispatcher.dispatchHighPriority()` + SQLite `CREATE UNIQUE INDEX idx_active_alerts ON operational_alerts(incident_key) WHERE resolved_at IS NULL`: Bypasses 250ms decimation queue and prevents duplicate active incident rows. | `test_alert_fires_exactly_once_per_incident_until_cleared` |
| **INV-06** | **AD-06** | `LocalRollupRepository.query7Day()`: SQL query restricted strictly to table `rollup_hourly_metrics` ($168\text{ rows/node}$); scans on raw telemetry table rejected with error. | `test_7day_report_queries_strictly_hourly_rollups_not_raw` |
| **INV-07** | **AD-07** | Ingestion pipeline tests bind to `FakeClock` and synthetic fixture loader; network calls outside localhost throw runtime assertion error. | `test_standalone_execution_requires_zero_cloud_network_io` |
| **INV-08** | **AD-08** | SQLite `cluster_nodes` and `telemetry_buckets`: `PRIMARY KEY (node_id, gpu_index)` with `CHECK (gpu_index IN (0, 1))`; rejects `gpu_index = 1` for workstations. | `test_server_gpu01_tracks_dual_gpus_independently_without_averaging` |
