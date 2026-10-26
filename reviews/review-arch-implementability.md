# Architecture Implementability Gap Audit (Phase 0)
## Module 11: AI Infrastructure Observability Console
**Document Path:** `reviews/review-arch-implementability.md`  
**Review Target:** `planning/ARCHITECTURE.md` (v1.0.0 from Plan-2)  
**Review Lens:** Adversarial Implementability Audit (`bmad-review --lens adversarial`)  
**Reviewers:** Juand (Partner A — Architect Lead) & Partner (Partner B — Test Lead)  
**Date:** 2026-10-19  
**Status:** TRIAGED & SIGNED OFF by both partners (2026-10-26). The 2026-10-19 Partner B approval was pre-filled by Partner A and was withdrawn (DEC-12); Partner B signed on 2026-10-26.

---

## 1. Executive Summary

This adversarial implementability audit scrutinizes the baseline architectural specification of **Module 11 (AI Infrastructure Observability Console)** to detect and eliminate areas where technical behavior is decided by "nothing"—ambiguities, missing machine-level constraints, untyped errors, un-injected wall clocks, or unstated boundary semantics. 

Under the AI Governance Level 3 rules, any ambiguity left in the architecture document would force an autonomous software development agent (`bmad-build` or junior engineer) to invent unverified design decisions. This audit records **8 concrete implementability gaps**, assigns clear ownership between Partner A and Partner B, and defines the exact lifecycle phase where each gap will be physically closed.

---

## 2. Architecture Implementability Gap Matrix

| # | Gap in `ARCHITECTURE.md` (Decided by "Nothing") | Concrete Hazard (Where an AI/Dev Agent Would Invent a Decision) | Triage Verdict | Resolved in Phase | Owner (A/B) |
|---|---|---|:---:|:---:|:---:|
| **GAP-01** | **Undefined Error Codes & Payload Formats:** Ingestion and reporting fail without machine-parseable error structures. | Dev agent throws generic `new Error("Invalid frame")` or `500 Internal Server Error`, causing client crash or unhandled promise rejection. | **ACCEPT** | **Phase 1** *(contracts.md)* & **Phase 2** *(dto.ts)* | **Partner A** |
| **GAP-02** | **Missing Idempotency & Contention Serialization in Telemetry Ingestion:** No deduplication key or composite uniqueness for simultaneous metric pushes. | Dev agent creates duplicate time-series rows or executes non-atomic `SELECT then UPDATE`, resulting in corrupted historical metrics under 5,000 ev/s. | **ACCEPT** | **Phase 1** *(contracts.md)* & **Phase 2** *(001_schema.sql)* | **Partner A** |
| **GAP-03** | **Un-Injected System Time (Wall-Clock Impurity):** Node timeouts and time intervals rely on implicit system clock. | Dev agent imports `Date.now()` or `performance.now()` directly inside `domain/`, making deterministic testing with `fake_clock` impossible. | **ACCEPT** | **Phase 0** *(Stack)*, **Phase 1** & **Phase 2** *(ClockPort)* | **Partner A** |
| **GAP-04** | **Missing Database-Level Physical Constraints for Alert Cooldown:** Alert deduplication is specified purely as domain prose. | Dev agent implements an in-memory boolean flag that resets on process restart, causing alert flapping storms on transient node reconnects. | **ACCEPT** | **Phase 2** *(001_schema.sql)* & **Phase 3** *(ATDD)* | **Partner A** |
| **GAP-05** | **No Backend DTO / Contract for UI Screen States in Executive Reporting:** UI states (Loading, Empty, Error, Success) lack contract bindings. | Dev agent returns `null` or empty array `[]` on invalid date queries without explanation payloads, triggering blank UI screens for Management. | **ACCEPT** | **Phase 1** *(contracts.md)* & **Phase 2** *(dto.ts)* | **Partner A** |
| **GAP-06** | **Unspecified Memory Drop Policy for Telemetry Storms (5,000 ev/s):** The buffer decimation rule lacks explicit queue-overflow behavior. | Dev agent lets worker memory grow unbounded during sustained socket bursts or silently drops events without incrementing a `dropped_events_count` counter. | **ACCEPT** | **Phase 1** *(contracts.md)* & **Phase 3** *(ATDD P0)* | **Partner B** |
| **GAP-07** | **Ambiguous Identifier Format for Alerts and Incidents:** Alert IDs lack deterministic format and correlation schemas. | Dev agent generates uncoordinated random strings (e.g. `Math.random()`), preventing cross-node correlation and audit event tracing. | **ACCEPT** | **Phase 1** *(Error Catalog)* & **Phase 2** *(dto.ts)* | **Partner A** |
| **GAP-08** | **Absence of Executable Test Seed Fixtures for Heterogeneous Fleet:** Flap and silence tests lack guaranteed initial healthy cluster state. | Dev agent tests on an ad-hoc 1-node cluster, missing edge cases on the dual-GPU server (`server-gpu-01`, 2x48GB) and 31 workstations. | **ACCEPT** | **Phase 3** *(TEA fixtures)* | **Partner B** |

---

## 3. Detailed Implementability Gap Analysis

### GAP-01: Undefined Error Codes & Machine-Parseable Failure Schemas
* **Class:** Untyped Error Catalog / Protocol Drift.
* **Analysis:** While `ARCHITECTURE.md` Section 3 lists success payloads (`NodeTelemetryPacket`, `InferenceMetricPacket`), it defines zero failure schemas. When an inbound frame contains out-of-range GPU temperatures ($> 150^\circ\text{C}$), negative VRAM values, or unregistered node identifiers, the behavior is undefined.
* **Resolution Strategy:** Author a centralized **Typed Error Catalog** in `planning/detailed-design/contracts.md` defining canonical error codes (`ERR_INVALID_NODE_ID`, `ERR_TELEMETRY_OUT_OF_RANGE`, `ERR_WINDOW_RANGE_EXCEEDED`, `ERR_BUFFER_OVERFLOW`), HTTP/WS status codes, explanation templates, and boolean `retryable` flags.

### GAP-02: Idempotency & Ingestion Contention Serialization
* **Class:** Missing Idempotency Key / Concurrency Risk.
* **Analysis:** At 5,000 events/sec, network retries or concurrent worker dispatches can deliver duplicate packets with identical `(node_id, gpu_index, timestamp_ms)`. Without schema-level uniqueness, SQLite would store duplicated points, skewing percentile calculations and hourly rollups.
* **Resolution Strategy:** Enforce a composite primary key / unique constraint in `001_observability_schema.sql` on `(node_id, gpu_index, timestamp_ms)` and declare idempotent upsert semantics (`INSERT OR IGNORE` or `ON CONFLICT DO UPDATE`) in the behavioral contract.

### GAP-03: Wall-Clock Impurity & Non-Deterministic Time
* **Class:** Unspecified Time Source / Domain Impurity.
* **Analysis:** Node silence detection (AD-04) requires transitioning `ws-gpu-22` to `SILENT_TIMEOUT` at $\ge 15.0\text{ s}$ of missed heartbeats. If domain logic directly reads the OS system clock (`new Date()`), unit tests cannot advance time deterministically without using fragile real-time `sleep()` calls, violating the TEA testing standards.
* **Resolution Strategy:** Declare an injectable `ClockPort` outbound port. All domain services must receive `clock: ClockPort`. For tests, Partner B will implement `FakeClock` with explicit `advanceBy(ms)` capabilities.

### GAP-04: Database-Level Physical Constraints for Alert Cooldown
* **Class:** Missing NOT NULL / CHECK / UNIQUE Physical Enforcements.
* **Analysis:** The Seed Table for Module 11 states: *"alert fires once per incident until cleared; alerts.incident_key UNIQUE"*. The existing architecture described this in English prose but provided no DDL schema enforcing it at the storage engine level.
* **Resolution Strategy:** Create table `operational_alerts` in `001_observability_schema.sql` with `incident_key TEXT NOT NULL`, a partial unique index `CREATE UNIQUE INDEX idx_active_alerts ON operational_alerts(node_id, trigger_rule) WHERE resolved_at IS NULL` *(restored by AMD-3 as `idx_unique_active_alert` on `(trigger_rule, node_id)`; the v1.0 DDL had keyed it on `incident_key`)*, and foreign keys to `cluster_nodes`.

### GAP-05: Backend Contracts for UI Screen States
* **Class:** UI State without Backend Contract Binding.
* **Analysis:** `ux/EXPERIENCE.md` specifies that the 7-day executive view must handle Empty, Error, and Loading states. Currently, no backend contract specifies what payload is returned when a query specifies a future timestamp, an inverted date range ($from > to$), or when no jobs ran during the selected academic period.
* **Resolution Strategy:** Formulate strict Preconditions ($P$) and Postconditions ($Q$) for `buildUtilizationReport` in `contracts.md`, accompanied by typed `ReportQueryDTO`, `ExecutiveReportDTO`, and `EmptyStateExplanationDTO`.

### GAP-06: Telemetry Storm Drop Policy & Memory Safeguards
* **Class:** Unbounded Queue / Missing Degradation Semantics.
* **Analysis:** Under the mandatory edge case (5,000 ev/s burst), if the ingestion pipeline suffers CPU throttling, memory must not exceed $128\text{ MB}$. The architecture dictates a 250 ms decimation window, but does not define what happens if the internal ring queue reaches maximum capacity.
* **Resolution Strategy:** Define an explicit buffer capacity ($10,000\text{ raw events}$ ceiling). Once saturated, the ingestion port drops the excess events and increments `dropped_events_count`, which is exposed in `IngestionResultDTO`. *(Superseded by AMD-1: the excess is the tail of the batch, tail-drop; `ERR_BUFFER_OVERFLOW` is raised only when 0 slots are free.)*

### GAP-07: Canonical Identifier Formats
* **Class:** Missing ID Format / Uncorrelated Entities.
* **Analysis:** Identifiers such as `alert_id` and `incident_key` are presented as informal strings without regex patterns or generation rules.
* **Resolution Strategy:** Standardize ID formats in `dto.ts`: `alert_id` must match `^ALT-[A-Z0-9]{8,16}$`, `node_id` must match `^(ws-gpu-[0-3][0-9]|server-gpu-01)$`, and `request_id` must be a valid UUIDv4.

### GAP-08: Heterogeneous Fleet Fixture Specification
* **Class:** Missing Test Seed Fixtures.
* **Analysis:** The cluster topology is non-trivial: 31 nodes with 1 GPU (24GB) and 1 server with 2 GPUs (48GB each). Without an automated seed fixture script, tests risk verifying only homogeneous workstation configurations.
* **Resolution Strategy:** Partner B will author `test/fixtures/seed_fleet.ts` exporting an immutable snapshot of all 32 nodes and 33 GPUs in initial `HEALTHY` state, migrated directly into SQLite during test harness setup.

---

## 4. Triage Verdict & Handoff Agreement

* **Total Gaps Identified:** 8 (All 8 ACCEPTED).
* **Work Allocation:**
  * **Partner A (Architect Lead):** 6 Gaps (GAP-01, GAP-02, GAP-03, GAP-04, GAP-05, GAP-07) to be resolved across Phase 1 (`contracts.md`) and Phase 2 (`ports-and-adapters.md`, `001_observability_schema.sql`, `dto.ts`, `openapi.yaml`).
  * **Partner B (Test Lead):** 2 Gaps (GAP-06, GAP-08) to be resolved in Phase 3 (`test-design.md`, `seed_fleet.ts`, `observability_contracts.test.ts`).
* **Implementability Readiness Gate:** **PASS (Conditioned on Phase 1–3 Execution)**.

```
Reviewed and Approved by:
Partner A (Juand - Architect Lead): [APPROVED - 2026-10-19; reconfirmed 2026-10-26]
Partner B (Juan Andrés Cano - Test Lead): [SIGNED - 2026-10-26 - Phase 0 audit confirmed with the v1.1 stack declarations]
```
