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

*(Note: Entries DEC-12 to DEC-14 will be recorded during Phase 3 and 4 by Partner B).*

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
