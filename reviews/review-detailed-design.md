# Detailed Design Gate Review (Phase 1–2 Gate)
## Module 11: AI Infrastructure Observability Console
**Document Path:** `reviews/review-detailed-design.md`  
**Review Targets:**  
- `planning/detailed-design/contracts.md`  
- `planning/detailed-design/ports-and-adapters.md`  
- `planning/detailed-design/schemas/001_observability_schema.sql`  
- `planning/detailed-design/schemas/dto.ts`  
- `planning/detailed-design/schemas/events.md`  
- `planning/detailed-design/schemas/openapi.yaml`  
**Review Lenses:** Adversarial Implementability (`--lens adversarial`) & Edge-Case Hunter (`--lens edge-case-hunter`)  
**Lead Reviewer:** Juand (Partner A — Architect Lead)  
**Co-Reviewer:** Partner B (Test Lead)  
**Date:** 2026-10-19  
**Gate Verdict (v1.2):** PASS — v1.0 gate superseded by the Partner B re-review in §6 (REV-DET-07..30, all ACCEPTED and fixed); amendments AMD-10..20 confirmed by Partner A and approved by Partner B on 2026-10-26

---

## 1. Executive Summary

This formal gate review scrutinizes all Phase 1 and Phase 2 detailed design artifacts against machine-enforceability, domain isolation, database atomicity, and edge-case resilience. Specifically, the audit verifies that:
1. Every Invariant clause $I_n$ points to a machine constraint in SQL (`001_observability_schema.sql`) or a pure function guard in `domain/`.
2. Contended writes rely on atomic serialization rather than defect-prone `SELECT then UPDATE` sequences.
3. Domain models and inbound port interfaces are strictly isolated from web frameworks, ORM libraries, and operating system wall-clock sources.
4. The mandatory edge case of $5,000\text{ events/sec}$ telemetry storm is bounded without memory leaks or dropped explainability.

---

## 2. Hard Architectural Rules Verification

| Rule # | Architectural Invariant Rule | Verification Evidence in Artifacts | Verdict |
|:---:|---|---|:---:|
| **R1** | **Domain Purity:** `domain/` contains ZERO imports of web frameworks, DB drivers, `Date.now()`, or network clients. | Enshrined in `ports-and-adapters.md` Section 2. Verified that all entities import only pure TypeScript types. | **COMPLIANT** |
| **R2** | **Deterministic Time:** Time and randomness enter domain services strictly via injected `ClockPort` / `IdGeneratorPort`. | All 3 operations receive `clock: ClockPort`. Zero references to system clock in domain contracts. | **COMPLIANT** |
| **R3** | **Hardware Agnosticism:** Every GPU sensor and cluster exporter interaction is isolated behind an outbound port with a simulated adapter. | `adapters/sim/simulated-telemetry-gen.ts` implements `TelemetryRepositoryPort` using local JSON fixtures. | **COMPLIANT** |
| **R4** | **Primitive-Typed DTOs:** No framework request/reply object appears in port signatures or DTO declarations. | Inspected `dto.ts`: all fields are composed of primitive `string`, `number`, `boolean`, arrays, and records. | **COMPLIANT** |
| **R5** | **Atomicity over Cleverness:** Contended writes are serialized via SQL constraints or atomic operations; zero `SELECT then UPDATE`. | `operational_alerts` uses `idx_unique_active_incident` and `INSERT OR IGNORE`; `telemetry_buckets` uses composite PK. | **COMPLIANT** |

---

## 3. Triaged Detailed Findings Matrix

| Finding ID | Review Lens | Severity | Finding Description | Triage Resolution | Technical Rationale & Action Taken |
|:---:|:---:|:---:|---|:---:|---|
| **REV-DET-01** | Adversarial | **HIGH** | Inverted Reporting Range ($from \ge to$) could trigger infinite loops or invalid SQL slice scans. | **[ACCEPT & FIXED]** | Precondition P1 in `contracts.md` and check in `ReportQueryDTO` explicitly require $from < to$ and $(to - from) \le 168\text{ h}$. |
| **REV-DET-02** | Edge-Case | **HIGH** | Flapping alert triggers during intermittent node reconnection could emit multiple alerts for the same underlying incident. | **[ACCEPT & FIXED]** | Mandated 3-cycle ($15.0\text{ s}$) hysteresis clearance window before alert status transitions from `TRIGGERED` to `CLEARED`, bound to partial unique index in `001_observability_schema.sql`. |
| **REV-DET-03** | Adversarial | **MEDIUM** | Central server `server-gpu-01` dual-GPU metrics could be accidentally overwritten if mapped to single scalar. | **[ACCEPT & FIXED]** | Enforced composite primary key `(node_id, gpu_index)` with strict check `gpu_index IN (0, 1)` in SQL and DTOs (AD-08). |
| **REV-DET-04** | Edge-Case | **HIGH** | Client browser memory overflow if $5,000\text{ ev/s}$ burst exceeds Web Worker queue processing capacity. | **[ACCEPT & FIXED]** | Added Precondition P3 in `ingestMetricBatch`: queue ceiling capped at $10,000\text{ raw events}$; returns `ERR_BUFFER_OVERFLOW` (429) and tracks `dropped_count`. |
| **REV-DET-05** | Adversarial | **LOW** | Academic subject filters with mixed case (e.g. `"cs-480"`) could bypass SQLite equality queries. | **[ACCEPT & FIXED]** | Enforced uppercase literal union type `AcademicSubjectType` in `dto.ts` and `CHECK (primary_subject IN ('CS-101','CS-480','CS-530','FAC-RES','IDLE'))` in SQL. |
| **REV-DET-06** | Edge-Case | **MEDIUM** | Cold-start anomaly false-positives during cluster initialization before baseline metrics stabilize. | **[ACCEPT & FIXED]** | Precondition P2 in `evaluateAlertRule` suppresses evaluation and returns `SUPPRESSED_COLD_START` until baseline window contains $\ge 50$ completed samples. |

---

## 4. Contract ↔ Schema Cross-Check Audit

| Invariant Clause ($I_n$) | Enforcing Entity & Line Pointer in Schema / Domain | Physical Constraint Mechanism | Verification Status |
|:---:|---|---|:---:|
| **INV-01 (AD-01)** | `ports-and-adapters.md` L25; `BucketDecimator.accumulate()` | Worker 250ms decimation queue + 10k event ceiling | **VERIFIED** |
| **INV-02 (AD-02)** | `001_observability_schema.sql` L31-L60; `TelemetryRingBuffer` | `Float32Array(7200)` static allocation + modulo wrap | **VERIFIED** |
| **INV-03 (AD-03)** | `contracts.md` Op 2 L80; `AnomalyDetectionEngine.evaluate()` | Cold-start guard ($\ge 50$ samples) + 100-bucket histogram | **VERIFIED** |
| **INV-04 (AD-04)** | `001_observability_schema.sql` L85-L100; `chk_watchdog_hysteresis` | `CHECK ((state != 'SILENT_TIMEOUT') OR (consecutive_missed >= 3))` | **VERIFIED** |
| **INV-05 (AD-05)** | `001_observability_schema.sql` L75; `idx_unique_active_incident` | `CREATE UNIQUE INDEX ... WHERE resolved_at_ms IS NULL` | **VERIFIED** |
| **INV-06 (AD-06)** | `001_observability_schema.sql` L115; `chk_hourly_gpu_sum` | `CHECK ((gpu_hours_busy + gpu_hours_idle) <= 1.0001)` | **VERIFIED** |
| **INV-07 (AD-07)** | `ports-and-adapters.md` L32; `FakeClock` test double | Outbound `ClockPort` injected; 0 external network imports | **VERIFIED** |
| **INV-08 (AD-08)** | `001_observability_schema.sql` L20; `chk_node_gpu_topology` | `CHECK (node_type = 'WORKSTATION' AND gpu_index = 0 OR ...)` | **VERIFIED** |

---

## 5. Certification Sign-Off

The detailed design package (Contracts, Hexagonal Architecture, DDL Schema, DTOs, Events, and OpenAPI) is certified complete, machine-enforceable, and mathematically bounded. All findings have been triaged and resolved.

```
Gate Verdict: PASS
Approved for Phase 3 Handover:
Partner A (Juand - Lead Architect): [SIGNED - 2026-10-26 - v1.0 on 2026-10-19; amendments AMD-10..20 confirmed and approved]
Partner B (Juan Andrés Cano - Lead Test Architect): [SIGNED - 2026-10-26 - §6 re-review completed and v1.2 contracts approved]
```

---

## 6. Partner B Re-Review of the v1.0 Package (2026-10-26) — Findings, Triage and Fixes

Lens: adversarial + edge-case hunter, run by the Test Lead before writing any test (a test written against a contradictory clause fails for the wrong reason). Every finding is ACCEPTED; each links to the amendment (AMD-n) in `contracts.md` v1.1 and to the decision entry DEC-12 in `ai-log/decision-log-solu2.md`. Options considered and the chosen one are recorded in DEC-12.

| Finding | Lens | Severity | Defect in v1.0 | Triage | Fix (artifact) |
|:---:|:---:|:---:|---|:---:|---|
| **REV-DET-07** | Adversarial | HIGH | Op1 P3 raised 429 on overflow while Q1 reported `dropped_count`; GAP-06 said "FIFO drop"; `Q-fail` ignored P3. The P0 storm test had no single expected behavior. | **ACCEPT & FIXED** | AMD-1: tail-drop, `accepted+dropped = events.length`, 429 only at 0 free slots (`contracts.md` Op1 P3/Q1/Q-fail; `openapi.yaml` 200/429; `dto.ts`). |
| **REV-DET-08** | Adversarial | HIGH | Cold start was both error 412 (P2) and result status `SUPPRESSED_COLD_START` (Q1); `ARCHITECTURE.md` AD-03 already specified the status. | **ACCEPT & FIXED** | AMD-2: result status only; `ERR_COLD_START_INSUFFICIENT_SAMPLES` removed (`contracts.md` Op2 Q2 step 1; `openapi.yaml` 412 removed). |
| **REV-DET-09** | Edge-Case | HIGH | `incident_key` embedded the hour: an incident crossing an hour boundary produced a second active alert, violating I1; DDL index keyed on `incident_key`, GAP-04 had required `(node_id, trigger_rule)`. | **ACCEPT & FIXED** | AMD-3: `idx_unique_active_alert (trigger_rule, node_id) WHERE resolved_at_ms IS NULL`, `incident_key UNIQUE` per incident (`001_observability_schema.sql`). Verified on SQLite 3.45: 2nd active row rejected, re-insert after resolve accepted, `ON CONFLICT (trigger_rule, node_id) WHERE ... DO NOTHING` returns 1 then 0 rows. |
| **REV-DET-10** | Adversarial | MEDIUM | I1/INV-02 fixed 5,529,600 B for 32 series, but INV-08 requires 33 independent GPU series (5,702,400 B). A test asserting 5.53 MB would fail for the wrong reason. The only memory bound in the PRD is NFR-05 (128 MB). | **ACCEPT & FIXED** | AMD-4: 33 × 6 × 7,200 × 4 = 5,702,400 B (`contracts.md` I1/INV-02; `ARCHITECTURE.md` §2.2). |
| **REV-DET-11** | Adversarial | MEDIUM | Three catalog codes had no trigger clause (`ERR_UNKNOWN_NODE_ID`, `ERR_DUPLICATE_ACTIVE_ALERT`, `ERR_DATABASE_UNAVAILABLE`); regex `ws-gpu-[0-3][0-9]` admitted `ws-gpu-00` and `ws-gpu-32..39`. | **ACCEPT & FIXED** | AMD-5: regex narrowed to the 32 registered nodes (contract, DTO, OpenAPI, DDL CHECK on `operational_alerts.node_id`); 2 codes removed; `ERR_DATABASE_UNAVAILABLE` bound to Q-fail of all 3 operations; `ErrorCodeType` union added. Catalog: 11 → 8. |
| **REV-DET-12** | Adversarial | LOW | Latency budgets cited NFR-01/05, NFR-03 and NFR-04 for things those NFRs do not say (NFR-04 is heartbeat precision; report latency is NFR-06). | **ACCEPT & FIXED** | AMD-6: budgets labelled "design budget" with the correct derivation (`contracts.md`). |
| **REV-DET-13** | Edge-Case | LOW | Temperature range: contract/DTO/OpenAPI `[-20, 120]`, `ARCHITECTURE.md` §3.1 `20–115`, DDL bucket bounds `-50..150`. | **ACCEPT & FIXED** | AMD-7: single source `[-20.0, 120.0]` (`ARCHITECTURE.md`, DDL `chk_telemetry_bounds`). |
| **REV-DET-14** | Adversarial | MEDIUM | Op3 I2 required an exact sum, DDL allowed `busy + idle <= 1.0001`; a node in `SILENT_TIMEOUT` (ws-gpu-22) had nowhere to be counted. Report scan size used 32 nodes (5,376) instead of 33 GPUs (5,544; PRD line 92 already distinguishes both). | **ACCEPT & FIXED** | AMD-8: `gpu_hours_unavailable` column, `CHECK ABS(busy+idle+unavailable-1.0) <= 0.001`, `summary.unavailable_gpu_hours`, scan bound 5,544, utilization % defined (`contracts.md` Op3, DDL, `dto.ts`, `openapi.yaml`). |
| **REV-DET-15** | Adversarial | HIGH | `SlidingWindowDTO` carried only configuration (30/300/100); the contract never said where the ≥50 samples, the histogram or the token totals come from; Op1 never validated or stored `inference_metrics`. Op2 was not testable as a function. | **ACCEPT & FIXED** | AMD-9: `SlidingWindowDTO` carries `short_histogram`, `long_histogram` and token totals; Op1 validates and folds `inference_metrics`; P99 and spike ratio formulas defined (`contracts.md`, `dto.ts`, `openapi.yaml`, `ports-and-adapters.md`). |

**Verification evidence for the fixes:** `001_observability_schema.sql` executed on SQLite 3.45.1 with positive and negative inserts for INV-05, INV-06 and the `node_id` CHECK; `dto.ts` compiled with `tsc --strict` (0 errors); `openapi.yaml` parsed with 0 unresolved `$ref`.

### 6.1 Observations resolved by the pair decision (2026-10-26)

| ID | Observation | Decision | Fix |
|:---:|---|:---:|---|
| **OBS-1** | Op2 Q2 specified only the token rule, but P1 and the DDL admitted two more; `THERMAL_CRITICAL_THRESHOLD` has no FR in the PRD. | **ACCEPT (AMD-10)** | Op2 P1 admits only `TOKEN_SPIKE_AND_LATENCY_BREACH`; `THERMAL_CRITICAL_THRESHOLD` removed from DDL/DTO/OpenAPI; `NODE_HEARTBEAT_TIMEOUT` stays in the alerts table for `NodeHeartbeatWatchdog`. |
| **OBS-2** | The 3-cycle hysteresis had no persisted counter. | **ACCEPT (AMD-11)** | Columns `consecutive_clear_cycles` (CHECK 0..3) and `last_cycle_index`; one conditional UPDATE per 5,000 ms cycle (verified on SQLite: duplicate call in the same cycle changes nothing, third cycle resolves). Persisted, not in-memory, for the reason recorded in DEC-10. |
| **OBS-3** | `decimation_bucket_id` named one GPU but a batch spans many. | **ACCEPT (AMD-12)** | `BUCKET-<bucket_start_ms>`, `bucket_start_ms = floor(ingested_at_ms / 250) * 250`. |
| **OBS-4** | `is_empty` used "zero jobs recorded". | **ACCEPT (AMD-13)** | `scanned_buckets_count = 0 OR (utilized_gpu_hours = 0 AND total_prompt_tokens = 0 AND total_completion_tokens = 0)`. |

### 6.2 Defect found during Phase 3 (2026-10-26)

| Finding | Lens | Severity | Defect | Triage | Fix |
|:-:|:-:|:-:|---|:-:|---|
| **REV-DET-16** | Edge-Case | HIGH | With the short window inside the long window (AMD-9), `Throughput(short) / Throughput(long) = 10·S/L <= 10.0`: the 10x alarm can only fire if all tokens of the last 300 s fell in the last 30 s. The same flaw is in `ARCHITECTURE.md` AD-03 from Plan-2. Found while building the data for `C2-Q1a`. | **ACCEPT (Partner B, 2026-10-26) - AMD-14 + AMD-14b; confirmed by Partner A, 2026-10-26** | Baseline = `(long_window_prompt_tokens - short_window_prompt_tokens) / 270` (`contracts.md` Op2 Q2 step 2 and Time, `ARCHITECTURE.md` section 2.3, `dto.ts`). Decision record: DEC-14. |

### 6.3 Defects found while closing the Phase 4 readiness audit (2026-10-26)

The audit question "could a developer implement these stories without inventing decisions nothing records?" and the check "every UX state has a backing contract + DTO" produced these findings. All ACCEPTED; each is fixed in the artifacts before the gate.

| Finding | Lens | Severity | Defect | Triage | Fix |
|:-:|:-:|:-:|---|:-:|---|
| **REV-DET-17** | Adversarial | LOW | PRD FR-01 validated temperature 20.0-115.0 while `contracts.md` Op1 P1, `dto.ts`, OpenAPI and the DDL use -20.0-120.0. | **ACCEPT - FIXED** | `prd.md` FR-01 amended (note in place). |
| **REV-DET-18** | Adversarial | LOW | PRD FR-02 inputs used `model_name`, `queue_wait_ms`, `timestamp`; `InferenceMetricPacketDTO` uses `model_id`, `queue_duration_ms`, `timestamp_ms` (+ `node_id`, `gpu_index`, `academic_subject`, `inference_duration_ms`). | **ACCEPT - FIXED** | `prd.md` FR-02 inputs aligned to the DTO. |
| **REV-DET-19** | Adversarial | MEDIUM | PRD FR-02 output promised `impacted_models` and `active_queue_depth`; no contract produces them. | **ACCEPT - FIXED** | `prd.md` FR-02 output aligned to `AnomalyAlertPayloadDTO` (`saturated_nodes`, `primary_subject`); queue depth recorded as deferred. |
| **REV-DET-20** | Edge-Case | HIGH | FR-04 requires "Peak Contention Window"; `ExecutiveReportDTO` had no such field. | **ACCEPT - FIXED (AMD-15)** | `peak_contention_windows` in contract Op3 Q1b, `dto.ts`, OpenAPI; test `C3-Q1c`. |
| **REV-DET-21** | Adversarial | HIGH | FR-03 / scenario 3 (frozen snapshot, 50-line log tail, job, timeline, cordon hint) had no contract, DTO, endpoint or table (TG-4). | **ACCEPT - FIXED (AMD-16)** | Operation 4 `getNodeForensics`, capture clause, `node_forensics` table with `CHECK json_array_length(log_tail_json) <= 50`, errors `ERR_UNKNOWN_NODE_ID` and `ERR_NODE_HEALTHY`; 16 tests `C4-*` + `S-04c/d`. |
| **REV-DET-22** | Adversarial | HIGH | The heatmap (FR-01), Storm Mode (FR-05) and STALE_CACHED cells had no backing DTO: `UiDispatchPort` carried only a count. | **ACCEPT - FIXED (AMD-18)** | `FleetSnapshotDTO` / `FleetCellDTO` (`dto.ts`, OpenAPI, events.md `ui.fleet.snapshot`), Op1 Q2c; tests `C1-Q5a/b/c`. |
| **REV-DET-23** | Edge-Case | MEDIUM | `batch_id` idempotency had no storage (TG-1): a developer would choose between memory and a table. | **ACCEPT - FIXED (AMD-19)** | Table `ingested_batches`, `INSERT OR IGNORE`, 1-hour replay window; test `S-01f`. |
| **REV-DET-24** | Edge-Case | MEDIUM | `hour_epoch` unit was ambiguous (seconds vs ms); `NodeRollupDTO` average temperature/utilization and `SubjectBreakdownDTO.allocated_gpu_hours` / `share_pct` could not be computed from `rollup_hourly_metrics` (TG-2, TG-3). | **ACCEPT - FIXED (AMD-20)** | Unit documented in DDL and contract; the two uncomputable fields removed; `allocated_gpu_hours` and token-based `share_pct` defined and asserted in `C3-Q1a`. |
| **REV-DET-25** | Adversarial | LOW | Two sources of node state: `cluster_nodes.current_state` and `node_heartbeats.state` (TG-5). | **ACCEPT - FIXED** | DDL comment: `node_heartbeats.state` is the live source; `cluster_nodes.current_state` is a seed value only. |
| **REV-DET-26** | Edge-Case | MEDIUM | PRD FR-02 runs the evaluation every 1,000 ms; the contract's hysteresis counts 5,000 ms cycles; nobody owned the loop (TG-9). | **ACCEPT - FIXED (AMD-17)** | `MonitoringPort.tick()` every 1,000 ms; counter advances once per 5,000 ms cycle; story 3.4. |

### 6.4 Defects found while reviewing the trade-offs (2026-10-26)

| Finding | Lens | Severity | Defect | Triage | Fix |
|:-:|:-:|:-:|---|:-:|---|
| **REV-DET-27** | Edge-Case | HIGH | With a baseline that excludes only the short window, a surge lasting > 30 s raises the baseline and drops the ratio below 10 while the incident continues; clearing on "no breach" would resolve a live incident. | **ACCEPT - FIXED (AMD-14b)** | Clearing counts cycles with P99 <= 8,000 ms regardless of the ratio; `C2-Q2i`, `D-ENG-f`. |
| **REV-DET-28** | Edge-Case | MEDIUM | Events dropped by the capacity rule recorded no heartbeat: a live node at the end of a batch could be flagged STALE / SILENT_TIMEOUT. | **ACCEPT - FIXED (AMD-17b)** | Dropped events are heartbeats; rejected batches are not; `C1-Q2d`, `C1-Q2e`. |
| **REV-DET-29** | Adversarial | MEDIUM | Heatmap cells showed the window average of temperature and VRAM, hiding short peaks the PRD bands by threshold; `storm_mode` counted accepted events instead of the PRD's arrival rate. | **ACCEPT - FIXED (AMD-18b)** | Window maximum for both; arrivals for the storm flag; `C1-Q5a`. |
| **REV-DET-30** | Adversarial | LOW | Pruning `ingested_batches` every window would scan the table; `hour_epoch` hid a seconds-vs-milliseconds unit. | **ACCEPT - FIXED (AMD-19, AMD-20)** | `idx_ingested_batches_time` (`S-01g`); column renamed `hour_epoch_s`. |
