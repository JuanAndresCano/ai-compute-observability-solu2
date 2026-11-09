# Traceability Matrix (Impl-2 audit) — Module 11 AI Infrastructure Observability Console

**Overall verdict (2026-11-09): PASS for every in-scope requirement (20 PASS, 0 FAIL, 0 PENDING). 6 PRD requirements are DEFERRED with reasons and cost to close; one PASS row carries a caveat (G-12: 11.5 correlator not wired). Hosted CI: run 42649607325, 3 / 3 jobs green.**

**Chain audited:** PRD Requirement → User Story → Automated Test Files → CI Evidence → Verdict
**Scope:** Stories 11.1 – 11.6 · **Branch:** `feature/impl2-e2e-playwright` · **Audit date:** 2026-11-09
**Not to be confused with** `test/traceability-matrix.md`, the Impl-1 *test-ID level* matrix (FR/NFR → AD-n → contract clause → test ID) that `npm run trace:check` validates. This file is the *story-level audit view* on top of it; test IDs below (e.g. `C1-P1a`) are the ones tagged in the code and listed in that matrix.

## 1. Verdict legend

| Verdict | Meaning |
|---|---|
| **PASS** | At least one existing automated test covers the requirement and it passed in the audited run (section 2). |
| **DEFERRED** | A PRD requirement that the Impl-2 Annex does not require for Stories 11.4–11.6 and that has no automated test. It stays mapped to its story, with the reason and the cost to close it. It is **not** counted as PASS. (Decision of 2026-11-09; reversible: any row can be moved back to work.) |
| **PENDING** | Required and not yet evidenced. Currently **none**. |

## 2. CI evidence (real runs, 2026-11-09, Node/Linux, after `npm ci`)

No hosted CI exists in this repo (`.github/` is absent; `test/ci/quality-gate.yml` is a template to copy there). The "CI Evidence" for 11.1–11.3 is therefore the local run of the same commands the gate uses.

| ID | Command | Result |
|---|---|---|
| CI-1 | `npm run test:all` (harness config, then ATDD config) | **282 / 282 passed**: harness 4 files / 125 tests (`fixtures` 36, `schema.contract` 35, `scaffold` 8, `purity` 46); ATDD 1 file / 157 tests. 0 failed, 0 skipped. |
| CI-2 | `npm run trace:check` | OK: 46 matrix rows, 136 test IDs traced, 136 tags in code, 2 documented GAP rows, 8 bound invariant tests |
| CI-3 | `npm run typecheck` | OK (`tsc --noEmit`, no errors) |
| CI-4 | `npm run readiness:check` | `READINESS CHECK: no structural problem found` |
| CI-7 | `npm run ci:full` on `main` after merging both branches and adding the coverage/CI work | **356 / 356 Vitest tests passed**: harness config 8 files / 198 tests (adds `test/integration/`, which was silently never run, plus `domain-branches` 40 and `service-branches` 10) + ATDD 2 files / 158 tests; Playwright 3 / 3; `typecheck`, `trace:check`, `readiness:check` OK. |
| CI-8 | `npm run test:coverage` (`test/vitest.coverage.config.ts`, all Vitest suites, `src/domain` + `src/application`) | **Branches 90.47 %** (399 / 441; statements 98.37 %, functions 98.36 %). Threshold `branches: 90` fails the run (verified: exit 1 with a 99 % threshold). Impl-1 had measured 83.87 %. |
| CI-9 | `npm run test:e2e` after adding axe | **5 / 5 passed** (3 triage + 2 accessibility), ~10 s; `ci:full` 363 Vitest + 5 Playwright OK. Zero `waitForTimeout` in `tests/` and the config (the only `sleep()` in the repo is k6's pacing call in `tests/nfr/`, which is not a browser test). |
| CI-5 | `npm run test:e2e` (Playwright 1.64.0, Chromium, `retries=0` locally) | **3 / 3 passed** (`heatmap-triage.spec.ts`), 0 failed, 0 flaky. A run with `--trace=on` produced one `trace.zip` per test under `test-results/`; the config uses `trace: 'on-first-retry'` for CI (`retries: 1`). |
| CI-6 | `npm run ci` after adding Story 11.6 (typecheck, `test:all`, `trace:check`, `readiness:check`) | typecheck OK; harness 5 files / 145 tests (adds `cordon.test.ts` 16, and `purity` now scans the 4 new `src/` files) + ATDD 157 = **302 / 302 passed**; `trace:check` and `readiness:check` OK. k6 / WebSocket (11.4, 11.5): not run, partner branch. |

Test-file paths (all verified to exist): `test/atdd/observability_contracts.test.ts` (ATDD, 157), `test/schema/schema.contract.test.ts` (35), `test/architecture/purity.test.ts` (46), `test/harness/scaffold.test.ts` (8), `test/harness/fixtures.test.ts` (36).

## 3. Story map (repo story numbers ↔ `planning/epics.md`)

`planning/epics.md` numbers stories 1.1–4.3 (planning IDs). The Impl-1 deliverable (`README.md` §4, `walkthrough-impl1.md`) regroups them into Module-11 stories 11.1–11.3. Mapping used here (derived from the `Stories` column of `epics.md` and the README story descriptions):

| Story | Title | Planning stories (epics.md) | Owner / status |
|---|---|---|---|
| 11.1 | Multi-Node Telemetry Ingestion & Real-Time Aggregation | 1.1, 1.3, 2.1, 2.2, 2.3, 2.4 | Impl-1, done |
| 11.2 | Fleet Thermal & Utilization Heatmap Matrix | 1.2, 1.4, 3.4 (STALE_CACHED cells) | Impl-1, done |
| 11.3 | Token Throughput Spike & Latency Alarm | 3.1, 3.2, 3.3 | Impl-1, done |
| 11.4 | WebSocket telemetry stream | none in epics.md (see gaps) | Partner, other branch, not in this repo |
| 11.5 | k6 load / storm test | none in epics.md (see gaps) | Partner, other branch, not in this repo |
| 11.6 | Flow E: Playwright E2E (heatmap → drill-down `ws-gpu-22` → Cordon) | none in epics.md (UI never planned as a story; see gaps) | This branch, in progress |

## 4. Main matrix

| Req ID | PRD requirement (short) | Story | Automated test files and test IDs | CI evidence | Verdict |
|---|---|:-:|---|---|:-:|
| FR-01a | Telemetry payload validation: temp -20..120 °C, VRAM used ≤ total, util bounds, min ≤ max, clock drift ≤ 5 s | 11.1 | `test/atdd/observability_contracts.test.ts`: C1-P1a/b/c, `test/harness/ingestion-batch-id.test.ts` (batch_id UUID shape; events length 1..5,000 incl. 5,002 / 10,000 rejected), C1-P2a/b, C1-Qfail; `test/schema/schema.contract.test.ts`: S-01d, S-01e | CI-1 | PASS |
| FR-01b | Ingest produces bucketed window stats, idempotent persistence, audit event, explainability | 11.1 | `observability_contracts.test.ts`: C1-Q1a/b, C1-Q2a/b/c, C1-Q3a, C1-Q4, C1-TIME, D-DEC-a/b; `schema.contract.test.ts`: S-01a/b/f/g; `test/harness/scaffold.test.ts` (HTTP ingest/cluster-summary scenario) | CI-1, CI-2 | PASS |
| FR-05 | Storm throttling and decimation: ≤ 4 dispatches/s, 250 ms buckets `{min,max,avg,count}`, tail-drop / 429 on full queue, alerts bypass | 11.1 | `observability_contracts.test.ts`: C1-EDGE-a/b/c, C1-I2, C1-P3a, C1-Q3b, D-DEC-c | CI-1 | PASS |
| NFR-01 | ≥ 5,000 ev/s sustained ≥ 15 min, no crash/overflow, retry/parallel sender never double-counts | 11.1 | `observability_contracts.test.ts`: C1-EDGE-a (storm), C1-CON-a, C1-CON-b | CI-1 (storm ran at the default `STORM_SECONDS=60`; the 900 s nightly run was **not** executed, see gap G-3) | PASS (60 s) |
| NFR-05 | Memory bound: static 5,702,400 B ring buffer, flat after 100k events | 11.1 | `observability_contracts.test.ts`: C1-I1a, D-RING-a (INV-02) | CI-1 | PASS (server-side proxy only, see G-4) |
| NFR-08 | Standalone: zero network I/O, pure domain, no GPU/cloud | 11.1 | `observability_contracts.test.ts`: X-AD07; `test/architecture/purity.test.ts`: A-R1..A-R5 (46 tests); `test/harness/fixtures.test.ts` | CI-1, CI-3 | PASS |
| FR-01c | 33-cell fleet heatmap data (32 nodes / 33 GPUs), Storm Mode flag, STALE_CACHED cells (`FleetSnapshotDTO`) | 11.2 | `observability_contracts.test.ts`: C1-Q5a/b/c, C1-Q2d, C1-Q2e, W-1..W-4; `scaffold.test.ts` (heatmap endpoint, 32 items) | CI-1, CI-2 | PASS |
| FR-01d | Dual-GPU `server-gpu-01` tracked independently, never averaged (INV-08) | 11.2 | `observability_contracts.test.ts`: C1-I1b, D-DEC-d; `schema.contract.test.ts`: S-08a..S-08e, S-01c | CI-1 | PASS |
| NFR-02 | Render latency ≤ 250 ms nominal / ≤ 500 ms storm (metric timestamp → heatmap paint) | 11.2 | Impl-1: *none* (documented GAP, N-02). Planned: Playwright `performance.mark` check in `tests/e2e/` (see 11.6-c) | none | DEFERRED: Impl-1 documented GAP; not required by the Annex. Cost to close: `performance.mark` assertion in the E2E spec |
| FR-02a | Spike detection: ≥ 10.0x baseline AND P99 > 8,000 ms (strict boundaries), 30 s vs 300 s windows, cold start < 50 samples suppressed | 11.3 | `observability_contracts.test.ts`: C2-P1, C2-Q1a/b, C2-Q2a/b/c/d/e, C2-PURE, C2-I2a/b, C2-TIME, D-ENG-a..e, D-HIST-a/b/c (INV-03) | CI-1 | PASS |
| FR-02b | One alert per incident, atomic insert, 3-cycle hysteresis clear, recurrence gets a new incident key, explainability, storage failure | 11.3 | `observability_contracts.test.ts`: C2-I1a/b/c/d, C2-Q2f/g/h/i, C2-Q4a/b, C2-Qfail, D-ENG-f; `schema.contract.test.ts`: S-05a..S-05h (INV-05) | CI-1 | PASS |
| NFR-03 | Alarm latency ≤ 1.0 s once both conditions hold | 11.3 | `observability_contracts.test.ts`: C2-Q1a, C2-PURE, D-ENG-a (logical: evaluation fires in the same cycle). No wall-clock benchmark exists (`bench/alert-eval.ts` is PLANNED in `test/nfr-evidence.md`) | CI-1 | PASS (logical; bench not run, see G-5) |
| FR-02c | High-priority alarm **banner** in the browser (pulsing `#E53E3E` border) | 11.3 | Backend DTO/status covered by FR-02a/b. UI banner: *none* (no web UI exists) | none | DEFERRED: not in the Annex scope of 11.4–11.6. Cost to close: banner in the view fed by `/api/v1/alerts` + 1 E2E test |
| NFR-04 | Watchdog `SILENT_TIMEOUT` at 15.0 s ± 0.5 s (exact 15,000 ms with FakeClock), 3-heartbeat recovery | 11.2 / 11.6 base | `observability_contracts.test.ts`: W-1..W-4, D-WD-a, D-WD-b; `schema.contract.test.ts`: S-04a, S-04b (INV-04). Counted under 11.2 (STALE_CACHED / silent cell); consumed by 11.6 | CI-1 | PASS |
| FR-03a | Forensic drill-down data for a silent node (frozen snapshot, ≤ 50-line tail, last job, timeline, `CORDON_RECOMMENDED`) — backend only | supp. Op 4 (feeds 11.6) | `observability_contracts.test.ts`: C4-P1, C4-P2, C4-Q1a/b, C4-REC, C4-EMPTY, C4-Q2/Q3/Q4, C4-I1, C4-I2, C4-CON, C4-Qfail; `schema.contract.test.ts`: S-04c, S-04d | CI-1 | PASS |
| FR-04 | 7-day executive utilization report, subjects, idle, peak contention, empty state, refusals (backend only) | supp. Op 3 (outside 11.1–11.6) | `observability_contracts.test.ts`: C3-P1a/b, C3-P2, C3-P3, C3-Q1a/b/c, C3-Q2, C3-Q3, C3-Q4a/b, C3-I1, C3-I2a, C3-EMPTY-a/b, C3-CON, C3-Qfail; `schema.contract.test.ts`: S-06a..S-06d | CI-1 | PASS |
| NFR-06 | Report ≤ 1,500 ms | supp. Op 3 | `observability_contracts.test.ts`: C3-Q1a, C3-CON (functional); `bench/report.ts` PLANNED, not run | CI-1 | PASS (functional only, see G-5) |
| FR-01e | **WebSocket** push of the telemetry stream on `/ws/telemetry`, client-bound frames ≤ 10 Hz with peak temperature preserved (AD-27) | 11.4 | `test/atdd/story_11_4_ws_storm.test.ts` (5,000 ev/s → ≤ 10 Hz, true max 89 °C kept); red phase documented in `walkthrough-impl2.md` §2. **Not covered:** the PRD's polling fallback | CI-7 | PASS (peak preservation and ≤ 10 Hz under a sustained storm proven, G-13; polling fallback and client CPU not tested) |
| FR-05b | Storm over the WebSocket pipeline: 5,000 ev/s still decimated to 4 Hz, `Storm Mode Active` indicator | 11.4 | Planned: WS storm test (same owner). HTTP-path storm is already PASS under 11.1 | none | DEFERRED: the Annex (AD-27) sets the client stream at ≤ 10 Hz (FR-01e); the 4 Hz bucket decimation is already PASS under 11.1 (FR-05). Open: `Storm Mode Active` indicator is not shown in the web view |
| NFR-01b | Load injector script benchmarking the WebSocket ingestion pipeline, ≥ 5,000 ev/s for ≥ 15 min (PRD NFR-01 verification method) | 11.5 | Planned: k6 script (path to be set by the 11.5 owner, e.g. `k6/storm.js`) with thresholds | none | DEFERRED: the Annex requires a k6 latency/error budget for Flow D, met by the 25 s run on hosted CI (run 42649607325). The 15-min soak is not scheduled. Cost to close: nightly `schedule` job with longer stages |
| NFR-05b | Heap ≤ 128 MB during the 15–60 min storm, measured under load | 11.5 | Planned: k6 run + `process.memoryUsage()` / heap snapshot evidence (N-05) | none | DEFERRED: no heap measurement under load. Cost to close: sample `process.memoryUsage()` during the k6 job and assert ≤ 128 MB |
| FR-06-AD28 | Composite incident correlation: thermal > 85 °C + fan 0 RPM + dropped tokens on one node within 30 s collapse into one `CRITICAL_COOLING_FAILURE` incident, duplicates suppressed (AD-28) | 11.5 | `test/integration/story_11_5_composite_alerts.test.ts`; k6 script `tests/nfr/composite-alert-load.js` (results to be re-run, see walkthrough §3) | CI-7 | PASS (service level only: the correlator is NOT wired into ingestion or the UI, see G-12) |
| E2E-a | Heatmap web page `GET /observability/heatmap` renders the fleet (32 cells = 31 workstations + `server-gpu-01`; node above 88 °C highlighted) | 11.6 | `tests/e2e/heatmap-triage.spec.ts` › "shows the whole fleet and highlights only the node above 88°C" via `tests/e2e/pages/ObservabilityDashboardPage.ts`; route in `src/adapters/inbound/observability-ui.ts`; `test/harness/cordon.test.ts` › "serves the heatmap page and its assets" | CI-6 | PASS |
| E2E-b | Flow E variant: *silent* `ws-gpu-22` (SILENT_TIMEOUT) forensic drill-down (timeline, last job `job-cs480-lora-run-84`, "Cordon Recommended") | 11.6 | Not covered. The Annex BDD for 11.6 is the **thermal alert (> 88 °C)** drill-down (telemetry graph + error logs), which E2E-c covers. The drawer does not call `/v1/nodes/:id/forensics`, which only answers for non-HEALTHY nodes | none | DEFERRED: the Annex BDD for 11.6 is the thermal scenario (covered, E2E-c); the silent-node drill-down is verified at backend level (FR-03a PASS). Cost to close: ~1 E2E test + forensics call in the drawer |
| E2E-c | Annex BDD 11.6: click hot cell `ws-gpu-22` → slide-out drawer with live telemetry graph and recent error logs → "Cordon Node from Cluster" → cell Gray + `CORDONED` lock badge → audit event in the activity feed (visual cordon only, PRD §5 non-goal 3) | 11.6 | `tests/e2e/heatmap-triage.spec.ts` › "Engineer drills down into thermal alert and cordons node" and "Escape closes the drawer and the cordoned state survives a reload"; backend: `test/harness/cordon.test.ts` (idempotency, 20-way concurrent cordon → 1 event, unknown node → 404, audit feed) | CI-5, CI-6 | PASS |
| NFR-07 | WCAG 2.1 AA, keyboard navigation, 0 axe violations on the heatmap, the open drawer and the CORDONED state | 11.6 | `tests/e2e/heatmap-accessibility.spec.ts` (2 tests: heatmap with alert; open drawer + Enter/Escape keyboard flow and focus return) and an axe assertion at the end of the cordon scenario in `heatmap-triage.spec.ts`; `@axe-core/playwright` 4.14.0 with tags wcag2a/2aa/21a/21aa via `ObservabilityDashboardPage.expectNoAccessibilityViolations()`. First run found a real violation (`label-content-name-mismatch`, WCAG 2.5.3, 32 cells), fixed in the view. **Not covered:** the report page, empty state and alarm banner (do not exist in the web view); axe finds only a subset of WCAG issues, no manual screen-reader pass | CI-9 | PASS (automated, views that exist) |

## 5. Coverage summary

| Metric | Count |
|---|:-:|
| Requirement rows in this matrix (11.1–11.6 chain + supplementary Ops) | **26** |
| Unmapped requirements | **0** |
| PASS | **20** (1 with caveat G-12) |
| PENDING | **0** |
| DEFERRED (documented, out of Impl-2 scope) | **6** |
| Failed / FAIL | 0 |

Breakdown by story: 11.1 → 6 PASS · 11.2 → 3 PASS (FR-01c, FR-01d, NFR-04), 1 DEFERRED (NFR-02) · 11.3 → 2 PASS + NFR-03 PASS (3 total), 1 DEFERRED (FR-02c banner) · 11.4 → 1 PASS (FR-01e), 1 DEFERRED (FR-05b) · 11.5 → 1 PASS (FR-06-AD28), 2 DEFERRED (NFR-01b, NFR-05b) · 11.6 → 3 PASS (E2E-a, E2E-c, NFR-07), 1 DEFERRED (E2E-b) · supplementary Ops 3/4 (FR-03a, FR-04, NFR-06) → 3 PASS.

PRD requirement coverage (FR-01..05, NFR-01..08, all 13): each appears at least once above (FR-01 a–e, FR-02 a–c, FR-03, FR-04, FR-05 a–b, NFR-01 a–b, NFR-02 … NFR-08). Fully PASS today: FR-03 (backend), FR-04, NFR-03 (logical), NFR-04, NFR-06 (functional), NFR-08. Partly DEFERRED: FR-01, FR-02, FR-05, NFR-01, NFR-05, NFR-02, NFR-07.

Per-test-ID reconciliation is in `test/traceability-matrix.md` (46 rows / 136 IDs, machine-checked by `npm run trace:check`: CI-2).

## 6. How to close to PASS

For each DEFERRED row that is brought back into scope, change `DEFERRED` to `PASS` and fill the CI evidence cell only after the command below exits 0. Suggested commands (they do not exist yet; adjust to the final script names):

| Rows | Needed first | Command | Expected evidence to paste into CI evidence |
|---|---|---|---|
| E2E-a, E2E-b, E2E-c, NFR-07 (11.6) | Implement `GET /observability/heatmap`, the drill-down panel, the "Cordon Node from Cluster" action and `CORDONED` badge; add `@playwright/test` (+ `@axe-core/playwright`) and a `test:e2e` script; create `tests/e2e/pages/ObservabilityDashboardPage.ts` and `tests/e2e/heatmap-triage.spec.ts`; `npx playwright install chromium` | `npm run test:e2e` (or `npx playwright test tests/e2e/heatmap-triage.spec.ts`) | "N passed" from the Playwright reporter, date, plus the HTML/JSON report path |
| NFR-02 (11.2/11.6) | Add the `performance.mark` latency assertion to the E2E spec | `npm run test:e2e` | p95 render latency values (≤ 250 ms nominal / ≤ 500 ms storm) |
| FR-02c (11.3/11.6) | Alert banner in the web page and an E2E assertion for it | `npm run test:e2e` | pass line for the banner test |
| FR-01e, FR-05b (11.4) | Merge the partner's 11.4 branch (WebSocket adapter + tests) | `npm run test:all` | new total test count (> 282) with the WS tests listed |
| NFR-01b, NFR-05b (11.5) | Merge the partner's 11.5 branch (k6 script); start the server | `npm start` in one shell, then `k6 run k6/storm.js` (path per 11.5 owner), with thresholds for 5,000 ev/s for 15 min | k6 summary: thresholds passed, checks 100 %, plus heap evidence |
| Whole chain | All of the above merged | `npm run ci` (typecheck + test:all + trace:check + readiness:check), then re-run `npm run test:e2e` | final counts; update section 2 and the summary in section 5 |

Also add the 11.4–11.6 test IDs to `test/traceability-matrix.md` (and the new stories to `planning/epics.md`) if `trace:check` / `readiness:check` are extended to cover them; do that in the same change as the code.

## 7. Known gaps and discrepancies

| # | Gap or discrepancy | Impact |
|---|---|---|
| G-1 | **Story numbering mismatch.** `planning/epics.md` and `sprint-status.yaml` use 1.1–4.3 (all `done`); `README.md` and `walkthrough-impl1.md` use Module-11 stories 11.1–11.3. Stories 11.4–11.6 appear in no planning artifact (epics, sprint-status, readiness gate). The 11.x ↔ planning mapping in section 3 is derived, not declared anywhere. | Auditors cannot follow 11.4–11.6 back to a planned story or acceptance criteria; recommend adding them to `epics.md` / `sprint-status.yaml`. |
| G-2 | **PRD describes a browser UI; the repo has no web UI.** FR-01 (grid, colours), FR-02 (banner), FR-03 (modal) and NFR-02/05/07 are specified as UI behaviour, but Impl-1 only exposes JSON endpoints. Impl-1 itself documents NFR-02 and NFR-07 as GAP ("none — UI"). | 11.6 now delivers the page (heatmap, drawer, cordon); the banner (FR-02c) and render latency (NFR-02) remain DEFERRED, NFR-07 is PASS. |
| G-3 | NFR-01 asks for ≥ 15 min at 5,000 ev/s. The ATDD storm test `C1-EDGE-a` defaults to `STORM_SECONDS=60` (virtual seconds, simulated clock); the 900 s run is configured only for the nightly CI template, which is not installed. Real wall-clock throughput is unmeasured (that is what 11.5 k6 adds). | NFR-01 PASS is for the 60 s run only. |
| G-4 | NFR-05 PRD verifies a **browser heap** ≤ 128 MB; Impl-1 evidence is the fixed server ring-buffer size (5,702,400 B) and flat `byteLength`. No heap snapshot or `process.memoryUsage()` run exists. | PASS reflects the design invariant, not the browser metric. |
| G-5 | `test/nfr-evidence.md` marks the benchmark evidence for NFR-01/03/05/06 (`bench/*.ts`, `test-results/*.json`) as PLANNED; none exist. NFR-03 and NFR-06 PASS rows are functional/logical only. | No latency numbers are available. |
| G-6 | **Heatmap colour bands disagree.** PRD FR-01: temperature Green < 65, Yellow 65–79, Orange 80–87, Red ≥ 88 °C; VRAM Green < 70 %, Amber 70–89 %, Magenta ≥ 90 %. Implementation (`src/application/services/telemetry-ingestion.service.ts`, README, walkthrough): `NORMAL` < 75, `WARM` 75–84.9, `CRITICAL` ≥ 85 °C, and no VRAM band. E2E-a must assert one of them; the PRD is the source of truth, so the UI or the service needs aligning. | Risk of a PRD-vs-implementation defect surfacing in 11.6. |
| G-7 | **Cordon is only a recommendation in the backend.** PRD FR-03 requires "Cordon Recommended"; PRD §5 allows "visual cordons". Code has `CORDON_RECOMMENDED`, and `forensics.service.ts` mentions a `CORDONED` state in its error text, but there is no operation that sets a node to `CORDONED` and no `CORDONED` badge DTO. 11.6 must define it (presumably UI/in-memory state). | E2E-c needs a design decision. |
| G-8 | Heatmap size: PRD says "32-cell grid"; the contract is 33 cells (32 nodes, `server-gpu-01` has 2 GPUs). Consistent in `test/traceability-matrix.md` (C1-Q5a: 33 cells) but worth stating in the E2E assertions. | Cosmetic, avoid an off-by-one in E2E. |
| G-9 | `planning/prd.md` and `docs/prd.md` are byte-identical (checked with `diff`). The README says 282 tests (125 + 157); the audited run confirms exactly that. `sprint-status.yaml` (last updated 2026-11-08) has no entries for Impl-2. | No action beyond G-1. |
| G-10 | Hosted CI evidence: `.github/workflows/ci.yml` ran on GitHub for commit `5473e31`: [run 42649607325](https://github.com/JuanAndresCano/ai-compute-observability-solu2/actions/runs/42649607325) with 3 / 3 jobs successful (verify 30 s, Playwright e2e 40 s, k6 39 s). This is the first hosted evidence; earlier rows (CI-1..CI-9) are local runs. | Closed for that commit. Re-check the Actions tab after any later push. |
| G-11 | **The first hosted k6 run was invalid evidence.** It failed `http_req_failed` (1.73 %) because of `ws-gpu-32` (VU 31, HTTP 422) and, more seriously, every request used a non-UUID `batch_id` that the service silently discarded as a "duplicate" (200, `accepted_count: 0`), so p95 = 1.13 ms measured a no-op. The partner's earlier "p95 14.2 ms" came from the same script. | Fixed in the service (422 for a malformed `batch_id`) and in the script (see walkthrough §3). Re-run on hosted CI: passed on `5473e31` (run 42649607325). Real values copied into the walkthrough §3 (p95 1.15 ms, p99 1.78 ms, 0.00 % errors, `event was accepted` 100 %); do not quote the old numbers. |
| G-12 | **Story 11.5's correlator is dead code at system level.** `CompositeIncidentCorrelator` is imported nowhere in `src/` (composition, server, HTTP, WebSocket). Nothing turns telemetry into `RawAnomalyEvent`s, `NodeTelemetryPacketDTO` has no fan-speed field (so `FAN_FAILURE` cannot be produced), and no endpoint or stream publishes the incident. The k6 script posts plain telemetry batches and never exercises the correlator. The unit-level test (`story_11_5_composite_alerts.test.ts`) does prove the algorithm. | Wire it (anomaly source from ingestion + incident output) or state clearly that 11.5 is delivered at service level. Rubric dimension 2 penalises "complex logic bypassed with over-simplified stubs". |
| G-13 | **RESOLVED 2026-11-09.** `story_11_4_ws_storm.test.ts` used a hardcoded `setTimeout(1100)` and a `frames ≤ 10` assertion that a single frame satisfies. Rewritten: sustained storm (5,000-event burst + 500 events after every received frame ≈ 5,000 ev/s), ends when frame timestamps span 1 s (no timer; the vitest timeout is only a guard), asserts ≤ 10 frames in every half-open 1 s window, ≥ 5 frames, > 100 raw events represented per frame, true peak 89 °C preserved and no value above 74 °C invented elsewhere. Mutation check: with the flush timer at 1 ms and an unthrottled downsampler the test fails (`expected 695 to be ≤ 10`); with the real code it passes 3 / 3. **Still not tested:** the BDD line "client CPU < 15 %" (not measurable from Node) and the polling fallback. | None for the sleep and the weak assertion. |
