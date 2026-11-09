# Implementation Walkthrough Report (Task Impl-2)

**Module:** Module 11 — AI Infrastructure Observability Console  
**Project:** Academic AI Compute Fabric  
**Phase:** Task Impl-2 (Advanced Implementation, Testing Alternatives & System Hardening)  
**Authors:** Juan David Quintero & Juan Andrés Cano  
**Status:** Stories 11.4, 11.5 and 11.6 merged on `main`; see §6 for the verified totals

---

## 1. Executive Summary & Hardened System Architecture

In Task Impl-2, Module 11 transitioned from basic foundational operations into a **mission-critical, hardened real-time observability platform**. 

The system was fortified against high-concurrency race conditions, telemetry storms, and alert floods using the **BMad Testing Alternatives (The 5 Flows)**:
- **Flow A (ATDD-First):** Story 11.4 followed strict Acceptance Test-Driven Development with a verified failing red phase before production code was introduced.
- **Flow D (Quality Gate & NFR):** Story 11.5 enforced composite incident correlation to eliminate 30-second alert storms, backed by a k6 load test asserting $p_{95} < 50$ ms.
- **Flow E (Playwright E2E):** Story 11.6 verified the interactive node drill-down and cordoning dashboard with zero flaky timeouts and visual forensic tracing.

> **Verification note.** §2–§3 were authored by the partner on `feature/impl2-backend-resilience`. The k6 figures in §3 come from their run (k6 is not installed on the machine used for the merge): re-run `k6 run tests/nfr/composite-alert-load.js` and paste the raw output here before submitting. §4–§5 (Story 11.6) were produced and verified on `feature/impl2-e2e-playwright`.

---

## 2. Story 11.4: Telemetry Flood Ingestion Storm Throttling (Flow A: ATDD-First)

### Business Goal & Technical Context
* **Persona:** Real-Time Console Stream Handler.
* **Problem:** Under a benchmarking storm of 5,000 events/second across 32 nodes, pushing raw events freezes client browser rendering threads and balloons server memory.
* **Solution (Invariant AD-27):** A WebSocket stream handler on `/ws/telemetry` equipped with a token-bucket stream rate-limiter and a peak-preserving sliding window downsampler. Throttles client-bound frames to $\le 10$ Hz per node while strictly retaining true maximum temperature (e.g. 89°C) and peak VRAM.

### Authentic Red-Phase ATDD Evidence
Prior to writing production code, the test suite `test/atdd/story_11_4_ws_storm.test.ts` was executed to witness an authentic red failure:

```text
 RUN  v1.6.1 C:/Universidad/Noveno Semestre/Desarrollo con IA/Impl 1

 ❯ test/atdd/story_11_4_ws_storm.test.ts  (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/atdd/story_11_4_ws_storm.test.ts [ test/atdd/story_11_4_ws_storm.test.ts ]
Error: Failed to load url ../../src/adapters/inbound/websocket-server. Does the file exist?
```

### Production Implementation
* **Domain Service:** `src/domain/services/stream-downsampler.ts` — Pure sliding window aggregator tracking `maxTemp`, `maxVram`, and running averages, harvesting at 100 ms intervals (10 Hz).
* **Inbound Adapter:** `src/adapters/inbound/websocket-server.ts` — Native Node.js `ws` server broadcasting downsampled frames.

### Green-Phase Verification
```text
 ✓ test/atdd/story_11_4_ws_storm.test.ts  (1 test) 1123ms
   ✓ throttles a 5,000 events/sec storm to <= 10 Hz without dropping peak temperature (89°C)
```

---

## 3. Story 11.5: Multi-Metric Composite Alert Correlation Engine (Flow D: NFR & Quality Gate)

### Business Goal & Technical Context
* **Persona:** Cluster Observability Engine.
* **Problem:** When cooling fails on a workstation, operators receive an alert storm of 30+ disconnected alerts (temperature spike, fan tachometer drop, dropped tokens, inference timeouts).
* **Solution (Invariant AD-28):** Multi-metric sliding window correlation engine. Any co-occurrence of:
  - Thermal spike ($>85^\circ\text{C}$)
  - Fan failure ($0$ RPM)
  - Dropped token heartbeats ($>0$)
  within a 30-second window on the same node collapses into exactly **one composite incident**: `CRITICAL_COOLING_FAILURE`. All subsequent related alerts on that node are suppressed.

### Implementation & Verification
* **Domain Service:** `src/domain/services/composite-incident-correlator.ts`.
* **Integration Test:** `test/integration/story_11_5_composite_alerts.test.ts`:
```text
 ✓ test/integration/story_11_5_composite_alerts.test.ts  (1 test) 2ms
   ✓ correlates thermal spike >85C, fan 0 RPM, and dropped tokens into a single CRITICAL_COOLING_FAILURE incident
```

### k6 Non-Functional Requirement (NFR) Load Test Summary
Script: `tests/nfr/composite-alert-load.js` simulating 50 concurrent virtual users submitting burst telemetry:

| Metric | Target SLA | Measured Result | Status |
|---|:---:|:---:|:---:|
| **$p_{95}$ Latency** | $< 50\text{ ms}$ | **$14.2\text{ ms}$** | **PASS** |
| **$p_{99}$ Latency** | $< 100\text{ ms}$ | **$28.6\text{ ms}$** | **PASS** |
| **Error Rate** | $< 1.0\%$ | **$0.00\%$** | **PASS** |
| **Unhandled HTTP 500s** | $0$ | **$0$** | **PASS** |

---

## 4. Story 11.6 — hardening summary (Flow E scope)

| Concern | What was done | Where |
|---|---|---|
| Ports & Adapters kept strict | New inbound port `CordonPort`, outbound `AuditTrailPort`, use case `NodeCordonService`; the web view is an adapter. `http-server.ts` only delegates (2 lines). Domain/application import no transport or `node:*` driver (`purity.test.ts` still green, now scanning the 4 new files). | `src/ports/in/cordon.port.ts`, `src/ports/out/audit-trail.port.ts`, `src/application/services/node-cordon.service.ts`, `src/adapters/inbound/observability-ui.ts` |
| Idempotent state change | A second cordon of the same node returns `newly_cordoned=false` and emits **no** second audit event. | `NodeCordonService.cordonNode` |
| Concurrency defense | The check-then-set on the cordon map has no `await` between check and set, so it cannot interleave on the Node event loop. Test: 20 concurrent cordons of `server-gpu-01` → exactly 1 `node.cordoned` event. | `test/harness/cordon.test.ts` |
| Structured errors, no crash | Unknown/malformed node id → typed `ErrorBodyDTO` `ERR_UNKNOWN_NODE_ID` (404), zero side effects. Verified for `ws-gpu-00`, `ws-gpu-32`, `ws-gpu-1`, `server-gpu-02`, empty string and `../etc/passwd`. | `NodeCordonService`, `observability-ui.ts` |
| Static serving is whitelisted | Only 3 exact URLs map to 3 files; `heatmap.html` under `/assets/`, `..` and `%2e%2e` return 404. Responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. | `observability-ui.ts`, tested in `cordon.test.ts` |
| No injection in the view | Data from the API is written with `textContent` only; no `innerHTML`. | `ui/heatmap.js` |
| Bounded memory | Audit trail is a bounded ring (500 events); the chart keeps 60 points per node. | `in-memory-audit-trail.ts`, `heatmap.js` |
| Graceful degradation | If the API is unreachable the page shows a `role="alert"` banner and keeps retrying; a failed cordon re-enables the button and shows an inline error. | `heatmap.js` |
| Accessibility basics | Cells are `<button>`s with descriptive `aria-label`; state is text + icon, never colour only; focus moves into the drawer and returns to the cell; `Esc` closes; `prefers-reduced-motion` disables the flash. (No automated axe run yet: see matrix row NFR-07.) | `ui/*` |

Known limits, stated plainly: cordon state is **in memory** (lost on restart; the PRD treats cordon as visual only); the server clock is the existing `FakeClock`, so feed timestamps do not advance.

## 5. Story 11.6 — Interactive Node Drill-Down & Incident Triage Timeline E2E (Flow E)

**Technical challenge.** Deliver a browser flow (hot cell → drawer → cordon → audit feed) that is verified through the real UI with zero timing hacks, while keeping the E2E layer thin so the test pyramid is not inverted.

**Testing flow applied.** Flow E (Playwright + Page Object Model), backed by lower layers:

| Layer | Files | Count |
|---|---|:-:|
| Unit/integration (service + real HTTP on an ephemeral port, real audit trail, nothing mocked) | `test/harness/cordon.test.ts` | 16 |
| E2E (browser) | `tests/e2e/heatmap-triage.spec.ts` via `tests/e2e/pages/ObservabilityDashboardPage.ts` | 3 |

**Code implemented.**
- View `GET /observability/heatmap`: 32-cell grid (31 workstations + `server-gpu-01`), cells above **88 °C** (strictly) flagged red and flashing, side drawer with live temperature chart (+ 88 °C threshold line), recent error logs, and **Cordon Node from Cluster**; cordoned cells turn gray with a lock icon and `CORDONED`; activity feed of `node.cordoned` audit events.
- Endpoints: `POST /v1/nodes/:id/cordon`, `GET /v1/nodes/:id/logs`, `GET /v1/nodes/cordoned`, `GET /v1/audit-events`.
- Playwright config: `trace: 'on-first-retry'`, `screenshot/video` on failure, one worker, `webServer` that builds and starts the real server with `SEED_DEMO_LOGS=true`.

**Page Object / spec rules honoured.** All selectors (`data-testid`) and interactions live in `ObservabilityDashboardPage`; the spec only calls intent-named methods. Assertions are web-first (`toBeVisible`, `toHaveText`, `toHaveAttribute`, `toHaveCount`, `toBeDisabled`). The test data is seeded through the real ingestion API (`POST /v1/telemetry/batches`, `ws-gpu-22` at 91 °C, everyone else 62 °C). Check: `grep -rn "waitForTimeout\|sleep(" tests playwright.config.ts src/adapters/inbound/ui` → no matches.

**BDD mapping (Annex, Story 11.6).**

| Scenario step | Spec line / assertion |
|---|---|
| Liam is viewing the Fleet Thermal Heatmap | `dashboard.goto()` |
| `ws-gpu-22` is flashing Red (> 88 °C) | `expectThermalAlert('ws-gpu-22')` → `data-state="alert"` |
| Liam clicks cell `ws-gpu-22` | `openNodeDrawer('ws-gpu-22')` |
| Drawer opens with live telemetry graphs and recent error logs | `expectDrawerOpenFor`, `drawerTemperature` = `91°C`, `expectTelemetryGraphRendered`, `expectErrorLogLine(/temperature 91C exceeds threshold/)` |
| Liam clicks "Cordon Node from Cluster" | `cordonSelectedNode()` |
| Cell turns Gray with a "CORDONED" lock icon | `expectCordoned` → `data-state="cordoned"`, badge text `CORDONED`, `lock-icon` visible |
| Audit event appears in the activity feed | `expectActivityEntry('Node ws-gpu-22 cordoned by liam')` (exactly 1) |

### Terminal evidence

Green run (`npm run test:e2e`, 2026-11-09):

```
Running 3 tests using 1 worker

  ✓  1 [chromium] › tests/e2e/heatmap-triage.spec.ts:32:3 › … › shows the whole fleet and highlights only the node above 88°C (406ms)
  ✓  2 [chromium] › tests/e2e/heatmap-triage.spec.ts:44:3 › … › Engineer drills down into thermal alert and cordons node (765ms)
  ✓  3 [chromium] › tests/e2e/heatmap-triage.spec.ts:73:3 › … › Escape closes the drawer and the cordoned state survives a reload (673ms)

  3 passed (5.4s)
```

Full gate (`npm run ci`): typecheck OK · harness 5 files / 145 tests · ATDD 157 tests (**302 / 302**) · `trace:check` OK · `readiness:check` OK.

**Not a "blindly green" suite — deliberate break.** To prove the spec can fail, the view threshold was temporarily changed from 88 to 95 (`THERMAL_ALERT_C`) and the suite run with `CI=1` (retries=1). Result (then reverted with `git checkout`):

```
  ✘  1 … › shows the whole fleet and highlights only the node above 88°C (5.4s)
  -  2 … › Engineer drills down into thermal alert and cordons node
  -  3 … › Escape closes the drawer and the cordoned state survives a reload
  ✘  4 … › shows the whole fleet and highlights only the node above 88°C (retry #1) (5.5s)
  Error: expect(locator).toHaveAttribute(expected) failed
  Locator:  getByTestId('node-cell-ws-gpu-22')
  Expected: "alert"
  Received: "warm"
```

### Trace confirmation

- Config: `trace: 'on-first-retry'` (`playwright.config.ts`), `retries: 1` when `CI` is set.
- The failing run above produced, on the retry:
  `test-results/heatmap-triage-Fleet-Therm-a24a5-ts-only-the-node-above-88°C-chromium-retry1/trace.zip`
  (plus `test-failed-1.png` and `video.webm`).
- A full-pass run with `npx playwright test --trace=on` produced one `trace.zip` for each of the 3 tests.
- Open with `npx playwright show-trace <path>/trace.zip` to see DOM snapshots, the drawer slide-out and the cordon button click.
- **TODO(team):** CI does not exist in this repo (no `.github/`). To meet "trace.zip captured on CI", copy `test/ci/quality-gate.yml` to `.github/workflows/`, add `npx playwright test` and upload `test-results/` as an artifact on failure.


## 6. Multi-layer test execution summary

Verified on `main` after merging `feature/impl2-e2e-playwright` and `feature/impl2-backend-resilience` (`npm run ci` + `npm run test:e2e`):

```text
Vitest harness config : 6 files, 148 tests   (fixtures 36, schema 35, scaffold 8, cordon 16, purity 52, integration/story_11_5 1)
Vitest ATDD config    : 2 files, 158 tests   (157 contracts + story_11_4_ws_storm 1)
Playwright (Flow E)   : 1 spec,   3 tests    (3 passed, 5.6 s)
typecheck / trace:check / readiness:check : OK
```

Merge notes: (1) the partner's `ConsoleUiDispatch.dispatch` iterated `snapshot.nodes`, which does not exist on `FleetSnapshotDTO` (it has `cells`), breaking `tsc` and `docker build`; fixed to read `snapshot.cells`. (2) `test/integration/` was not in any Vitest config, so the Story 11.5 test never ran under `npm run ci`; added to the harness include list. The earlier "285 tests" figure therefore did not include it.

---

## 7. Traceability

See [`traceability-matrix.md`](traceability-matrix.md): 25 requirements, 0 unmapped, 17 PASS / 8 PENDING at the time of this commit. Close the PENDING rows only with real evidence (section 6 of the matrix lists the commands).

## 8. How to reproduce

```bash
npm ci
npm run ci           # typecheck + 302 tests + trace/readiness checks
npm run test:e2e     # builds, starts the server on :4311, runs Playwright
npm run test:e2e:report
```
