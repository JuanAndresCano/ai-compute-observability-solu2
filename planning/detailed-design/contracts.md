# Formal Behavioral Contracts Matrix (P, Q, I)
## Module 11: AI Infrastructure Observability Console
**Document Path:** `planning/detailed-design/contracts.md`  
**Status:** AMENDED v1.1 (Partner B review, 2026-10-26) — **approval by Partner B: PENDING**  
**Author:** Juand (Partner A — Architect Lead)  
**Amended by:** Partner B (Test Lead) — see `ai-log/decision-log-solu2.md` DEC-12  
**Applicable Standard:** Design-by-Contract (DbC), Hexagonal Architecture, BMad TEA Standards  
**Language Rule Enforcement:** ZERO elastic words (*efficiently, appropriately, securely, quickly, gracefully, reasonable, robust, properly, as needed, scalable, user-friendly, etc.* have been eliminated and replaced by explicit types, numbers, ranges, and status codes).

**Amendment summary (v1.0 → v1.1):** AMD-1 overflow becomes tail-drop with visible `dropped_count`; AMD-2 cold start becomes a result status, not an error; AMD-3 alert uniqueness moves to `(trigger_rule, node_id)`; AMD-4 ring buffer sized for 33 GPU series; AMD-5 error catalog reduced to 8 codes, every code bound to a trigger; AMD-6 latency budgets cite the correct NFR; AMD-7 temperature range single-sourced; AMD-8 hourly rollup gains `gpu_hours_unavailable`; AMD-9 `evaluateAlertRule` receives its sample data in `SlidingWindowDTO`, and `ingestMetricBatch` validates and accumulates `inference_metrics`.

---

## 1. Operational Behavioral Contracts

### Operation 1: `ingestMetricBatch(batch: MetricBatchDTO, clock: ClockPort): IngestionResultDTO`
* **Layer:** Inbound Port (`TelemetryIngestionPort`) delegating to Core Domain (`BucketDecimator`).
* **Precondition (P):**
  * **P1:** `batch.events` is an array of non-null `NodeTelemetryPacketDTO` with $1 \le \text{length} \le 5,000$. For each event: `node_id` matches regex `^(ws-gpu-(0[1-9]|[12][0-9]|3[01])|server-gpu-01)$` (the 32 registered nodes: `ws-gpu-01` to `ws-gpu-31` and `server-gpu-01`); `gpu_index` $\in \{0, 1\}$ (for `ws-gpu-01..31`, `gpu_index` must equal `0`; for `server-gpu-01`, `gpu_index` $\in \{0, 1\}$); `temperature_celsius` $\in [-20.0, 120.0]$; `vram_used_bytes` $\le \text{vram_total_bytes}$; `vram_total_bytes` $\in \{25769803776, 51539607552\}$ (`25769803776` for `ws-gpu-*`, `51539607552` for `server-gpu-01`); `gpu_utilization_pct` $\in [0.0, 100.0]$; `timestamp_ms` $> 0$.  
    If `batch.inference_metrics` is present, it has $0 \le \text{length} \le 5,000$ and each `InferenceMetricPacketDTO` satisfies: `request_id` is a UUIDv4; `node_id` and `gpu_index` follow the same rules as events; `academic_subject` $\in$ `AcademicSubjectType`; `prompt_tokens` and `completion_tokens` are integers $\ge 0$; `queue_duration_ms` $\ge 0.0$ and `inference_duration_ms` $\ge 0.0$; $|\text{total_latency_ms} - (\text{queue_duration_ms} + \text{inference_duration_ms})| \le 0.001$; `timestamp_ms` $> 0$.  
    $\to$ *Violation:* `ERR_INVALID_TELEMETRY_PAYLOAD` (HTTP 422 Unprocessable Entity / WebSocket Close 1008).
  * **P2:** `batch.client_timestamp_ms` $\le \text{clock.nowMs()} + 5,000$ (anti-clock-drift barrier: timestamp must not exceed current virtual clock time by $> 5.0\text{ s}$).  
    $\to$ *Violation:* `ERR_FUTURE_TIMESTAMP_DRIFT` (HTTP 400 Bad Request).
  * **P3 (capacity rule):** Let `free = 10,000 - occupancy`, where `occupancy` is the number of raw events accepted and not yet folded into a closed 250 ms bucket. If `free = 0`, the batch is rejected.  
    $\to$ *Violation (`free = 0`):* `ERR_BUFFER_OVERFLOW` (HTTP 429 Too Many Requests, header `Retry-After: 1`).  
    If `1 <= free < batch.events.length`, P3 is not violated: the batch is partially accepted (see Q1, Q2).
* **Postcondition (Q):**
  * **Q1:** Returns `IngestionResultDTO` with schema:
    ```typescript
    {
      accepted_count: number;       // = min(batch.events.length, free); first `accepted_count` events of the array
      dropped_count: number;        // = batch.events.length - accepted_count; the LAST `dropped_count` events of the array (tail-drop)
      decimation_bucket_id: string; // Format: "BUCKET-<node_id>-<gpu_idx>-<timestamp_ms>"
      ingested_at_ms: number;       // Equal to clock.nowMs()
      explanation: ExplanationDTO;
    }
    ```
    Invariant of the result: `accepted_count + dropped_count = batch.events.length`, except for a replayed `batch_id` (see Concurrency).
  * **Q2:** For each accepted event, state mutation in the active $250\text{ ms}$ decimation window computes updated scalar statistics: $\text{min} = \min(\text{current\_min}, x)$, $\text{max} = \max(\text{current\_max}, x)$, $\text{sum} = \text{sum} + x$, $\text{count} = \text{count} + 1$, $\text{last} = x$. If `clock.nowMs() - window.started_at_ms >= 250`, the active bucket is closed and its summary tuple is committed to `TelemetryRingBuffer` at slot `(write_ptr + 1) % 7200`. In the SQLite persistence store, duplicate points with identical `(node_id, gpu_index, timestamp_ms)` trigger an idempotent `INSERT OR IGNORE`.  
    For each inference metric packet: `total_latency_ms` is added to the 100-bucket histogram (bucket index $= \min(99, \lfloor \text{total\_latency\_ms} / 200 \rfloor)$, so any latency $\ge 20,000\text{ ms}$ is counted in bucket 99), and `prompt_tokens` is added to the per-second prompt-token counters. These accumulators are the only source of the `SlidingWindowDTO` consumed by Operation 2. Inference metrics are folded immediately into fixed-size accumulators and are not subject to the 10,000-event capacity rule.
  * **Q3:** Emits audit event `telemetry.batch.ingested` with payload `{ accepted_count, dropped_count, decimation_bucket_id }`. If `dropped_count > 0`, increments Prometheus counter metric `telemetry_events_dropped_total` by `dropped_count`.
  * **Q4:** Explainability payload in result cites `rule_id: "AD-01-DECIMATION-4HZ"`, `observed_rate: batch.events.length`, `buffer_capacity: 10000`, `decimation_window_ms: 250`, `free_slots: free`.
  * **Q-fail:** If P1, P2, or P3 with `free = 0` is violated, no `IngestionResultDTO` is returned (an `ErrorBodyDTO` is returned), zero events are written to the database or ring buffer, the write pointer is unchanged, and `telemetry_events_dropped_total` is unchanged. If the repository port raises a storage failure, the operation returns `ERR_DATABASE_UNAVAILABLE` (HTTP 503), the SQLite transaction is rolled back, and zero events are written.
* **Invariant (I):**
  * **I1:** Ring buffer memory footprint is statically bounded to exactly $33\text{ GPU series} \times 6\text{ metrics} \times 7,200\text{ slots} \times 4\text{ bytes} = 5,702,400\text{ bytes}$ ($\approx 5.70\text{ MB}$), where the 33 series are 31 workstation GPUs plus 2 GPUs of `server-gpu-01`, each stored independently (never averaged); zero dynamic heap allocations occur during streaming. Bound to: **AD-01, AD-02, AD-08**.
  * **I2:** Main UI state dispatch frequency is bounded to exactly $\le 4.0\text{ dispatches/second}$ ($1\text{ tick per } 250\text{ ms}$). Bound to: **AD-01**.
* **Concurrency / Idempotency:** Concurrent batch calls across ingestion threads are serialized via SQLite atomic transaction `BEGIN IMMEDIATE` or Web Worker single-threaded event loop. Resending a batch with identical `batch_id` is idempotent and returns `accepted_count: 0, dropped_count: 0` without advancing ring buffer write pointers.
* **Time:** Governed by `clock: ClockPort`. Bucket interval follows half-open temporal window $[T_{\text{bucket\_start}}, T_{\text{bucket\_start}} + 250\text{ ms})$.
* **Latency Budget (design budget, not a PRD NFR):** Processing of a 1,250-event batch ($250\text{ ms}$ slice of $5,000\text{ ev/s}$) completes with $P_{95} \le 15.0\text{ ms}$ on a single CPU core. Derived from NFR-01 ($5,000\text{ ev/s}$ sustained, hence 1,250 events per $250\text{ ms}$) and NFR-02 (heatmap update $\le 500\text{ ms}$ under storm, so ingestion consumes $3\%$ of it).

---

### Operation 2: `evaluateAlertRule(rule: AlertRuleDTO, window: SlidingWindowDTO, clock: ClockPort): AlertEvaluationDTO`
* **Layer:** Core Domain (`AnomalyDetectionEngine`). The evaluator is a pure function of `(rule, window, clock.nowMs())`; the application service assembles `window` from the accumulators fed by Operation 1 (Q2).
* **Precondition (P):**
  * **P1:** `rule.rule_id` $\in \{\text{"TOKEN_SPIKE_AND_LATENCY_BREACH"}, \text{"NODE_HEARTBEAT_TIMEOUT"}, \text{"THERMAL_CRITICAL_THRESHOLD"}\}$; `window.short_window_seconds` $= 30$; `window.long_window_seconds` $= 300$; `window.histogram_bucket_count` $= 100$ ($200\text{ ms}$ width per bucket from $0$ to $20,000\text{ ms}$); `window.short_histogram` and `window.long_histogram` are arrays of exactly 100 integers $\ge 0$; `window.short_window_prompt_tokens` and `window.long_window_prompt_tokens` are integers $\ge 0$; the short window is contained in the long window: for every bucket $i$, `long_histogram[i]` $\ge$ `short_histogram[i]`, and `long_window_prompt_tokens` $\ge$ `short_window_prompt_tokens`.  
    $\to$ *Violation:* `ERR_INVALID_ALERT_RULE_SPEC` (HTTP 422 Unprocessable Entity).
  * *(There is no baseline-quorum precondition: a long window with fewer than 50 samples is a valid input that produces the `SUPPRESSED_COLD_START` result in Q2.)*
* **Postcondition (Q):**
  * **Q1:** Returns `AlertEvaluationDTO` with schema:
    ```typescript
    {
      evaluation_id: string;        // UUIDv4
      rule_id: string;              // "TOKEN_SPIKE_AND_LATENCY_BREACH"
      status: "TRIGGERED" | "CLEARED" | "SUPPRESSED_COLD_START";
      evaluated_at_ms: number;      // Equal to clock.nowMs()
      alert_payload: AnomalyAlertPayload | null; // Non-null iff status === "TRIGGERED"
      explanation: ExplanationDTO;
    }
    ```
  * **Q2 (evaluation order):**
    1. *Cold start.* Let $N_{\text{long}} = \sum_i \text{long\_histogram}[i]$. If $N_{\text{long}} < 50$: `status = "SUPPRESSED_COLD_START"`, `alert_payload = null`, zero database mutations, active alerts untouched, hysteresis not advanced.
    2. *Metrics.* $\text{baseline\_tps} = \text{long\_window\_prompt\_tokens} / 300$; $\text{current\_tps} = \text{short\_window\_prompt\_tokens} / 30$; $\text{spike\_ratio} = \text{current\_tps} / \text{baseline\_tps}$ if $\text{baseline\_tps} > 0$, otherwise the spike condition is false. $N_{\text{short}} = \sum_i \text{short\_histogram}[i]$; $P_{99}$ is the upper edge $(i+1) \times 200\text{ ms}$ of the first bucket $i$ whose cumulative short-window count is $\ge \lceil 0.99 \times N_{\text{short}} \rceil$; $P_{99} = 0.0$ if $N_{\text{short}} = 0$. Breach $\iff \text{spike\_ratio} \ge 10.0 \;\land\; P_{99} > 8,000.0\text{ ms}$.
    3. *Breach.* `status = "TRIGGERED"`. The service executes one atomic statement `INSERT INTO operational_alerts (...) VALUES (...) ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING`, with `node_id = "CLUSTER"` and `incident_key = "INC-TOKEN-P99-CLUSTER-" || <triggered_at_ms>`. If 1 row was inserted, `alert_payload` is the new alert. If 0 rows were inserted (an active alert for `("TOKEN_SPIKE_AND_LATENCY_BREACH", "CLUSTER")` already exists), `status` is still `"TRIGGERED"`, `alert_payload` is the existing alert, zero rows are created, and no new audit event is emitted.
    4. *No breach.* While an active alert exists, `status = "TRIGGERED"` and the alert stays active; when the breach condition has failed for 3 consecutive 5-second evaluation cycles ($15.0\text{ s}$ hysteresis), the active alert record is mutated with `resolved_at_ms = clock.nowMs()` and `status = "CLEARED"`. With no active alert, `status = "CLEARED"` and nothing is mutated.
  * **Q3:** Emits audit event `alert.anomaly.triggered` (only when step 3 inserted a row) or `alert.anomaly.resolved` (step 4 resolution). Increments counter metric `alerts_emitted_total{rule_id="TOKEN_SPIKE_AND_LATENCY_BREACH"}` on `alert.anomaly.triggered` only.
  * **Q4:** Explainability payload in `AnomalyAlertPayload` cites:
    * `rule_id: "AD-03-ANOMALY-EVAL"`
    * `observed_baseline_tok_per_sec`: numeric float
    * `observed_current_tok_per_sec`: numeric float
    * `spike_ratio`: numeric float ($\ge 10.0$)
    * `observed_p99_latency_ms`: numeric float ($> 8,000.0\text{ ms}$)
    * `threshold_ms`: `8000.0`
    * `saturated_nodes`: array of string node IDs
    * `primary_subject`: `"CS-480"`  
    For `SUPPRESSED_COLD_START`, `explanation` cites `rule_id: "AD-03-ANOMALY-EVAL"`, `observed_samples: N_long`, `required_samples: 50`.
  * **Q-fail:** If P1 is violated, an `ErrorBodyDTO` is returned, zero alert records are created, active alerts remain unaltered, and no audit event is emitted. If the repository port raises a storage failure, the operation returns `ERR_DATABASE_UNAVAILABLE` (HTTP 503) and zero rows are created or modified.
* **Invariant (I):**
  * **I1:** At most 1 active alert exists per `(trigger_rule, node_id)` at any instant; a second active row is physically barred by the partial unique index `idx_unique_active_alert ON operational_alerts(trigger_rule, node_id) WHERE resolved_at_ms IS NULL`. `incident_key` is unique across all rows (resolved or not) and identifies one incident. Bound to: **AD-03, AD-05**.
  * **I2:** $P_{99}$ latency calculation uses a static 100-bucket histogram, enforcing deterministic $O(1)$ memory ($< 1\text{ KB}$) and execution time $\le 5.0\text{ ms}$. Bound to: **AD-03**.
* **Concurrency / Idempotency:** Atomic SQLite conditional insert (Q2 step 3). Two parallel breaching calls produce exactly 1 row; both return `status = "TRIGGERED"` with the same `alert_id`; exactly 1 `alert.anomaly.triggered` event is emitted. A repeated call with the same `window` returns the same `status` and creates 0 additional rows.
* **Time:** Governed by `clock: ClockPort`. The assembled windows cover the half-open intervals $W_{\text{short}} = [\text{now} - 30000, \text{now})$ and $W_{\text{long}} = [\text{now} - 300000, \text{now})$; `evaluated_at_ms`, `triggered_at_ms` and `resolved_at_ms` are read from `clock.nowMs()`.
* **Latency Budget (design budget, not a PRD NFR):** Alert rule evaluation across all 32 nodes completes with $P_{95} \le 5.0\text{ ms}$. Derived from NFR-03 (alarm dispatched $\le 1.0\text{ s}$ after the window satisfies both conditions): the evaluation consumes $0.5\%$ of that budget.

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
        total_cluster_gpu_hours: number;   // = Σ over scanned rollup rows of (busy + idle + unavailable)
        utilized_gpu_hours: number;        // = Σ gpu_hours_busy
        idle_gpu_hours: number;            // = Σ gpu_hours_idle
        unavailable_gpu_hours: number;     // = Σ gpu_hours_unavailable (GPU in STALE/SILENT_TIMEOUT/RECOVERING/CORDONED)
        overall_utilization_pct: number;   // = 100 × utilized_gpu_hours / total_cluster_gpu_hours; 0.0 when total_cluster_gpu_hours = 0
        total_prompt_tokens: number;
        total_completion_tokens: number;
      };
      by_subject: Record<string, SubjectBreakdownDTO>;
      node_aggregates: NodeRollupDTO[];
      is_empty: boolean;               // True iff total_cluster_gpu_hours === 0 or zero jobs recorded
      explanation: ExplanationDTO;
    }
    ```
  * **Q2:** Zero database mutations occur (pure read-only query). The query executes strictly against `rollup_hourly_metrics` table, scanning at most $168\text{ buckets} \times 33\text{ GPUs} = 5,544\text{ records}$ (31 workstation GPUs + 2 GPUs of `server-gpu-01`). Direct table scan on raw telemetry is blocked.
  * **Q3:** Emits audit event `report.utilization.generated` with `{ report_id, actor: "MANAGEMENT", range_hours }`. Increments metric `executive_reports_generated_total{status="SUCCESS"}`.
  * **Q4:** Explainability payload in `explanation` cites:
    * `rule_id: "AD-06-HOURLY-ROLLUPS"`
    * `scanned_buckets_count`: integer $\le 5544$
    * `resolution_minutes`: `60`
    * `empty_state_reason`: `"NO_WORKLOADS_FOUND_IN_WINDOW"` iff `is_empty === true`, otherwise `null`.
  * **Q-fail:** On any precondition failure, zero database queries are dispatched, returning typed `ErrorBodyDTO`. If the repository port raises a storage failure, the operation returns `ERR_DATABASE_UNAVAILABLE` (HTTP 503) and no partial report is returned.
* **Invariant (I):**
  * **I1:** Raw streaming telemetry is never scanned for time horizons exceeding $30\text{ minutes}$. Bound to: **AD-06**.
  * **I2:** Every stored hourly rollup row satisfies $|\text{gpu\_hours\_busy} + \text{gpu\_hours\_idle} + \text{gpu\_hours\_unavailable} - 1.0| \le 0.001$ (enforced by `CHECK chk_hourly_gpu_sum`), and the report satisfies $|\text{utilized\_gpu\_hours} + \text{idle\_gpu\_hours} + \text{unavailable\_gpu\_hours} - \text{total\_cluster\_gpu\_hours}| < 0.001$. Bound to: **AD-06**.
* **Concurrency / Idempotency:** Pure idempotent query. Parallel executions return identical JSON results with zero data race.
* **Time:** Governed by `clock: ClockPort`. Query interval $[from, to)$ is half-open.
* **Latency Budget (NFR):** Query execution and JSON serialization complete with $P_{95} \le 1,500.0\text{ ms}$ under 5 concurrent management requests (PRD NFR-06).

---

## 2. Typed Error Catalog

All system errors conform to the canonical error payload schema `ErrorBodyDTO`:
```typescript
interface ErrorBodyDTO {
  error_code: ErrorCodeType;
  http_status: number;
  message: string;
  timestamp_ms: number;
  retryable: boolean;
  details: Record<string, unknown>;
}
```

Every code below is raised by at least one named clause; a code with no trigger clause is not allowed in this catalog.

| Error Code | HTTP / WS Status | Raised by | Trigger Condition | Human-Readable Explanation Template | Retryable (Y/N) |
|---|:---:|---|---|---|:---:|
| `ERR_INVALID_TELEMETRY_PAYLOAD` | **422** / **1008** | Op1 P1 | Inbound event or inference packet fails range, format or registry validation (e.g. temperature $> 120^\circ\text{C}$, `node_id` outside the 32 registered nodes, negative VRAM). | `"Telemetry frame for node '{node_id}' failed validation: field '{field}' value '{value}' exceeds allowed range [{min}, {max}]."` | **N** |
| `ERR_FUTURE_TIMESTAMP_DRIFT` | **400** | Op1 P2 | `batch.client_timestamp_ms` exceeds the server clock by $> 5,000\text{ ms}$. | `"Packet rejected: timestamp {timestamp_ms} is {drift_ms}ms ahead of cluster clock {now_ms} (max allowed drift: 5000ms)."` | **N** |
| `ERR_BUFFER_OVERFLOW` | **429** | Op1 P3 | Free queue capacity is $0$ of $10,000$ raw events (zero events can be accepted). | `"Ingestion queue saturated: 0 of 10,000 slots free. Retry after 1 s (AD-01)."` | **Y** |
| `ERR_INVALID_ALERT_RULE_SPEC` | **422** | Op2 P1 | Unknown rule ID, window sizes different from 30/300/100, malformed histograms, or short window not contained in long window. | `"Alert rule '{rule_id}' or window configuration ({short_window}s/{long_window}s) violates AD-03: {reason}."` | **N** |
| `ERR_INVALID_DATE_RANGE` | **400** | Op3 P1 | Report query range is inverted ($from \ge to$) or duration $> 7\text{ days}$. | `"Invalid reporting window [{from_ms}, {to_ms}): duration must be positive and <= 168 hours (7 days)."` | **N** |
| `ERR_FUTURE_REPORT_QUERY` | **422** | Op3 P2 | Report query `to_timestamp_ms` extends beyond current clock time. | `"Report query upper bound {to_ms} extends into the future relative to current clock {now_ms}."` | **N** |
| `ERR_INVALID_ACADEMIC_SUBJECT` | **400** | Op3 P3 | Report requested for an uncatalogued subject filter. | `"Academic subject filter '{subject}' is invalid. Allowed: CS-101, CS-480, CS-530, FAC-RES, ALL."` | **N** |
| `ERR_DATABASE_UNAVAILABLE` | **503** | Op1, Op2, Op3 Q-fail | The repository port raises a storage failure (SQLite engine or ring buffer connection failure). | `"Internal observability storage engine is temporarily unavailable."` | **Y** |

*Removed in v1.1:* `ERR_COLD_START_INSUFFICIENT_SAMPLES` (now result status `SUPPRESSED_COLD_START`, AMD-2), `ERR_UNKNOWN_NODE_ID` (the P1 regex admits only the 32 registered nodes, AMD-5), `ERR_DUPLICATE_ACTIVE_ALERT` (duplicate is idempotent via `ON CONFLICT DO NOTHING`, AMD-5).

---

## 3. Invariant Binding Table

Every architectural invariant from `planning/ARCHITECTURE.md` (AD-01 to AD-08) is physically anchored to a machine-enforceable enforcement point and a corresponding red-phase ATDD test:

| Invariant ID | AD-n Enforced | Physical Enforcement Point (Function / DB Constraint / Guard) | Test that Turns RED if Removed |
|:---:|:---:|---|---|
| **INV-01** | **AD-01** | `BucketDecimator.accumulate()`: Throttles dispatches to exactly 4 Hz ($250\text{ ms}$ interval); accepts at most `free` events per batch and tail-drops the rest while counting `dropped_count`. | `test_ingestion_enforces_4hz_dispatch_cap_under_5000_ev_storm` |
| **INV-02** | **AD-02** | `TelemetryRingBuffer`: Statically sized `Float32Array(7200)` per (GPU series, metric) = 33 × 6 arrays = 5,702,400 bytes; pointer wrap modulo 7,200; zero heap reallocations. | `test_ring_buffer_memory_remains_static_after_100k_events` |
| **INV-03** | **AD-03** | `AnomalyDetectionEngine.evaluate()`: Guard `if (sum(long_histogram) < 50) return SUPPRESSED_COLD_START`, evaluated before any metric computation. | `test_cold_start_suppresses_anomaly_alarm_below_50_samples` |
| **INV-04** | **AD-04** | `NodeHeartbeatWatchdog.check()` + SQLite `CHECK(state IN ('HEALTHY','STALE','SILENT_TIMEOUT','RECOVERING','CORDONED'))`: Transitions node to `SILENT_TIMEOUT` at $\ge 15.0\text{ s}$ of silence; requires 3 consecutive heartbeats for recovery. | `test_node_ws22_transitions_to_silent_timeout_after_15s` |
| **INV-05** | **AD-05** | `AlertDispatcher.dispatchHighPriority()` + SQLite `CREATE UNIQUE INDEX idx_unique_active_alert ON operational_alerts(trigger_rule, node_id) WHERE resolved_at_ms IS NULL` and `UNIQUE(incident_key)`: Bypasses 250ms decimation queue and prevents duplicate active alert rows. | `test_alert_fires_exactly_once_per_incident_until_cleared` |
| **INV-06** | **AD-06** | `LocalRollupRepository.query7Day()`: SQL query restricted strictly to table `rollup_hourly_metrics` ($168\text{ rows per GPU}$, 33 GPUs); `CHECK chk_hourly_gpu_sum` forces busy + idle + unavailable = 1.0 ± 0.001 per row; scans on raw telemetry table rejected with error. | `test_7day_report_queries_strictly_hourly_rollups_not_raw` |
| **INV-07** | **AD-07** | Ingestion pipeline tests bind to `FakeClock` and synthetic fixture loader; network calls outside localhost throw runtime assertion error. | `test_standalone_execution_requires_zero_cloud_network_io` |
| **INV-08** | **AD-08** | SQLite `cluster_nodes` and `telemetry_buckets`: `PRIMARY KEY (node_id, gpu_index)` with `CHECK (gpu_index IN (0, 1))`; rejects `gpu_index = 1` for workstations. | `test_server_gpu01_tracks_dual_gpus_independently_without_averaging` |
