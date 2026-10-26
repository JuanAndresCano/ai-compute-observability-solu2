# AI Governance & Decision Log (Solu-2)
## Project: Academic AI Compute Fabric — Enterprise Solutioning & Contract-Driven Backlog
### Module 11: AI Infrastructure Observability Console
**AI Governance Level:** Level 3 (Autonomous Engineering Council Directed by Human Pair)  
**Engineering Pair:**  
- **Juand (Partner A):** Lead Solution Architect (Leads Phase 0, Phase 1, Phase 2; Reviewer in Phase 3)  
- **Partner B:** Lead Test Architect (Leads Phase 3 TEA; Reviewer in Phases 1 & 2)  
**Inherited Baseline:** Entries DEC-01 through DEC-08 preserved in `ai-log/decision-log.md` (Plan-2 Deliverable)  
**Document Path:** `ai-log/decision-log-solu2.md`

---

## 1. Solu-2 Decision Matrix Overview

| Entry ID | Phase | Decision Topic | AI Recommendation | Human Decision & Intervention | Status | Attribution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DEC-09** | Phase 0 (Intake) | Runtime Stack, Storage & Clock Port Injection | Use Express.js with direct `Date.now()` calls in domain and unstructured JSON metric logs. | **REJECTED AI PROPOSAL:** Mandated TypeScript 5.x / ESM, Fastify + `ws`, SQLite with DDL constraints, and pure `ClockPort` injection. | **ADOPTED** | **Partner A (Juand)** |
| **DEC-10** | Phase 1 (Contracts) | Anomaly Alert Deduplication & Error Representation | Use informal strings for exceptions and in-memory `Set` with `setTimeout` for alert debouncing. | **REJECTED AI PROPOSAL:** Mandated Typed Error Catalog, canonical HTTP/WS codes, and physical SQLite UNIQUE index on `incident_key` with hysteresis. | **ADOPTED** | **Partner A (Juand)** |
| **DEC-11** | Phase 2 (Detailed Design) | Atomic Contention Serialization vs SELECT-then-UPDATE & DTO Decoupling | Pass Fastify request objects directly into ports and execute `SELECT then UPDATE` in application code. | **REJECTED AI PROPOSAL:** Enforced pure primitive DTOs in `dto.ts` and atomic SQLite partial unique index with `INSERT OR IGNORE`. | **ADOPTED** | **Partner A (Juand)** |

| **DEC-12** | Phase 1–2 re-review (Partner B) | Defects in contracts/DDL/DTO found by the Test Lead; options chosen; sign-off governance | AI listed 9 defects with ≥2 options each and a recommendation | **ACCEPT 8 / MODIFY 1 / REJECT 1:** options chosen per item (see entry); item 4 challenged and re-analysed; pre-filled Partner B approvals rejected and reset to PENDING | **ADOPTED** | **Partner B** |

| **DEC-13** | Phase 1–2 amendment (Partner B) | Open observations OBS-1..4: rule scope, persisted hysteresis, bucket id, `is_empty` | AI proposed one handling per observation | **ACCEPT 4/4** (AMD-10..13) | **ADOPTED** | **Partner B** (Partner A to confirm) |

| **DEC-14** | Phase 3 (ATDD data design) | Unreachable alarm threshold: nested windows cap the spike ratio at 10.0 (AMD-14) | AI built the first breach fixture from the contract formula and found a 11.2x surge could not be expressed | **PROPOSED, applied provisionally:** baseline = the 270 s before the short window; **pending confirmation by both partners** | **PENDING** | **Partner B** (Partner A to confirm) |
| **DEC-15** | Phase 3 (test preparation) | How to prepare tests without writing production logic; what the red suite covers; self-review disclosure | AI proposed an oracle implementation to prove the tests can go green | **REJECTED the oracle implementation** (stop-point rule); chose independent oracles, DDL mutation, red-guard probe | **ADOPTED** | **Partner B** |

| **DEC-16** | Phase 4 (epics + readiness audit) | Close contract gaps (AMD-15..20, Operation 4, FleetSnapshotDTO) BEFORE writing stories | AI proposed writing the stories first and leaving the gaps as "contract-first tasks" inside stories | **MODIFIED by the AI under Partner B's standing instruction to move fast; Partner B review PENDING.** Gaps closed first, 6 findings REV-DET-20..24 + 3 PRD alignments | **PENDING REVIEW** | **Partner B** (to confirm) |
| **DEC-17** | Phase 4 (gate drill) | The first drill found a hole in the readiness control itself | First rename of a DTO in a story was NOT detected | **ACCEPT the fix:** regex widened (`DTO|Dto|dto|Type`), drill repeated and caught | **ADOPTED** | **Partner B** (to confirm) |

*(Note: Phase 5 entries (wrap-up) continue from DEC-18.)*

---

## 2. Detailed Audit Entries (Solu-2)

### Entry DEC-09: Technology Stack, Persistence Engine & Pure Clock Port Injection
* **Timestamp:** 2026-10-19T16:55:00-05:00
* **Lifecycle Phase:** Phase 0 — Intake & Architecture Gap Audit
* **AI Persona / Skill Invoked:** Winston (System Architect) & `/bmad-review --lens adversarial`
* **Trigger Prompt / Context:** Defining the technical stack, runtime boundaries, and time management for Module 11 to support the 3 core operations (`ingestMetricBatch`, `evaluateAlertRule`, `buildUtilizationReport`) and the 5,000 ev/s mandatory edge case.
* **AI Generated Proposal:** The AI suggested using Express.js with raw in-memory JavaScript arrays, persisting telemetry snapshots into loose JSON files on disk, and reading system time via native `Date.now()` or `performance.now()` inside the domain evaluation functions.
* **Human Evaluation & Critique:** Juand (Partner A) analyzed this against Hexagonal purity and TEA testability constraints:
  1. Invoking `Date.now()` or `new Date()` directly in `domain/` creates an impure dependency on the operating system wall-clock. This would force the test harness to use real-time `sleep()` or fragile timers during ATDD test execution, directly violating Unit 4 testability rules.
  2. Storing metrics in loose JSON files lacks transaction serialization and cannot physically enforce composite uniqueness or range constraints during high-throughput bursts (GAP-02).
  3. Fastify provides significantly higher HTTP/SSE throughput than standard Express and couples cleanly with the native `ws` WebSocket engine.
* **Human Action Taken (REJECTION):** Rejected the AI proposal. Juand mandated:
  1. **Strict TypeScript 5.x** with Node.js 20+ LTS and ECMAScript Modules (`ESM`).
  2. **Persistence Engine:** SQLite 3 (in-memory / `better-sqlite3`) strictly migrated from `001_observability_schema.sql` to enforce database constraints physically.
  3. **ClockPort Interface:** Mandatory outbound port `ClockPort` injected into every time-sensitive domain service (`now(): Timestamp`, `nowMs(): number`). The domain is barred from importing system time.
  4. **Testing Harness:** Vitest + `@vitest/coverage-v8` + `fast-check` with a deterministic `FakeClock` fixture.
* **Artifacts Changed:**
  - `planning/ARCHITECTURE.md` (Added Section 1.1 "Stack Decisions").
  - `reviews/review-arch-implementability.md` (GAP-03, GAP-04).
* **Pair Attribution:** Juand (Partner A — Architect Lead).

---

### Entry DEC-10: Anomaly Alert Deduplication, Hysteresis & Typed Error Modeling
* **Timestamp:** 2026-10-19T17:05:00-05:00
* **Lifecycle Phase:** Phase 1 — Formal Behavioral Contracts (P, Q, I)
* **AI Persona / Skill Invoked:** Winston (System Architect) & `/bmad-architecture`
* **Trigger Prompt / Context:** Designing the contract for `evaluateAlertRule` under high-frequency anomaly bursts ($10\times$ token surge and $P_{99} > 8.0\text{ s}$), ensuring alert deduplication and standardizing error reporting.
* **AI Generated Proposal:** The AI recommended using standard Javascript `Error` strings (e.g. `throw new Error("Invalid telemetry range")`) without typed error codes, and managing alert deduplication in-memory using a transient `Set<string>` cleared by a `setTimeout(..., 60000)` timer.
* **Human Evaluation & Critique:** Juand (Partner A) evaluated this against AD-03, AD-05, and GAP-04:
  1. Relying on an in-memory `Set` with `setTimeout` is non-deterministic and creates volatile state that vanishes whenever the service restarts, resulting in visual alert flapping storms on transient node reconnects.
  2. Untyped string exceptions force client applications and UI drawers to parse error messages with regex, breaking machine-enforceable contract bindings.
  3. A 60-second arbitrary timeout violates the 15-second ($3\times$ 5-second evaluation cycles) hysteresis state machine specified in the PRD.
* **Human Action Taken (REJECTION):** Rejected the in-memory timer and untyped error proposal. Juand mandated:
  1. A centralized **Typed Error Catalog** with canonical string error codes (e.g. `ERR_INVALID_TELEMETRY_PAYLOAD`, `ERR_BUFFER_OVERFLOW`), HTTP/WS status codes, human-readable templates, and boolean `retryable` flags.
  2. Anchoring alert uniqueness physically to the storage engine via `UNIQUE(incident_key)` for unresolved alerts (`WHERE resolved_at IS NULL`) in SQLite.
  3. Strict 3-cycle ($15.0\text{ s}$) hysteresis clearance before transitioning alert status from `TRIGGERED` to `CLEARED`.
* **Artifacts Changed:**
  - `planning/detailed-design/contracts.md` (Sections 1, 2, and 3).
* **Pair Attribution:** Juand (Partner A — Architect Lead).

---

### Entry DEC-11: Atomic Contention Serialization & Hexagonal DTO Decoupling
* **Timestamp:** 2026-10-19T17:10:00-05:00
* **Lifecycle Phase:** Phase 2 — Ports & Adapters, Schemas, DTOs & Events
* **AI Persona / Skill Invoked:** Amelia (Developer Lead) & `/bmad-review --lens adversarial`
* **Trigger Prompt / Context:** Structuring the concrete schemas (`001_observability_schema.sql`), DTO signatures (`dto.ts`), and ingress routes for concurrent ingestion and alert deduplication.
* **AI Generated Proposal:** The AI recommended:
  1. Passing web framework request contexts (e.g. `FastifyRequest` / `FastifyReply`) directly into Inbound Port handler signatures to reduce boilerplate mapping.
  2. Handling alert deduplication by executing an application-level `SELECT * FROM operational_alerts WHERE incident_key = ?` query, checking if a record exists in JavaScript, and then calling `INSERT INTO operational_alerts`.
* **Human Evaluation & Critique:** Juand (Partner A) evaluated this against the Hard Architectural Rules (R4 and R5) of Solu-2:
  1. Passing framework objects into inbound ports couples core domain logic to the HTTP transport layer, permanently destroying Hexagonal isolation and preventing standalone TEA test harnesses from calling use cases without web server mocking.
  2. The `SELECT then UPDATE / INSERT` sequence is an architectural defect under concurrency. At a 5,000 ev/s burst rate, parallel worker ticks querying simultaneously will both see no record, and both will execute `INSERT`, causing race condition collisions or duplicate active incidents.
* **Human Action Taken (REJECTION):** Rejected both AI proposals. Juand mandated:
  1. Strict primitive-typed DTOs in `planning/detailed-design/schemas/dto.ts` with zero framework types.
  2. Database-level atomic contention serialization using SQLite partial unique index:
     `CREATE UNIQUE INDEX idx_unique_active_incident ON operational_alerts(incident_key) WHERE resolved_at_ms IS NULL;`
     combined with atomic conditional execution (`INSERT ... ON CONFLICT(incident_key) DO NOTHING`).
* **Artifacts Changed:**
  - `planning/detailed-design/ports-and-adapters.md` (Hard Rules Section 2).
  - `planning/detailed-design/schemas/001_observability_schema.sql` (Section 3).
  - `planning/detailed-design/schemas/dto.ts`.
  - `reviews/review-detailed-design.md` (R4, R5, REV-DET-02).
* **Pair Attribution:** Juand (Partner A — Architect Lead).

---

### Entry DEC-12: Partner B Re-Review of the Phase 1–2 Package — Defect Triage, Options and Sign-Off Governance
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 1–2 amendment, performed by the Test Lead at the start of Phase 3 (feeds back to Phase 0 gaps)
* **AI Persona / Skill Invoked:** Murat-style test-architect review (adversarial + edge-case lens, read-only) followed by an amendment pass; executed with Claude Code
* **Trigger Prompt / Context:** Partner B asked the AI to verify that Partner A's handover was correct before any test is written, to list every defect with a recommended fix and at least one alternative, and to apply the fixes the human chose.
* **AI Generated Output:** Nine defects, each with a recommendation, an alternative and the reason for the recommendation (full table in `reviews/review-detailed-design.md` §6). The AI also stated, wrongly, that the error catalog would end with 9 codes; applying the three removals the human accepted produced 8, and the artifacts say 8.
* **Human Decisions (Partner B):**

| # | Defect | Options offered | Decision | Reason given or implied |
|:---:|---|---|:---:|---|
| 1 | Overflow: 429 vs `dropped_count` | A tail-drop + visible `dropped_count` (recommended); B reject whole batch | **ACCEPT A** | Annex A asks for a visible dropped-count in the P0 storm test. |
| 2 | Cold start: error 412 vs status | A result status (recommended); B keep 412 | **ACCEPT A** | `ARCHITECTURE.md` AD-03 already specified the status; an expected state is not a client error. |
| 3 | `incident_key` embeds the hour | A index on `(trigger_rule, node_id)` + unique `incident_key` (recommended); B key without hour | **ACCEPT A** | Physical dedupe without losing per-incident audit identity. |
| 4 | Ring buffer 5.53 MB with 33 GPUs | Single fix offered; human asked "could it be adjusted to fit the lab?" | **MODIFY → re-analysed, then ACCEPT 5,702,400 B** | The AI checked: the 5.53 MB figure exists only in our own documents (PRD bound is 128 MB, NFR-05). Fitting it would cost 30-minute depth (6,981 slots) or a 195-series split saving 86 KB. The human accepted the exact 33-series figure. |
| 5 | Catalog codes without triggers | A narrow regex, delete 3 codes' dead paths, bind `ERR_DATABASE_UNAVAILABLE` (recommended); B keep `ERR_UNKNOWN_NODE_ID` with a registry lookup | **ACCEPT A** | Fleet is fixed at 32 nodes by the PRD; fewer codes, smaller test surface. |
| 6 | Wrong NFR citations | A fix citations, label design budgets (recommended); B add NFR-09/10 to the PRD | **ACCEPT A** | PRD stays untouched except through triaged findings. |
| 7 | Temperature range drift | Single option | **ACCEPT** | Obvious single-sourcing. |
| 8 | Hourly sum equality vs `<= 1.0001` | A relax I2; B add `gpu_hours_unavailable` + equality CHECK (recommended) | **ACCEPT B** | A node in `SILENT_TIMEOUT` (ws-gpu-22) must not be reported as idle. |
| 9 | `evaluateAlertRule` has no sample data | A window DTO carries aggregated data (recommended); B `MetricWindowPort` | **ACCEPT A** | Keeps the evaluator a pure function and the ATDD seedable without the ingestion path. |
| G | Pre-filled "Partner B APPROVED/SIGNED" lines in Phase 0 and Phase 1–2 reviews | AI proposed marking them PENDING | **REJECT the pre-filled approvals** | The approval belongs to Partner B and is given only after reviewing the amended artifacts. |

* **Human Action Taken:** Chose the options above; required that the defects be fixed before Phase 3; created the repository. The AI applied the amendments as separate commits (contracts, schemas, architecture, governance) so Partner A can review each diff.
* **Verification performed by the AI before claiming the fixes:** DDL executed on SQLite 3.45.1 (positive and negative inserts for INV-05, INV-06 and the `node_id` CHECK, and the `ON CONFLICT` upsert returning 1 then 0 rows); `dto.ts` compiled under `tsc --strict`; `openapi.yaml` parsed with 0 unresolved `$ref`; grep confirmed no stale reference to removed codes, the 32-series figure or the old index name outside historical entries.
* **Open items not fixed (need a pair decision):** OBS-1..OBS-4 in `reviews/review-detailed-design.md` §6.1.
* **Artifacts Changed:** `planning/detailed-design/contracts.md` (v1.1), `ports-and-adapters.md`, `schemas/001_observability_schema.sql`, `schemas/dto.ts`, `schemas/openapi.yaml`, `schemas/events.md`, `planning/ARCHITECTURE.md`, `reviews/review-arch-implementability.md`, `reviews/review-detailed-design.md`.
* **Note on historical entries:** DEC-10 and DEC-11 describe `UNIQUE(incident_key)` / `idx_unique_active_incident`; that wording is kept as the record of what was decided on 2026-10-19 and is superseded by AMD-3.
* **Pair Attribution:** Partner B (Test Lead) decided; Partner A (Juand) to be informed and to confirm the amendments to his artifacts.

---

### Entry DEC-13: Resolution of Open Observations OBS-1..4 (AMD-10..13)
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 1–2 amendment, before Phase 3 tests depend on the clauses
* **AI Persona / Skill Invoked:** Test-architect review (edge-case lens) with Claude Code
* **Trigger Prompt / Context:** Partner B accepted the handling proposed in `reviews/review-detailed-design.md` §6.1 ("vamos con esas decisiones") and asked to continue to Phase 3.
* **AI Generated Output:** One proposal per observation. For OBS-2 the AI chose a persisted counter over an in-domain object, applying the argument Partner A recorded in DEC-10 (volatile state is lost on restart), and added `last_cycle_index` so a duplicate call inside one 5,000 ms cycle cannot double-count. The AI also removed `THERMAL_CRITICAL_THRESHOLD` after finding no FR for it in `prd.md`.
* **Human Decision (Partner B):** ACCEPT 4/4. Partner A has not yet reviewed these four amendments; his confirmation is pending.
* **Verification:** DDL re-executed on SQLite 3.45.1; hysteresis `UPDATE` simulated at t = 5,000 / 5,100 / 10,000 / 15,000 / 20,000 ms (counter 1, 1, 2, 3→`CLEARED`, unchanged); `dto.ts` compiled with `tsc --strict`; `openapi.yaml` parsed.
* **Artifacts Changed:** `contracts.md`, `001_observability_schema.sql`, `dto.ts`, `openapi.yaml`, `events.md`, `reviews/review-detailed-design.md`.
* **Pair Attribution:** Partner B decided; Partner A to confirm.

---

### Entry DEC-14: AMD-14 - The Alarm Formula Cannot Fire With Nested Windows
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 3 - building the data for the first happy-path ATDD test (`C2-Q1a`)
* **AI Persona / Skill Invoked:** Test-architect lens with Claude Code (test data derivation; not a skill run)
* **Trigger Prompt / Context:** Partner B asked the AI to write the red suite. To express "baseline 1,200 tok/s, current 13,440 tok/s" the AI had to fill `long_window_prompt_tokens`. AMD-9 (accepted in DEC-12) made the short window part of the long window, so `long >= short`, and the contract baseline was `long / 300`.
* **AI Generated Output:** A derivation: ratio = (S/30) / (L/300) = 10·S/L with S <= L, so ratio <= 10.0 and equals 10.0 only if every token of the last 300 s occurred in the last 30 s; exhaustive check over small integers confirmed the maximum is exactly 10.0. The same defect exists in `ARCHITECTURE.md` AD-03 (Plan-2), so it predates this unit. Two options: **A** baseline = `(long - short) / 270` (the 270 s before the short window); **B** make the windows disjoint (`[now-330 s, now-30 s)`) and drop the containment precondition.
* **Human Decision (Partner B):** the AI applied A **provisionally** so the tests have a coherent oracle (it changes one formula and one time clause; B changes the assembler and the DTO more). **Not yet confirmed by Partner B nor Partner A** - the status column says PENDING.
* **Why A:** it keeps the window shapes from the PRD (30 s and 300 s) and the P1 containment check from AMD-9; the baseline is still "the 300 s average" minus the burst under test.
* **Artifacts Changed:** `contracts.md` (Op2 Q2 step 2, Time), `ARCHITECTURE.md` section 2.3, `dto.ts` comment, tests `C2-Q1a`, `C2-Q2a`, `C2-PURE`, `D-ENG-*`.
* **If rejected:** only the helper builders `breachWindow`, `calmWindow`, `ratioWindow` and the cases in `C2-Q2a`/`D-ENG-a` need new numbers.
* **Pair Attribution:** Partner B proposed; Partner A to confirm.

---

### Entry DEC-15: Preparing Tests Without Production Logic; Self-Review Disclosure
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 3 - Test Preparation
* **AI Persona / Skill Invoked:** Murat-style test architect with Claude Code. The `bmad-testarch-*` skills could not be loaded from this repository; their templates and steps were followed by hand (`test/tea-skill-matrix.md` states this).
* **AI Generated Proposal:** To prove the 133 tests can turn green, write a throw-away reference implementation outside the repository and run the suite against it.
* **Human Evaluation & Critique:** The Solutioning Stop-Point Rule allows interface stubs and failing tests only; a hand-written implementation, even outside the submission, is production logic written by the council and defeats the purpose of the red phase (the next story must be driven by the tests, not by a hidden solution). The cost is that test correctness cannot be shown by a green run.
* **Human Action Taken (REJECTION of the oracle implementation).** Alternative evidence adopted: (1) independent oracle for fixture validity (2,000 generated events, 0 violations); (2) DDL executed and mutated - 11 of 11 constraint mutants killed by `test/schema`; (3) red-guard probe - injected passing, skipped and wrong-reason cases all make it fail; (4) `trace-check` probe - a broken link makes it fail; (5) hand-checked arithmetic in the data builders; (6) property tests with fast-check. Residual risk is recorded as TQ-14 in `reviews/review-test-quality.md`: the first story must show each RED to GREEN transition.
* **Other decisions in this phase:** the red seam is `System` + stubs throwing `NotImplementedError`, and rejection helpers re-throw it so a red test always fails because the stub is empty; physical invariants are tested in a separate green schema suite that turns red if a constraint is removed; the P0 storm is parameterised (`STORM_SECONDS`, 60 s in PR, 900 s nightly) instead of skipped, because the guard forbids skipped tests; the review in `reviews/review-test-quality.md` was done by the author and is marked non-independent until Partner A re-reviews it.
* **Artifacts Changed:** `test/**`, `src/**` (interface stubs only), `package.json`, `tsconfig.json`, `reviews/review-test-quality.md`.
* **Pair Attribution:** Partner B.

---

### Entry DEC-16: Close the Contract Gaps Before Writing the Stories
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 4 - Step 4.1 (epics) and the readiness audit checks 1, 2 and 5
* **AI Persona / Skill Invoked:** John (PM) / Amelia (Dev) perspective, `bmad-create-epics-and-stories` structure followed by hand; the skill itself could not be loaded from this repository.
* **Trigger Prompt / Context:** Partner B asked to move to Phase 4 quickly and to take on as much of the second half as possible. Mapping requirements to stories showed that FR-03 (forensic drill-down), the FR-04 "peak contention window" and the heatmap / Storm Mode / STALE_CACHED outputs had no contract or DTO, and that `batch_id` storage, `hour_epoch` units and two report DTO fields were undefined.
* **AI Generated Proposal:** Option A - write the 16 stories and turn each gap into a "contract-first" task inside its story. Option B - amend the contracts first so every story is implementable without inventing a decision.
* **Decision recorded:** B, because the audit question is exactly "could a developer implement these epics without inventing decisions nothing records?" and a story that starts by deciding the contract fails it. **This was decided by the AI inside Partner B's general instruction, not by an explicit per-item answer; Partner B (and Partner A) must review AMD-15..20 and may revert any of them.**
* **What changed:** AMD-15 `peak_contention_windows`; AMD-16 Operation 4 `getNodeForensics` + capture clause + `node_forensics` + 2 error codes; AMD-17 1,000 ms loop vs 5,000 ms cycle and "every accepted event is a heartbeat"; AMD-18 `FleetSnapshotDTO`; AMD-19 `ingested_batches`; AMD-20 `hour_epoch` in seconds and definitions of `by_subject` / `node_aggregates`; PRD FR-01 and FR-02 aligned to the contract (REV-DET-17..19). Findings: `reviews/review-detailed-design.md` section 6.3 (REV-DET-17..26).
* **Verification:** DDL executed on SQLite 3.45 (forensics CHECK rejects 51 lines, invalid JSON, unknown node; upsert returns 1 then 0; batch id registers once); `dto.ts` compiled with `tsc --strict`; OpenAPI parsed with 0 unresolved `$ref`; 20 new red tests and 7 new green tests (3 schema, 4 fixture self-tests); `npm run ci` green.
* **Artifacts Changed:** `contracts.md` (v1.2), `dto.ts`, `openapi.yaml`, `001_observability_schema.sql`, `events.md`, `prd.md`, `ports-and-adapters.md`, `test/**`, `src/**` (stubs), `planning/epics.md`.
* **Pair Attribution:** AI-proposed under Partner B's instruction; Partner B to confirm; Partner A to review.

---

### Entry DEC-17: The Gate Drill Found a Hole in the Control
* **Timestamp:** 2026-10-26
* **Lifecycle Phase:** Phase 4 - Step 4.3 (gate drill)
* **What happened:** Break 1 (delete the `Binding invariants` line of Story 2.2) was reported by `readiness-check` ("Story 2.2: missing field Binding invariants"). Break 2 (rename `FleetCellDTO` to `FleetCellDto` in Story 3.4 only) was **not** reported: the check looked for tokens ending in `DTO`, and the broken name no longer matched the pattern. The control was a rubber stamp for that class of break.
* **Fix:** the token pattern now matches `DTO|Dto|dto|Type|type`; the drill was repeated and reported "Story 3.4: DTO/type \"FleetCellDto\" does not exist in dto.ts"; the story was restored byte-identical and the check passed. Full log in `planning/readiness-gate-report.md`.
* **Also observed:** `sprint_plan.py` (the skill's script) parsed both broken files without a warning (`in_sync: true`); it validates headings and statuses, not story content. The content checks are the judgement part of the gate and `readiness-check.mjs`.
* **Pair Attribution:** AI executed the drill; Partner B to confirm.
