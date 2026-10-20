# Epics and Stories — Module 11: AI Infrastructure Observability Console

**Phase:** 4 (Solu-2) · **Authors:** Partner B (Test Lead) with John (PM) and Amelia (Dev) perspectives, to be confirmed by Partner A · **Date:** 2026-10-26
**Sources:** `planning/prd.md` (FR-01..05, NFR-01..08), `planning/ARCHITECTURE.md` (AD-01..08), `planning/detailed-design/contracts.md` v1.2 (Operations 1-4), `schemas/`, `ux/` (scenarios 1-4, `EXPERIENCE.md` state matrix), `test/atdd/observability_contracts.test.ts` (153 red cases), `test/traceability-matrix.md`.
**Stop-point:** this document ends solutioning. No story is implemented in this unit; every story below already has its red tests.

## Requirements inventory (what must be covered)

| ID | Requirement (short) | Stories |
|---|---|---|
| FR-01 | 32-node heatmap ≥ 4 Hz, validation, STALE_CACHED | 1.2, 1.3, 1.4, 3.4 |
| FR-02 | Token spike + P99 alarm, cold start, explainable | 3.1, 3.2, 3.3 |
| FR-03 | Silent node at 15.0 s, forensic drill-down | 3.4, 3.5 |
| FR-04 | 7-day executive report, subjects, idle, peak contention | 4.1, 4.2 |
| FR-05 | Storm throttling and decimation (Mandatory Edge Case) | 2.1, 2.2, 2.3, 2.4 |
| NFR-01 | ≥ 5,000 ev/s for ≥ 15 min | 2.3, 2.4 |
| NFR-02 | Render latency ≤ 250 / 500 ms | 1.2, 2.3 |
| NFR-03 | Alarm ≤ 1.0 s | 3.1, 3.2 |
| NFR-04 | Watchdog 15.0 s ± 0.5 s | 3.4 |
| NFR-05 | Memory ≤ 128 MB | 2.1, 2.3 |
| NFR-06 | Report ≤ 1,500 ms | 4.1 |
| NFR-07 | WCAG 2.1 AA | every story with a UI surface (DoD), audited in 4.3 |
| NFR-08 | Standalone, no GPU, no cloud | 1.1, 4.3 |

## UX state → backend contract map (every Loading / Empty / Error / Success state has a contract and a DTO)

| Surface | Loading | Empty | Error | Success | Denied |
|---|---|---|---|---|---|
| Fleet heatmap | client skeleton until the first `ui.fleet.snapshot` (no data = no event) | `FleetSnapshotDTO.cells = []` | WebSocket close 1008 / `ErrorBodyDTO` (`ERR_INVALID_TELEMETRY_PAYLOAD`, `ERR_BUFFER_OVERFLOW`); cells with `freshness = STALE_CACHED` | `FleetSnapshotDTO` (Op1 Q2c) | n/a |
| Alert banner | client spinner until the first evaluation | `AlertEvaluationDTO.status = CLEARED`, no active alert | `status = SUPPRESSED_COLD_START` (`explanation.observed_samples`) and `ERR_INVALID_ALERT_RULE_SPEC` | `status = TRIGGERED` + `AnomalyAlertPayloadDTO` | n/a |
| Forensic drawer | client skeleton while `GET /v1/nodes/{id}/forensics` is pending | `NodeForensicsDTO` with `log_tail = []`, `last_job = null` (C4-EMPTY) | `ERR_UNKNOWN_NODE_ID` 404, `ERR_NODE_HEALTHY` 409, `ERR_DATABASE_UNAVAILABLE` 503 | `NodeForensicsDTO` | n/a |
| Executive report | client spinner while the query runs | `ExecutiveReportDTO.is_empty = true` + `explanation.empty_state_reason` | `ERR_INVALID_DATE_RANGE`, `ERR_FUTURE_REPORT_QUERY`, `ERR_INVALID_ACADEMIC_SUBJECT`, `ERR_DATABASE_UNAVAILABLE` | `ExecutiveReportDTO` | n/a |

*Denied is not applicable:* the PRD mocks SSO (Liam and Management are session fixtures) and defines no role-gating requirement, so no contract exists to back a Denied state. Logged as an accepted scope boundary in `planning/readiness-gate-report.md`.

## Global Definition of Done

1. Every test in the story's **ATDD** line goes from RED to GREEN, and no test of another story changes colour.
2. `npm run ci` passes (typecheck, schema/architecture/harness suites, trace check; the red-guard may only report as red the tests of stories not yet merged).
3. `domain/` line coverage ≥ 90 % (branches ≥ 85 %) for the files the story touches; no new import of a driver, wall clock, randomness or network in `domain/` (architecture suite `A-R1..A-R5` stays green).
4. All errors are typed (`ErrorBodyDTO`), all rejections leave zero mutations, every decision cites a rule id and observed values.
5. No `SELECT` followed by `UPDATE/INSERT` for contended writes; the DDL in `001_observability_schema.sql` is changed only through a triaged finding.
6. A story with a UI surface renders all four states of the map above, and `axe-core` reports 0 violations on it (NFR-07).

## Required fields per item

`As / Traceability / Binding invariants / Depends on / Contract clauses / Files / Schema-DTO / ATDD / UI surface / Gherkin (happy + failure) / Definition of Done`.

---

## Epic 1: Liam sees the live fleet (walking skeleton)

**Protagonist:** Liam, Lead Cloud & Systems Engineer. **Value:** from a clean checkout he starts the console on a laptop with no GPU and no cloud, sees the 33 GPU cells of the 32-node fleet update live, and malformed frames are refused with a typed reason. **Slice:** seed fixtures + one end-to-end happy path through every layer + the simulated adapters.

### Story 1.1: Liam starts the console standalone with the 32-node fleet

- **As** Liam, **I want** the console to boot from a migrated SQLite database seeded with the Plan-2 fleet and simulated clock, telemetry and id adapters, **so that** I can develop and demo without GPUs or cloud access.
- **Traceability:** FR-01 (fleet of 32 nodes), NFR-08; UX-SC-01 precondition; risks R-07, R-11, R-16.
- **Binding invariants:** AD-07 (INV-07, standalone), AD-08 (INV-08, 31 × 24 GB + 1 × 2 × 48 GB).
- **Depends on:** none.
- **Contract clauses:** contracts.md section 3 (INV-07, INV-08); ports-and-adapters.md hard rules R1-R5.
- **Files:** `src/adapters/db/migrate.ts` (runs `001_observability_schema.sql`), `src/adapters/db/seed-fleet.ts`, `src/adapters/sim/fake-clock.ts`, `src/adapters/sim/simulated-telemetry-gen.ts`, `src/adapters/sim/sequential-id-generator.ts`, `src/composition.ts`.
- **Schema / DTO:** `cluster_nodes` (33 rows), `telemetry_buckets`; no DTO change.
- **ATDD:** physical and architecture tests that must stay green while the runner is built: `S-08a, S-08b, S-08c, S-08d, S-08e, S-01a, S-01b, S-01c, S-01d, S-01e, A-R1, A-R2, A-R3, A-R4, A-R5`.
- **UI surface:** none (headless start-up); prints `33 GPU series registered`.
- **Gherkin:**
  ```gherkin
  Scenario: Boot on an empty machine
    Given a clean checkout and no network connection
    When Liam runs the console start command
    Then the migration applies 001_observability_schema.sql
    And cluster_nodes holds 33 rows: 31 workstations of 24 GB and server-gpu-01 with gpu_index 0 and 1 of 48 GB
    And every node state is HEALTHY

  Scenario: A workstation row with a second GPU is refused by the database
    Given the seeded fleet
    When a row ("ws-gpu-01", gpu_index 1) is inserted
    Then SQLite rejects it with a CHECK violation and cluster_nodes still has 33 rows
  ```
- **Definition of Done:** global DoD; start command documented in `README.md`; a CI job on a GPU-less runner boots the console.

### Story 1.2: Liam watches one valid batch reach the heatmap (walking skeleton)

- **As** Liam, **I want** one valid telemetry batch to travel WebSocket → inbound port → decimator → ring buffer → SQLite → heatmap, **so that** I see all 33 cells update from the simulated fleet.
- **Traceability:** FR-01, NFR-02; UX-SC-01 (Success); risk R-01 (path), R-05 (path).
- **Binding invariants:** AD-01 (INV-01), AD-02 (INV-02), AD-08 (INV-08).
- **Depends on:** 1.1.
- **Contract clauses:** Op1 Q1, Q2, Q2c, Q3, Q4, Time.
- **Files:** `api/routes/telemetry-ws.ts`, `src/ports/in/telemetry-ingestion.port.ts`, `src/application/services/telemetry-ingestion.service.ts`, `src/domain/services/bucket-decimator.ts`, `src/domain/models/telemetry-ring-buffer.ts`, `src/adapters/db/sqlite-telemetry-repo.ts`, `src/ports/out/ui-dispatch.port.ts`, `ui/heatmap/FleetHeatmap.tsx`.
- **Schema / DTO:** `MetricBatchDTO`, `IngestionResultDTO`, `ExplanationDTO`, `FleetSnapshotDTO`; table `telemetry_buckets`.
- **ATDD:** `C1-Q1a, C1-Q1b, C1-Q2a, C1-Q3a, C1-Q4, C1-Q5a, C1-TIME, D-DEC-a, D-DEC-b`.
- **UI surface:** fleet heatmap — Loading skeleton, Success grid; all four states per the map.
- **Gherkin:**
  ```gherkin
  Scenario: A valid 1,250-event batch is accepted and shown
    Given the FakeClock at 2026-10-19T17:00:00Z and the seeded fleet
    When the generator sends a batch of 1,250 valid events
    Then the result has accepted_count 1250, dropped_count 0, decimation_bucket_id "BUCKET-1792429200000"
    And explanation cites "AD-01-DECIMATION-4HZ" with observed_rate 1250 and free_slots 10000
    And after 250 ms the next ingest closes the window and one telemetry.batch.ingested event exists
    And one FleetSnapshotDTO with 33 cells is dispatched

  Scenario: The 250 ms window is half-open
    Given an ingest at T0 + 249 ms and another at T0 + 250 ms for the same GPU
    When the windows close
    Then two buckets exist, T0 and T0 + 250, with one event each
  ```
- **Definition of Done:** global DoD; heatmap renders the grid within 250 ms of the snapshot in the E2E run (NFR-02).

### Story 1.3: Liam is told exactly why a frame was refused, and nothing is written

- **As** Liam, **I want** every malformed or future-dated frame rejected with a typed error and zero side effects, **so that** one bad exporter cannot corrupt the fleet view.
- **Traceability:** FR-01 (validation rules), NFR-01 (no corruption); UX heatmap Error state; risk R-10.
- **Binding invariants:** AD-01 (typed rejection before any mutation), AD-07 (clock-driven drift check).
- **Depends on:** 1.2.
- **Contract clauses:** Op1 P1, P2, Q-fail; error catalog `ERR_INVALID_TELEMETRY_PAYLOAD` (422/1008), `ERR_FUTURE_TIMESTAMP_DRIFT` (400), `ERR_DATABASE_UNAVAILABLE` (503).
- **Files:** `src/application/services/telemetry-ingestion.service.ts` (validation), `src/shared/errors.ts`, `api/routes/telemetry-ws.ts` (close 1008), `ui/heatmap/StreamErrorBanner.tsx`.
- **Schema / DTO:** `ErrorBodyDTO`, `ErrorCodeType`.
- **ATDD:** `C1-P1a, C1-P1b, C1-P1c, C1-P2a, C1-P2b, C1-Qfail`.
- **UI surface:** heatmap Error state: persistent banner and grey-washed cells on stream error.
- **Gherkin:**
  ```gherkin
  Scenario: One bad event rejects the whole batch
    Given a batch of 1,250 events whose last event has temperature 500 C
    When the batch is ingested
    Then it is rejected with ERR_INVALID_TELEMETRY_PAYLOAD, HTTP 422, retryable false
    And telemetry_buckets still has 0 rows and no audit event or metric was emitted

  Scenario: The 5,000 ms drift boundary
    Given client_timestamp_ms = now + 5001
    Then ERR_FUTURE_TIMESTAMP_DRIFT (400) is returned and nothing is written
    And with client_timestamp_ms = now + 5000 the batch is accepted
  ```
- **Definition of Done:** global DoD; every row of the invalid-input table in the ATDD suite has its error message template checked.

### Story 1.4: Liam sees both GPUs of the central server, never averaged

- **As** Liam, **I want** `server-gpu-01` to appear as two independent cells (48 GB each), **so that** a thermal problem on one GPU is not hidden by the other.
- **Traceability:** FR-01 (heterogeneous fleet); UX-SC-01 edge case; risk R-07.
- **Binding invariants:** AD-08 (INV-08).
- **Depends on:** 1.2.
- **Contract clauses:** Op1 Q2 (per-series statistics), Q2c (cells ordered by node then GPU), I1.
- **Files:** `src/domain/services/bucket-decimator.ts`, `src/domain/models/fleet.ts`, `src/adapters/db/sqlite-telemetry-repo.ts`, `ui/heatmap/FleetHeatmap.tsx` (two cells for the server).
- **Schema / DTO:** `FleetCellDTO`; `telemetry_buckets` primary key `(node_id, gpu_index, bucket_start_ms)`.
- **ATDD:** `C1-I1b, D-DEC-d`.
- **UI surface:** heatmap grid: 31 cells + a 2-cell server tile.
- **Gherkin:**
  ```gherkin
  Scenario: Two GPUs, two series
    Given server-gpu-01 reports gpu_index 0 at 40 C and gpu_index 1 at 80 C in the same window
    When the window closes
    Then telemetry_buckets has two rows, temperature_avg 40 and 80
    And the snapshot shows two server cells, not one cell of 60 C

  Scenario: A workstation cannot report a second GPU
    Given a frame for ws-gpu-05 with gpu_index 1
    Then the batch is rejected with ERR_INVALID_TELEMETRY_PAYLOAD
  ```
- **Definition of Done:** global DoD.

---

## Epic 2: Liam survives the 5,000 events-per-second storm (Mandatory Edge Case)

**Protagonist:** Liam. **Value:** when the metric generator floods the console, the interface stays responsive at 4 Hz, memory stays flat, and every drop is visible instead of silent. **Slice:** bounded buffer → throttling → sustained proof → idempotent retries.

### Story 2.1: Memory is flat and the UI is never dispatched more than 4 times a second

- **As** Liam, **I want** a statically allocated ring buffer and a 250 ms dispatch cap, **so that** a flood cannot starve the UI thread or grow the heap.
- **Traceability:** FR-05, NFR-05; UX-SC-05; risks R-01, R-05.
- **Binding invariants:** AD-01 (INV-01), AD-02 (INV-02).
- **Depends on:** 1.2.
- **Contract clauses:** Op1 I1 (33 × 6 × 7,200 × 4 = 5,702,400 B), I2 (≤ 4 dispatches/s).
- **Files:** `src/domain/models/telemetry-ring-buffer.ts`, `src/domain/services/bucket-decimator.ts`, `src/adapters/sim/ui-dispatch-recorder.ts`.
- **Schema / DTO:** none (memory structure).
- **ATDD:** `C1-I1a, D-RING-a, C1-I2`.
- **UI surface:** none new; the heatmap must not render more than 4 times per second.
- **Gherkin:**
  ```gherkin
  Scenario: 100,000 commits do not allocate
    Given a TelemetryRingBuffer for the 33 series
    When 100,000 ticks are committed
    Then byteLength is still 5,702,400 and the write pointer equals (start + 100000) mod 7200

  Scenario: 5,000 ev/s for 3 s gives at most 4 dispatches per second
    Given 50 events every 10 ms on the FakeClock for 3 s
    Then every second contains between 3 and 4 dispatches, each at least 250 ms apart
  ```
- **Definition of Done:** global DoD; nightly heap measurement over 900 s stays under 128 MB (nfr-evidence N-05).

### Story 2.2: Liam sees drops counted, and a 429 only when the queue is full

- **As** Liam, **I want** overflow to tail-drop the excess with a visible `dropped_count`, and a retryable 429 only when no slot is free, **so that** I know how much data the storm cost me.
- **Traceability:** FR-05 (outputs), NFR-01; UX-SC-05 Error state; risks R-01, R-10.
- **Binding invariants:** AD-01 (INV-01).
- **Depends on:** 2.1.
- **Contract clauses:** Op1 P3, Q1 (`accepted + dropped = events.length`), Q3 (`telemetry_events_dropped_total`), Q4 (`free_slots`); error `ERR_BUFFER_OVERFLOW` (429, `Retry-After: 1`).
- **Files:** `src/domain/services/bucket-decimator.ts` (occupancy), `src/application/services/telemetry-ingestion.service.ts`, `api/routes/telemetry-ws.ts` (429 + header), `ui/heatmap/StormIndicator.tsx`.
- **Schema / DTO:** `IngestionResultDTO.dropped_count`, `ErrorBodyDTO`.
- **ATDD:** `C1-P3a, C1-Q3b, D-DEC-c, C1-EDGE-b`.
- **UI surface:** stream health indicator shows `dropped_total`.
- **Gherkin:**
  ```gherkin
  Scenario: Partial acceptance
    Given 9,000 events are queued
    When a batch of 2,500 events arrives
    Then accepted_count is 1000 and dropped_count is 1500 (the last 1,500 events of the batch)
    And telemetry_events_dropped_total increases by 1500 and explanation shows free_slots 1000

  Scenario: Queue full
    Given 10,000 events are queued
    When another batch arrives
    Then ERR_BUFFER_OVERFLOW (429, retryable) is returned and nothing is written
    And after 250 ms a new 1,250-event batch is accepted in full
  ```
- **Definition of Done:** global DoD; HTTP/WS test asserts the `Retry-After: 1` header (TG-7).

### Story 2.3: Liam trusts the console through a 15-minute storm

- **As** Liam, **I want** a sustained 5,000 ev/s run to finish with 4 Hz dispatch, static memory, zero silent drops and a visible Storm Mode, **so that** I can rely on the console exactly when the cluster is in trouble.
- **Traceability:** FR-05 (Measurable Test Condition), NFR-01, NFR-02, NFR-05; UX-SC-05; risk R-01.
- **Binding invariants:** AD-01, AD-02 (INV-01, INV-02).
- **Depends on:** 2.1, 2.2.
- **Contract clauses:** Op1 Q2c (`storm_mode`), I1, I2; PRD FR-05 outputs.
- **Files:** `src/application/services/telemetry-ingestion.service.ts`, `src/adapters/sim/simulated-telemetry-gen.ts` (storm generator), `ui/heatmap/StormIndicator.tsx`, `bench/ingest-storm.ts`.
- **Schema / DTO:** `FleetSnapshotDTO.storm_mode` (counts arrived events, AMD-18b), `FleetSnapshotDTO.dropped_total`.
- **ATDD:** `C1-EDGE-a, C1-Q5b`.
- **UI surface:** header shows "Storm Mode Active: Downsampling 5,000 ev/s -> 4 Hz Buckets" while `storm_mode` is true.
- **Gherkin:**
  ```gherkin
  Scenario: 60 virtual seconds (pull request) and 900 (nightly)
    Given STORM_SECONDS=60 and 1,250 events every 250 ms
    When the storm runs for the whole period
    Then every batch is accepted in full, dropped_total is 0, no second has more than 4 dispatches
    And ring byteLength stays 5,702,400 and 33 x 240 bucket rows exist

  Scenario: Storm Mode turns off when the storm ends
    Given two 1,250-event windows within one second
    When the second window closes
    Then storm_mode is true; after 2 s of near silence the next snapshot has storm_mode false
  ```
- **Definition of Done:** global DoD; nightly job runs `STORM_SECONDS=900` and stores `test-results/ingest-storm.json` with p95 ≤ 15 ms per batch (nfr-evidence N-01).

### Story 2.4: A retry or a parallel sender never double-counts

- **As** Liam, **I want** replays of a `batch_id` and simultaneous batches handled safely, **so that** exporter retries during a storm do not skew the numbers.
- **Traceability:** FR-05, NFR-01; risk R-12 (TG-1).
- **Binding invariants:** AD-01 (serialised ingestion), AD-08 (series identity).
- **Depends on:** 1.2.
- **Contract clauses:** Op1 Concurrency / idempotency, Q2 (`INSERT OR IGNORE` of duplicate points).
- **Files:** `src/adapters/db/sqlite-telemetry-repo.ts` (`registerBatch`, `commitBuckets`, pruning of old batch ids), `src/application/services/telemetry-ingestion.service.ts`.
- **Schema / DTO:** `MetricBatchDTO.batch_id`; table `ingested_batches` with `idx_ingested_batches_time` (AMD-19: `INSERT OR IGNORE`, 1-hour replay window, indexed pruning).
- **ATDD:** `C1-CON-a, C1-CON-b, C1-Q2b, S-01f, S-01g`.
- **UI surface:** none.
- **Gherkin:**
  ```gherkin
  Scenario: Replay
    Given a batch with batch_id B was accepted
    When the same batch is sent again
    Then the second result has accepted_count 0 and dropped_count 0, and the bucket event_count stays 1

  Scenario: Two simultaneous senders
    Given two batches of 100 events for ws-gpu-05
    When both are ingested with Promise.all
    Then both report accepted_count 100 and the closed bucket has event_count 200
  ```
- **Definition of Done:** global DoD; a replay older than one hour is accepted as a new batch (documented behaviour, AMD-19).

---

## Epic 3: Liam is alerted before the lab class fails

**Protagonist:** Liam. **Value:** a real token surge raises one explained alarm, never a storm of duplicates; a node that goes silent is flagged at exactly 15 s and Liam can read what it was doing. **Slice:** formula → single alert → cold start and clearing → watchdog → forensics.

### Story 3.1: The anomaly engine tells a real surge from normal load

- **As** Liam, **I want** the engine to compare the last 30 s against the 270 s before it, and take the P99 from a 100-bucket histogram, **so that** only a ≥ 10× surge with P99 > 8,000 ms counts.
- **Traceability:** FR-02, NFR-03; UX-SC-02; risk R-02.
- **Binding invariants:** AD-03 (INV-03 formulas).
- **Depends on:** 1.2 (inference metrics enter through ingest).
- **Contract clauses:** Op2 P1, Q2 steps 1-2, I2, Time; Op1 Q2 (inference histogram); AMD-9, AMD-14.
- **Files:** `src/domain/services/anomaly-detector.ts`, `src/domain/services/histogram-p99.ts`, `src/application/services/sliding-window-assembler.ts`.
- **Schema / DTO:** `SlidingWindowDTO`, `AlertRuleDTO`, `EvaluableRuleIdType`.
- **ATDD:** `C2-PURE, C2-Q2a, C2-Q2b, C2-I2a, C2-I2b, C2-TIME, C1-Q2c, D-ENG-a, D-ENG-c, D-ENG-d, D-ENG-e, D-HIST-a, D-HIST-b, D-HIST-c`.
- **UI surface:** none (computation).
- **Gherkin:**
  ```gherkin
  Scenario: Boundaries are exact
    Given a baseline of 1,200 tok/s
    When the engine evaluates different current rates
    Then a current rate of 12,000 tok/s (ratio 10.0) with P99 9,600 ms is a breach
    And 11,988 tok/s (ratio 9.99) is not
    And ratio 11.2 with P99 exactly 8,000 ms is not, but 8,200 ms is

  Scenario: Zero baseline
    Given 100 samples and a baseline of 0 tokens/s
    When the window is evaluated
    Then the spike ratio is undefined and there is no breach and no error
  ```
- **Definition of Done:** global DoD; AMD-14 confirmed by both partners before the story starts (decision DEC-14).

### Story 3.2: One alarm per incident, with its explanation

- **As** Liam, **I want** a breach to create exactly one alert with the numbers that justified it, even under parallel evaluations and across an hour boundary, **so that** my banner never floods.
- **Traceability:** FR-02, NFR-03; UX-SC-02 Success; FR-05 (alerts bypass decimation); risks R-02, R-03.
- **Binding invariants:** AD-05 (INV-05), AD-03.
- **Depends on:** 3.1.
- **Contract clauses:** Op2 Q1, Q2 step 3, Q3, Q4, Q-fail, I1, Concurrency; P1 error `ERR_INVALID_ALERT_RULE_SPEC`.
- **Files:** `src/application/services/alert-evaluation.service.ts`, `src/adapters/db/sqlite-alert-repo.ts`, `src/ports/out/event-dispatcher.port.ts`, `api/routes/alerts-http.ts`, `ui/alerts/AlertBanner.tsx`, `ui/alerts/ExplainabilityDrawer.tsx`.
- **Schema / DTO:** `operational_alerts`, `idx_unique_active_alert`, `AlertEvaluationDTO`, `AnomalyAlertPayloadDTO`.
- **ATDD:** `C2-Q1a, C2-Q1b, C2-Q4a, C2-I1a, C2-I1c, C2-P1, C2-Qfail, C1-EDGE-c, S-05a, S-05b, S-05e`.
- **UI surface:** alert banner — Empty ("All systems nominal"), Success (spike factor, P99, SLA), Error.
- **Gherkin:**
  ```gherkin
  Scenario: A surge raises one explained alert
    Given a baseline of 1,200 tok/s and a current rate of 13,440 tok/s with P99 9,600 ms
    When the rule is evaluated
    Then status is TRIGGERED, spike_factor 11.2, one operational_alerts row with node_id CLUSTER
    And exactly one alert.anomaly.triggered event and alerts_emitted_total = 1

  Scenario: Two parallel evaluations and an hour boundary
    Given two simultaneous breaching evaluations, then another at 18:00:01
    Then there is exactly one active row and one triggered event
    And a window with a 99-bucket histogram is rejected with ERR_INVALID_ALERT_RULE_SPEC and changes nothing
  ```
- **Definition of Done:** global DoD; alarm dispatched ≤ 1.0 s after the window condition holds (nfr-evidence N-03).

### Story 3.3: No false alarm at boot, and the alarm clears after 15 s of calm

- **As** Liam, **I want** the engine silent until 50 samples exist and the alert cleared only after three calm 5-second cycles, **so that** a cold cluster or one quiet moment does not mislead me.
- **Traceability:** FR-02 (cold start, hysteresis); UX-SC-02 edge case and Error state; risk R-08, R-03.
- **Binding invariants:** AD-03 (INV-03), AD-05.
- **Depends on:** 3.2.
- **Contract clauses:** Op2 Q2 steps 1, 4, 5, I1 (recurrence), Time (1,000 ms loop vs 5,000 ms cycle); AMD-2, AMD-11, AMD-14b (clearing counts P99 <= 8,000 ms whatever the ratio), AMD-17.
- **Files:** `src/application/services/alert-evaluation.service.ts`, `src/adapters/db/sqlite-alert-repo.ts` (`countClearCycle`, `resetClearCounter`), `ui/alerts/AlertBanner.tsx` ("evaluation paused").
- **Schema / DTO:** `operational_alerts.consecutive_clear_cycles`, `last_cycle_index`; `status = SUPPRESSED_COLD_START`.
- **ATDD:** `C2-Q2c, C2-Q2d, C2-Q2e, D-ENG-b, C2-Q4b, C2-Q2f, C2-Q2g, C2-Q2h, C2-Q2i, D-ENG-f, C2-I1b, C2-I1d, S-05c, S-05d, S-05f, S-05g, S-05h`.
- **UI surface:** alert banner Error state: "evaluator degraded: insufficient sample buffer (< 50 events)".
- **Gherkin:**
  ```gherkin
  Scenario: 49 samples suppress, 50 evaluate
    Given a window with 49 samples that would breach
    When the rule is evaluated
    Then status is SUPPRESSED_COLD_START, no row is written, and explanation shows observed_samples 49 required_samples 50
    And with 50 samples the same window is TRIGGERED

  Scenario: Three calm cycles clear it, a breach restarts the count
    Given an active alert and calm evaluations at +5 s and +10 s (counter 2), then a breach at +11 s
    Then the counter is 0; after three more calm cycles status is CLEARED with resolved_at_ms = the third cycle
    And a restart of the process in between loses nothing

  Scenario: A long surge pollutes the baseline but does not clear the alert
    Given an active alert and evaluations whose spike ratio fell to 5.2 while P99 stays at 9,600 ms
    When five 5-second cycles pass
    Then status stays TRIGGERED, the clearing counter stays 0 and no alert.anomaly.resolved event exists
    And the first cycle with P99 under 8,000 ms starts the 3-cycle clearing
  ```
- **Definition of Done:** global DoD.

### Story 3.4: ws-gpu-22 goes silent and Liam sees it at exactly 15 s

- **As** Liam, **I want** the heatmap to flag a node STALE at 5 s and SILENT_TIMEOUT at 15 s, and recover only after 3 consecutive heartbeats, **so that** I triage before the lab class fails.
- **Traceability:** FR-03, FR-01 (STALE_CACHED), NFR-04; UX-SC-03; risk R-04.
- **Binding invariants:** AD-04 (INV-04).
- **Depends on:** 1.2.
- **Contract clauses:** Op1 Q2b (every accepted or capacity-dropped event is a heartbeat; a rejected batch is not, AMD-17b), Q2c (freshness); Op4 Time (state boundaries); AD-04 state machine; AMD-17 (`MonitoringPort.tick()` every 1,000 ms).
- **Files:** `src/domain/services/heartbeat-watchdog.ts`, `src/application/services/node-monitor.service.ts`, `src/ports/in/monitoring.port.ts`, `src/adapters/sim/scheduler.ts`, `ui/heatmap/FleetHeatmap.tsx` (amber/silent cells with text labels).
- **Schema / DTO:** `node_heartbeats`, `chk_watchdog_hysteresis`; `FleetCellDTO.state`, `freshness`.
- **ATDD:** `W-1, W-2, W-3, W-4, D-WD-a, D-WD-b, S-04a, S-04b, C1-Q5c, C1-Q2d, C1-Q2e`.
- **UI surface:** heatmap cell states with icon + label (`⏱ Silent`), never colour alone.
- **Gherkin:**
  ```gherkin
  Scenario: Exact thresholds
    Given ws-gpu-22 last reported at T
    When the monitor ticks at each offset
    Then at T + 4,999 ms it is HEALTHY, at T + 5,000 STALE, at T + 14,999 STALE, at T + 15,000 SILENT_TIMEOUT
    And the transition is reported exactly once, and the other 31 nodes stay HEALTHY

  Scenario: Flapping never reports HEALTHY
    Given a silent node that sends a heartbeat every other 5 s slot
    When 60 s elapse
    Then it is never HEALTHY and never re-enters SILENT_TIMEOUT
    And three consecutive heartbeats at 5 s spacing return it to HEALTHY
  ```
- **Definition of Done:** global DoD; boundary measured with the real scheduler at 15.0 s ± 0.5 s (nfr-evidence N-04).

### Story 3.5: Liam opens the evidence of the silent node

- **As** Liam, **I want** the forensic drawer to show the frozen last snapshot, the degradation timeline, the last 50 log lines and the job that was running, **so that** I can decide to cordon the node.
- **Traceability:** FR-03 (outputs); UX-SC-03 (Loading/Empty/Error/Success); risk R-13, TG-4.
- **Binding invariants:** AD-04 (INV-04), AD-02.
- **Depends on:** 3.4.
- **Contract clauses:** Op4 capture clause, P1, P2, Q1-Q4, Q-fail, I1, I2, Concurrency.
- **Files:** `src/application/services/forensics.service.ts`, `src/application/services/node-monitor.service.ts` (capture), `src/adapters/db/sqlite-forensics-repo.ts`, `src/adapters/sim/sim-node-log.ts`, `src/adapters/sim/sim-job-registry.ts`, `api/routes/nodes-http.ts` (`GET /v1/nodes/{node_id}/forensics`), `ui/forensics/ForensicDrawer.tsx`.
- **Schema / DTO:** `node_forensics` (`CHECK json_array_length(log_tail_json) <= 50`), `NodeForensicsDTO`, `ForensicJobDTO`, `DegradationPointDTO`; errors `ERR_UNKNOWN_NODE_ID`, `ERR_NODE_HEALTHY`.
- **ATDD:** `C4-Q1a, C4-Q1b, C4-Q2, C4-Q3, C4-Q4, C4-P1, C4-P2, C4-Qfail, C4-I1, C4-I2, C4-CON, C4-REC, C4-EMPTY, S-04c, S-04d`.
- **UI surface:** forensic drawer — Loading skeleton (< 300 ms), Empty ("no error logs"), Error toast, Success; recommendation badge "Cordon Recommended".
- **Gherkin:**
  ```gherkin
  Scenario: 18 s after the last heartbeat
    Given ws-gpu-22 degraded from 60 to 82.1 C, emitted 80 log lines, then went silent, and 30 more lines appeared after the capture
    When Liam opens the drawer
    Then state is SILENT_TIMEOUT, silence_duration_ms 18000, recommendation CORDON_RECOMMENDED
    And log_tail is lines 31 to 80 only, last_job is job-cs480-lora-run-84 of student-mateo
    And a node.forensics.viewed event is emitted

  Scenario: A healthy or unknown node
    Given ws-gpu-05 is HEALTHY
    Then the request returns ERR_NODE_HEALTHY (409); "ws-gpu-32" returns ERR_UNKNOWN_NODE_ID (404); neither emits an event
  ```
- **Definition of Done:** global DoD; the record is deleted when the node is HEALTHY again (C4-REC).

---

## Epic 4: Department Management receives audited numbers

**Protagonist:** Dr. Rebecca Reed (Lab Director) and Dean Morales (Academic Dean). **Value:** a 7-day report whose hours add up, with subjects, idle capacity, peak contention and an honest empty state; and proof that all of it runs offline.

### Story 4.1: Management reads the 7-day utilization report

- **As** Dr. Reed, **I want** total, utilized, idle and unavailable GPU-hours, tokens by subject, and the saturated hours for the last 168 h, **so that** I can justify the compute budget.
- **Traceability:** FR-04, NFR-06; UX-SC-04 Success; risks R-06, R-09.
- **Binding invariants:** AD-06 (INV-06).
- **Depends on:** 1.1 (database and fixture loader).
- **Contract clauses:** Op3 Q1, Q1b, Q2, Q3, Q4, I1, I2, Concurrency, Time; AMD-8, AMD-15.
- **Files:** `src/application/services/reporting.service.ts`, `src/adapters/db/sqlite-rollup-repo.ts`, `src/adapters/sim/rollup-fixture-loader.ts`, `api/routes/reports-http.ts`, `ui/reports/ExecutiveSummary.tsx`.
- **Schema / DTO:** `rollup_hourly_metrics` (`chk_hourly_gpu_sum`), `ExecutiveReportDTO`, `PeakContentionWindowDTO`, `SubjectBreakdownDTO`, `NodeRollupDTO`.
- **ATDD:** `C3-Q1a, C3-Q1b, C3-Q1c, C3-Q2, C3-Q3, C3-Q4a, C3-I1, C3-I2a, C3-CON, S-06a, S-06b, S-06c, S-06d`.
- **UI surface:** executive report — Loading ("Aggregating 5,544 GPU-hours..."), Success cards and peak chart.
- **Gherkin:**
  ```gherkin
  Scenario: The 7-day fixture
    Given 168 hours x 33 GPUs at 50 % busy and ws-gpu-22 silent for the last 3 hours
    When Management requests [now-168h, now) for ALL subjects
    Then total 5544, utilized 2770.5, idle 2770.5, unavailable 3, utilization_pct = 2770.5/5544
    And only rollup_hourly_metrics was read and no write statement ran
    And hours with utilization >= 99.9 % are listed ascending as peak_contention_windows

  Scenario: Five simultaneous requests
    Given five parallel identical requests
    Then the five reports are identical except report_id
  ```
- **Definition of Done:** global DoD; p95 ≤ 1,500 ms with 5 concurrent requests on the 5,544-row fixture (nfr-evidence N-06).

### Story 4.2: Management gets an honest empty state and clear refusals

- **As** Dean Morales, **I want** an empty window explained and invalid queries refused with a reason, **so that** I never read a blank screen as "zero use".
- **Traceability:** FR-04; UX-SC-04 Empty and Error states; risk R-10.
- **Binding invariants:** AD-06.
- **Depends on:** 4.1.
- **Contract clauses:** Op3 P1, P2, P3, Q1 (`is_empty`), Q4 (`empty_state_reason`), Q-fail; errors `ERR_INVALID_DATE_RANGE`, `ERR_FUTURE_REPORT_QUERY`, `ERR_INVALID_ACADEMIC_SUBJECT`, `ERR_DATABASE_UNAVAILABLE`; AMD-13.
- **Files:** `src/application/services/reporting.service.ts`, `api/routes/reports-http.ts`, `ui/reports/EmptyReport.tsx`, `ui/reports/ReportError.tsx`.
- **Schema / DTO:** `ErrorBodyDTO`, `ExecutiveReportDTO.is_empty`, `ExplanationDTO.empty_state_reason`.
- **ATDD:** `C3-EMPTY-a, C3-EMPTY-b, C3-P1a, C3-P1b, C3-P2, C3-P3, C3-Q4b, C3-Qfail`.
- **UI surface:** report Empty canvas and Error callout.
- **Gherkin:**
  ```gherkin
  Scenario: Nothing ran
    Given rollup rows exist but busy hours and tokens are all 0
    When Management requests the report
    Then is_empty is true, reason NO_WORKLOADS_FOUND_IN_WINDOW, and 5,544 GPU-hours are still scanned

  Scenario: Invalid queries are refused before any SQL runs
    Given from = to, or a 168 h + 1 ms window, or to = now + 1 ms, or subject "cs-480"
    When the query is submitted
    Then the matching typed error (400 / 400 / 422 / 400) is returned and zero statements are executed
  ```
- **Definition of Done:** global DoD.

### Story 4.3: Everything runs offline, and the accessibility audit passes

- **As** Dr. Reed, **I want** proof that a full ingest → alert → report flow needs no GPU and no network and that every surface meets WCAG 2.1 AA, **so that** the department can run it in any lab.
- **Traceability:** NFR-08, NFR-07; all UX surfaces; risk R-14, R-16.
- **Binding invariants:** AD-07 (INV-07).
- **Depends on:** 3.2, 4.1 (needs ingest, alert and report).
- **Contract clauses:** contracts.md INV-07; ports-and-adapters.md hard rules R1-R5.
- **Files:** `test/e2e/accessibility.spec.ts` (axe-core on 5 screens), `.github/workflows/quality-gate.yml`, `README.md`.
- **Schema / DTO:** none.
- **ATDD:** `X-AD07`.
- **UI surface:** all surfaces audited: heatmap, drawer, banner, report, empty state.
- **Gherkin:**
  ```gherkin
  Scenario: Offline end to end
    Given fetch is replaced by a spy and the host has no GPU
    When a batch is ingested, a breach evaluated and a 7-day report built
    Then results are 10 accepted, TRIGGERED, a non-empty report, and the spy was called 0 times

  Scenario: A contrast regression is caught
    Given a surface with 4.4:1 text contrast
    Then the axe-core run fails the quality gate
  ```
- **Definition of Done:** global DoD; `nfr-evidence.md` rows N-07 and N-08 move to EVIDENCED with artifacts.
