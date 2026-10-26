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
