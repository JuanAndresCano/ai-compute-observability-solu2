# Test Design — Module 11: AI Infrastructure Observability Console

**Phase:** 3 (Test Preparation, TEA) · **Mode:** system-level · **Author:** Partner B (Test Lead) · **Date:** 2026-10-26
**Inputs:** `planning/prd.md`, `planning/ARCHITECTURE.md` (AD-01..AD-08), `planning/detailed-design/contracts.md` v1.1 (+ AMD-14, pending confirmation), `schemas/*`, `ux/` scenarios 1–4
**Method:** probability (1–3) × impact (1–3) = score; **P0** = score ≥ 6 *or* the module's Mandatory Edge Case; P1 = 4; P2 = 2–3; P3 = 1.
**Status:** Draft for Partner A review. The red suite described here exists in `test/atdd/observability_contracts.test.ts`.

---

## 1. Risk register (16 risks)

| ID | Cat | Risk | P | I | Score | Pri | Mitigating contract / AD | Red test(s) that turn green only when mitigated |
|:---:|:---:|---|:-:|:-:|:-:|:-:|---|---|
| **R-01** | PERF | **Telemetry storm (Mandatory Edge Case, FR-05):** 5,000 ev/s overwhelms the worker: unbounded queue, UI starvation, silent drops | 3 | 3 | **9** | **P0** | AD-01, INV-01, AMD-1 (tail-drop, visible `dropped_count`, 429 only at 0 free slots) | `C1-EDGE-a/b/c`, `C1-I2`, `C1-P3a`, `C1-Q3b`, `D-DEC-a..d` |
| **R-02** | BUS | **The anomaly alarm can never fire:** with nested windows the ratio is bounded by 10.0 (found by this review, AMD-14) → false negatives on the exact scenario the console exists for | 3 | 3 | **9** | **P0** | AD-03, AMD-14 | `C2-Q1a`, `C2-Q2a` (5 boundaries), `C2-PURE`, `D-ENG-a`, `D-ENG-d` |
| **R-03** | DATA | **Alert storm / duplicate active alerts** (flapping, parallel evaluation, hour-boundary incident) | 2 | 3 | **6** | **P0** | AD-05, INV-05, AMD-3, AMD-11 | `C2-I1a..d`, `C2-Q2f/g/h`, schema `S-05a..h` |
| **R-04** | BUS | **Silent node undetected or mis-timed** (Scenario 3, ws-gpu-22 must change state at exactly 15.0 s) | 2 | 3 | **6** | **P0** | AD-04, INV-04, NFR-04 | `W-1..4`, `D-WD-a/b`, schema `S-04a` |
| **R-05** | PERF | **Ring buffer reallocates or grows** (GC thrash; 33 series × 6 × 7,200 × 4 B = 5,702,400 B) | 2 | 3 | **6** | **P0** | AD-02, INV-02, AMD-4 | `C1-I1a`, `D-RING-a`, `C1-EDGE-a` |
| **R-06** | BUS | **Executive report wrong:** outage counted as idle, double count, wrong per-subject split | 2 | 3 | **6** | **P0** | AD-06, INV-06, AMD-8 | `C3-Q1a/b`, `C3-I2a`, `C3-EMPTY-a/b`, schema `S-06a..d` |
| **R-07** | DATA | **Dual-GPU server averaged or overwritten** (server-gpu-01 has 2 × 48 GB) | 2 | 2 | 4 | P1 | AD-08, INV-08 | `C1-I1b`, `D-DEC-d`, schema `S-08a..e`, `S-01c` |
| **R-08** | BUS | **Cold-start false positive** on cluster boot | 2 | 2 | 4 | P1 | AD-03, INV-03, AMD-2 | `C2-Q2c/d/e`, `D-ENG-b` |
| **R-09** | PERF | **Report scans raw telemetry** instead of hourly rollups (breaks ≤ 1.5 s) | 2 | 2 | 4 | P1 | AD-06, INV-06 | `C3-I1`, `C3-Q2` |
| **R-10** | DATA | **Invalid input partially written / untyped error** | 2 | 2 | 4 | P1 | Typed Error Catalog (8 codes), Q-fail clauses | `C1-P1a..c`, `C1-P2a/b`, `C2-P1`, `C3-P1a..P3` |
| **R-11** | TECH | **Hidden wall-clock / randomness in `domain/`** makes tests flaky and AD-07 untestable | 2 | 2 | 4 | P1 | AD-07, INV-07, hexagon rules R1–R5 | `test/architecture/purity.test.ts` (37), `X-AD07` |
| **R-12** | DATA | **Replay of a `batch_id` double-counts** (idempotency store undefined, TG-1) | 2 | 2 | 4 | P1 | Op1 Concurrency clause | `C1-CON-a`, `C1-CON-b` |
| **R-13** | BUS | **Forensic drill-down (FR-03) has no contract** (stderr tail, degradation timeline), TG-4 | 2 | 2 | 4 | P1 | none yet → needs a story + contract | *no test possible today* (see §4) |
| **R-14** | BUS | **WCAG 2.1 AA not met** (NFR-07) | 2 | 2 | 4 | P1 | NFR-07 | UI/E2E axe-core run, planned (nfr-evidence N-07); outside the backend red suite |
| **R-15** | DATA | **Storage failure leaves partial state** | 1 | 3 | 3 | P2 | ERR_DATABASE_UNAVAILABLE on all 3 ops | `C1-Qfail`, `C2-Qfail`, `C3-Qfail` |
| **R-16** | OPS | **Cloud / network dependency creeps in** (NFR-08) | 1 | 2 | 2 | P2 | AD-07, INV-07 | `X-AD07`, purity R1–R3 |

**Gate rule (Phase 3):** no P0 risk without a red test. Result: R-01…R-06 have between 4 and 14 red tests each; see `traceability-matrix.md`.
**Why R-02 is P0 and was not in the Plan-2 risk list:** it is a defect in the specification itself. With the short window contained in the long window, `Throughput(short) / Throughput(long) = 10·S/L ≤ 10`, so the rule fires only if *every* token of the last 300 s fell in the last 30 s. This was caught while building the test data for `C2-Q1a` (a 11.2× surge could not be expressed), not by a review.

## 2. Test-level allocation

Each behaviour is verified at the **lowest** level that can falsify it.

| Level | What is verified there | Planned share of the final suite | Today |
|---|---|:-:|---|
| **Unit — pure domain** | decimation statistics and window boundaries, P99 histogram, spike/breach formulas, cold-start guard, ring-buffer pointer, heartbeat state machine; property tests (fast-check) | **55 %** | 28 ATDD cases (`D-*`, `W-*`, `C1-I1a`, `C1-I2`, `C2-PURE`, `C2-I2a/b`) |
| **Contract / integration — use case + SQLite** | atomicity and uniqueness, persistence, rollback, idempotent replay, parallel calls, typed errors with zero side effects, audit events and counters | 30 % | 105 ATDD cases + 31 schema constraint tests |
| **API — HTTP/WS adapters** | status codes, `Retry-After` header, WebSocket close 1008, OpenAPI conformance | 10 % | 0 — driving adapters are not stubbed in this unit; planned in Epic 1 stories |
| **E2E — UI scenarios** | heatmap at 4 Hz, banner, drawer, WCAG | 5 % | 0 — UI not in the solutioning scope |
| **Static fitness** | hexagon rules R1–R5, no wall clock, no SELECT-then-UPDATE | n/a | 36 (`test/architecture`) |

**Honest note on the numbers.** The red ATDD suite is *acceptance-level through the inbound ports*, so by count it is dominated by the use-case level (105 of 133). The "55 % pure domain" target applies to the final suite: every story's Definition of Done requires the domain unit tests for its clauses (TDD), and the properties already present are the seed. This is recorded as a gap, not hidden (TG-12).

## 3. Coverage thresholds

| Threshold | Value | How it is checked |
|---|---|---|
| P0 contracts with ≥ 1 red test | **100 %** (6 of 6 P0 risks; 3 of 3 operations; 8 of 8 INV) | `npm run trace:check` |
| Contract clauses (P, Q, I, Q-fail) with ≥ 1 test | 100 % of the clause list in `traceability-matrix.md` | `npm run trace:check` |
| Line coverage of `domain/` | **≥ 90 %** (branch ≥ 85 %) once implemented | `vitest --coverage`, enforced in `quality-gate.yml` after the first story merges |
| ATDD cases red for the right reason | 100 % (`NotImplementedError`) until implementation; then 100 % green | `npm run test:atdd:guard` |
| Physical constraints killed by mutation | 100 % (11 of 11 DDL mutants killed) | mutation script recorded in `reviews/review-test-quality.md` |
| Flaky tests allowed | 0 (no real clock, no sleep, seeded PRNG) | fixtures + purity tests |

## 4. Testability gaps found (feed back to Phase 0)

| ID | Gap | Impact | Proposed owner / resolution |
|:---:|---|---|---|
| **TG-1** | `batch_id` idempotency has no storage (no table, no port). I added `TelemetryRepositoryPort.registerBatch` as a stub. In-memory (lost on restart) or a table? | R-12: replay after restart double-counts | Partner A: add `ingested_batches` table or declare in-memory + TTL |
| **TG-2** | `rollup_hourly_metrics.hour_epoch` is "Unix timestamp" (seconds) but every contract time is milliseconds | off-by-1000 in `buildUtilizationReport` | Partner A: rename `hour_epoch_s` or switch to ms. Fixture uses seconds per the DDL comment |
| **TG-3** | `NodeRollupDTO.average_temperature_celsius / average_gpu_utilization_pct` and `SubjectBreakdownDTO.allocated_gpu_hours / share_pct` cannot be computed from `rollup_hourly_metrics` (no such columns) or are undefined | those fields are untestable; ATDD does not assert them | Partner A: add columns or drop the fields |
| **TG-4** | FR-03 forensic drill-down (last 50 stderr lines, degradation timeline) has no contract, DTO, endpoint or table | R-13: scenario 3's second half is unverifiable | New contract + story (Epic 3) |
| **TG-5** | Two sources of node state: `cluster_nodes.current_state` and `node_heartbeats.state`; `node_heartbeats` has no FK | ambiguous authority | Partner A: single source + FK |
| **TG-6** | No port for the 4 Hz UI dispatch nor for counters | INV-01/I2 and Q3 unobservable | **Done:** `UiDispatchPort`, `MetricsPort` added as stubs and to `ports-and-adapters.md` |
| **TG-7** | `Retry-After: 1` and WS close 1008 exist only in the HTTP/WS adapter | not assertable at the port | API-level tests in Epic 1 |
| **TG-8** | `NodeHeartbeatWatchdog.check()` output when several states are crossed in one call is unspecified; "consecutive heartbeats" with a gap is only implied | W-2/W-4 assert only what AD-04 states | Partner A: one sentence in AD-04 |
| **TG-9** | Nobody is the scheduler: who calls `evaluateAlertRule` every 5 s and `watchdog.check()`? | the 5 s cycle (AMD-11) has no owner | Story in Epic 2 |
| **TG-10** | **AMD-14** (baseline excludes the short window) is applied but **pending confirmation** by both partners | R-02 | Both partners |
| **TG-11** | P95 budgets (15 ms, 5 ms, 1.5 s) cannot be measured with `FakeClock` | NFR evidence needs a real-clock bench harness | `nfr-evidence.md` N-01/N-03/N-06 (PLANNED, `bench/`) |
| **TG-12** | Pure-domain tests are 21 % of the red suite by count (target 55 % of the final suite) | pyramid inverted until stories add unit tests | Stories' DoD |

## 5. Entry / exit criteria

**Entry (met):** contracts v1.1 + schemas executable; 5 fixtures with self-tests; ATDD red for the right reason; gaps TG-1..12 logged.
**Exit for Phase 3:** `npm run ci` green (typecheck, 100 harness tests, trace check, red-guard 133/133); traceability has no orphan AD-n; Partner A confirms AMD-14.

## 6. Execution strategy (CI)

| Trigger | Runs |
|---|---|
| Every push / PR | typecheck, harness + schema + architecture suites (≈2 s), red-guard (ATDD, 60 s storm) |
| Nightly | red-guard with `STORM_SECONDS=900` (NFR-01: 15-minute storm) |
| After the first story merges | red-guard becomes "ATDD green for merged stories, red for the rest" + coverage gate |

## 7. Evidence that the plan is executable

* `npm test` → 100 passed (32 fixture self-tests, 31 schema, 37 architecture); fixtures at 99.4 % line coverage.
* `npm run test:atdd:guard` → 133 cases, 133 red for the right reason, 0 not red.
* Guard self-test: an injected passing case, an injected skipped case and an injected wrong-reason case make the guard exit 1.
* Mutation check of the DDL: 11 of 11 constraint mutants are killed by the schema suite.
