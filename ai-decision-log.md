# AI Decision Log & Governance Trail (Task Impl-1)

**Module:** Module 11 — AI Infrastructure Observability Console  
**Project:** Academic AI Compute Fabric  
**Track:** TypeScript / Node.js 20+ ESM  
**Standard:** BMad Build Full Ceremony & Design-by-Contract (DbC)  
**Lead Architect & Reviewer:** Juand (Human Engineering Lead)  
**AI Developer Agent:** Antigravity / BMad Developer Agent  

---

## Executive Summary & Governance Overview

In accordance with Section 5 and Rubric Dimension 4 & 5 of the Task Impl-1 Statement, all AI interactions were systematically governed under the **BMad Build Full Ceremony**. Unconstrained code generation was strictly prohibited. Every change traversed the 6-step build lifecycle: *Context Ingestion → Repository Inspection → Task Breakdown → Concurrent Code + Tests → DoD Verification → Review Report*.

This log documents **7 significant AI interactions**, featuring **4 explicit human architectural corrections** spanning layer boundary enforcement, error contract compliance, transaction atomicity, and state machine edge-case handling.

---

## Logged AI Interactions & Human Corrections

### Interaction 1: Subsystem Scaffolding & Web Transport Adapter Selection
* **Context / Prompt:**  
  *"Scaffold the HTTP server adapter and configuration system for Module 11, ensuring runnable local execution and health probes."*
* **AI Proposal:**  
  The agent proposed installing `fastify` and `@fastify/sensible` as dependencies to provide high-throughput routing and automatic schema serialization.
* **Human Architectural Review & Correction (Critical Correction #1):**  
  *Correction Trigger:* Rule R3 & Dependency Safety Mandate.  
  The human reviewer rejected the introduction of `fastify` because native build toolchains caused cross-platform lockfile conflicts on Windows development environments, and the Solu-2 architecture explicitly favors zero-unvetted external runtime dependencies.  
  *Resolution:* Refactored the inbound HTTP driving adapter (`src/adapters/inbound/http-server.ts`) to use native Node.js `node:http`. Confined all networking to the adapter layer with zero transport types leaking into `src/domain` or `src/application`.

---

### Interaction 2: OpenAPI Contract Error Compliance & Naming Conventions
* **Context / Prompt:**  
  *"Implement error responses and HTTP status mappings for the HTTP server when encountering invalid payloads or unmapped routes."*
* **AI Proposal:**  
  The agent generated standard REST error responses using `{ error: "Not Found", code: "NOT_FOUND", status_code: 404 }`.
* **Human Architectural Review & Correction (Critical Correction #2):**  
  *Correction Trigger:* Non-Negotiable Rule: Zero Hallucinated Endpoints & Schema Compliance.  
  The human reviewer caught that the upstream OpenAPI 3.1 schema and `planning/detailed-design/contracts.md` strictly require the canonical `ErrorBodyDTO` interface:
  ```typescript
  interface ErrorBodyDTO {
    error_code: ErrorCodeType;
    http_status: number;
    message: string;
    timestamp_ms: number;
    retryable: boolean;
    details: Record<string, string | number | boolean>;
  }
  ```
  *Resolution:* Replaced all ad-hoc error payloads with `ContractError` carrying the strongly typed `ErrorBodyDTO`. Property names `code` and `status_code` were eliminated in favor of `error_code` and `http_status`.

---

### Interaction 3: Telemetry Precondition P3 & Database Transaction Side-Effects
* **Context / Prompt:**  
  *"Implement `TelemetryIngestionService.ingestMetricBatch` to handle idempotency with `ingested_batches` and enforce the 10,000 capacity queue."*
* **AI Proposal:**  
  The agent registered the batch via `registerBatch(batch.batch_id)` before evaluating whether the queue capacity was full (`free === 0`).
* **Human Architectural Review & Correction (Critical Correction #3):**  
  *Correction Trigger:* Invariant Q-fail & Clean Rollback Guarantee.  
  The human reviewer noted that under contract clause Op1 Q-fail, a batch rejected by P3 (`free === 0` → HTTP 429) must leave the database completely unaltered (database fingerprint identical before and after). Inserting `batch_id` prior to capacity verification mutated `ingested_batches` despite the rejection.  
  *Resolution:* Re-sequenced the execution pipeline: Capacity validation (P3) is checked first. If `free === 0`, `ERR_BUFFER_OVERFLOW` (429) is thrown immediately with zero database side-effects.

---

### Interaction 4: Test Runner Execution Architecture on Windows Workspace
* **Context / Prompt:**  
  *"Run the red-phase ATDD gate check `test:atdd:guard` to verify existing stubs before starting story implementation."*
* **AI Proposal:**  
  The agent executed `node test/ci/red-guard.mjs`, which invoked Vitest via `child_process.spawnSync` writing temporary JSON reports to the file system.
* **Human Architectural Review & Correction:**  
  *Correction Trigger:* Execution Reliability & Windows Space-Path Quoting.  
  The process exited with status `3221225477` (`0xC0000005` Access Violation) because shell subprocess spawning on Windows tripped on spaces in the workspace path (`.../Desarrollo con IA/Impl 1`).  
  *Resolution:* Refactored `red-guard.mjs` to invoke Vitest programmatically in-process using Vitest Node API (`import { startVitest } from 'vitest/node'`). Eliminated child processes and temporary files entirely.

---

### Interaction 5: Heartbeat Watchdog Flapping Node State Machine
* **Context / Prompt:**  
  *"Implement the node heartbeat state machine (`NodeHeartbeatWatchdog`) adhering to AD-04 and 3-cycle recovery."*
* **AI Proposal:**  
  The agent incremented a recovery counter on each heartbeat, transitioning to `HEALTHY` once 3 heartbeats were received, regardless of whether silent intervals occurred in between.
* **Human Architectural Review & Correction (Critical Correction #4):**  
  *Correction Trigger:* Invariant INV-04 / Test `[W-4]`.  
  The human reviewer flagged that a "flapping" node (which sends a heartbeat only every other 5-second slot) must never return to `HEALTHY`. The 3 recovery heartbeats must be strictly consecutive without any intervening missed intervals.  
  *Resolution:* Added interval tracking inside `NodeHeartbeatWatchdog.check()`. If a node in `RECOVERING` status experiences silence $\ge 5{,}000\text{ ms}$, its `consecutiveRecoveryHeartbeats` counter is immediately reset to 0, preventing flapping nodes from ever prematurely recovering.

---

### Interaction 6: Static Ring Buffer Memory Allocation & Zero Garbage Collection
* **Context / Prompt:**  
  *"Implement the in-memory telemetry buffer for 32 nodes (33 GPU series) storing 7,200 time-slots of 6 metrics."*
* **AI Proposal:**  
  The agent suggested using nested JavaScript objects and dynamic arrays: `Map<string, { min: number[], max: number[], ... }>`.
* **Human Architectural Review:**  
  *Correction Trigger:* Invariant INV-02 / AD-02 (Static Memory Footprint).  
  Dynamic objects cause frequent heap allocations and garbage collection spikes under high telemetry storms (5,000 ev/s).  
  *Resolution:* Replaced with pre-allocated `Float32Array` buffers: exactly $33\text{ series} \times 6\text{ metrics} \times 7{,}200\text{ slots} \times 4\text{ bytes} = 5{,}702{,}400\text{ bytes}$ ($\approx 5.70\text{ MB}$). Implemented ring pointer modulo 7,200 arithmetic ensuring $O(1)$ updates and zero streaming allocations.

---

### Interaction 7: Alert Deduplication & Atomic Conflict Resolution (R5)
* **Context / Prompt:**  
  *"Implement alert persistence in `operational_alerts` when an anomaly breach occurs."*
* **AI Proposal:**  
  The agent proposed executing a `SELECT` query to check if an active alert already existed, followed by an `INSERT` statement in application code.
* **Human Architectural Review:**  
  *Correction Trigger:* Architectural Rule R5 (No SELECT-then-UPDATE read-modify-write races).  
  In concurrent environments, two simultaneous breach evaluations could both read 0 active alerts and then both insert, violating alert uniqueness.  
  *Resolution:* Enforced database-level atomicity using the partial unique index `idx_unique_active_alert` and SQLite `INSERT ... ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING`. If `changes === 0`, the existing alert is returned with zero new rows and zero duplicate audit events.

---

## Summary of Governance Metrics

| Metric | Target (Rubric) | Achieved | Status |
|---|:---:|:---:|:---:|
| Documented AI Interactions | $\ge 6$ | **7** | **EXCEEDED** |
| Critical Human Corrections | $\ge 2$ | **4** | **EXCEEDED** |
| Layer Boundary Violations Caught & Corrected | - | **2** | **VERIFIED** |
| Contract / Schema Drift Instances Corrected | - | **2** | **VERIFIED** |

---
---

# AI Decision Log — Task Impl-2 (Story 11.6 / Flow E and traceability)

**Scope of this section:** AI interactions on branch `feature/impl2-e2e-playwright` (Story 11.6 Playwright E2E, cordon endpoint, traceability matrix). Partner interactions for Stories 11.4 and 11.5 belong in a section appended from `feature/impl2-backend-resilience` (`TODO(partner)`).
**Agent:** Claude Code (Sonnet 5.5). **Human lead for this section:** J. A. Cano.

**Honesty note on the "≥ 2 corrected AI testing mistakes" requirement.** Entries below are tagged by *who* caught the problem. Entry 6 is a testing defect caught by the suite itself, **not** by a human reviewer. Entry 2 and entry 5 are human steering. Two human corrections of AI testing mistakes must be recorded by the team from actual reviews (`TODO(team)`): this log does not invent them.

| # | Topic | Caught / decided by |
|---|---|---|
| 1 | Wrong source document | AI flagged, human supplied the Annex |
| 2 | Delegating the matrix | Human decision, AI constraints |
| 3 | Playwright version pin | AI, verified by command |
| 4 | Adapter separation to avoid merge conflicts | Human constraint, AI design |
| 5 | Thermal threshold 88 °C | Human decision |
| 6 | Flat-line chart rejected by Playwright | **Test suite** (AI-generated assertion and UI defect) |
| 7 | `pkill` killed the shell, files silently not written | AI, via `git status` |
| 8 | Proving the spec is not "blindly green" | AI-proposed, evidence in walkthrough |
| 9 | Trace mode `on-first-retry` vs `retain-on-failure` | Spec text corrected AI's plan |

### Interaction 1 — Wrong PDF treated as the Impl-2 statement
* **Prompt:** "Review the repo and the attached PDF with the context for Impl-2; implement Story 11.6 (pages 30–32)."
* **AI action:** Extracted the PDF in `last_dance/`. It has 7 image-only pages (the Impl-1 delivery deck, 282/282 tests), not 32; OCR confirmed it. The AI said so and did **not** invent the BDD scenario.
* **Human steering:** Pasted the real Impl-2 text, including the Annex scenario for Story 11.6 (`ws-gpu-22` > 88 °C, drawer, cordon, activity feed).
* **Outcome:** Implementation matched the actual acceptance criteria, including the "audit event in the activity feed" clause that the first plan had not covered.

### Interaction 2 — Delegating the traceability matrix to a subagent
* **Decision (human):** Split the work; the matrix runs in parallel to the UI.
* **AI constraints set in the prompt:** PASS only where a test exists and passed in a real run; `PENDING` for 11.4/11.5/11.6 until evidence exists; verify every cited path.
* **Result:** 25 requirements, 15 PASS / 10 PENDING, plus 9 documented discrepancies (story numbering, colour bands 65/80/88 vs 75/85, no web UI, cordon only a recommendation, etc.).
* **Human-led follow-up:** After implementing 11.6 the matrix rows E2E-a and E2E-c were changed to PASS only with the real run IDs (CI-5, CI-6); E2E-b (silent-node forensic variant) was left PENDING because the Annex scenario is the thermal one.

### Interaction 3 — Pinning Playwright to the already-installed browser
* **AI action:** `@playwright/test@latest` (1.65.0) wants Chromium build 1254; the machine cache has 1248. The AI probed versions with `playwright install --dry-run` and pinned `1.64.0` (build 1248), avoiding a ~150 MB download and version drift (`--save-exact`).

### Interaction 4 — Isolating the UI in its own inbound adapter
* **Human constraint:** The partner edits `http-server.ts` (WebSocket, k6).
* **AI design:** Put the view and triage routes in `src/adapters/inbound/observability-ui.ts`; `http-server.ts` gets a 2-line delegation. Cordon logic lives behind `CordonPort` / `NodeCordonService`, so `purity.test.ts` stays green.
* **Why it matters:** minimal merge-conflict surface; hexagonal boundary preserved.

### Interaction 5 — Threshold: 88 °C vs the repo's 85 °C band
* **Conflict:** The Annex and the human say alert > 88 °C; the existing heatmap DTO marks `CRITICAL` from 85 °C; the PRD says red ≥ 88 °C.
* **Human decision:** use 88 °C, strictly greater.
* **AI implementation:** the constant lives in the view only; the Impl-1 contract (`temperature_band`) was **not** modified, so no ATDD test changes. The mismatch is recorded in the matrix as gap G-6.

### Interaction 6 — Playwright rejects a zero-height polyline (test caught an AI defect)
* **AI proposal:** the drawer chart as a single SVG `polyline`, asserted with `toBeVisible()`.
* **What happened:** the first run failed: with a constant temperature (all samples 91 °C) the polyline's bounding box has height 0, so Playwright treats it as hidden (`unexpected value "hidden"`).
* **Resolution:** the AI fixed the **product**, not the assertion: added a filled `polygon.area` under the curve (a real visual improvement), and made the Page Object also assert `data-points` ≥ 1. It explicitly did **not** weaken the check to `toBeAttached()` or add a wait.
* **Classification:** a real defect found by an auto-retrying web-first assertion. Not a human correction.

### Interaction 7 — A shell command killed the session; files were never written
* **What happened:** a `pkill -f "dist/src/server.js"` matched its own command line and terminated the shell (exit 144) before the next `cat > file` blocks ran. The AI noticed through `git status` / `ls` that `tests/e2e/*.ts` did not exist, recreated them with the file-writing tool, and stopped using pattern-based `pkill`.
* **Lesson:** verify that a step's outputs exist before moving on; never trust a command chain after an abnormal exit.

### Interaction 8 — Proving the E2E spec can fail ("Blindly Green" trap)
* **AI proposal:** temporarily set `THERMAL_ALERT_C` from 88 to 95 and run with `CI=1` (retries=1).
* **Evidence:** test 1 failed with `Expected: "alert" / Received: "warm"`, test 2 and 3 skipped (serial mode), retry #1 failed identically, and a `trace.zip` was written for the retry. The change was reverted (`git checkout`), the suite is green again (3/3). See walkthrough §2.
* **Also done:** assertions check concrete values (`91°C`, exactly one feed entry, `1 cordoned`, disabled button), not just visibility.

### Interaction 9 — Trace configuration aligned with the statement
* **AI first plan:** `trace: 'retain-on-failure'` (suggested by the teammate's brief).
* **Correction from the statement:** the Impl-2 text requires `trace: 'on-first-retry'`. The config was set accordingly with `retries: 1` under `CI`, and both modes were exercised (full-pass `--trace=on` and the failing retry above).

## Impl-2 governance summary (this branch)
* Interactions logged: **9** (≥ 8 required for the whole team; partner entries still to be appended).
* Human-steered decisions: 1, 2, 4, 5. AI-flagged / test-caught issues: 3, 6, 7, 8, 9.
* **Open item `TODO(team)`:** record at least 2 genuine human corrections of AI-written tests (e.g. an over-mocked test or a rejected `sleep`) from the partner's Stories 11.4/11.5 or from review of this branch, with the exact before/after.
