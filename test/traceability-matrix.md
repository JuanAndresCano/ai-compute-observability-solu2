# Traceability Matrix — Module 11

**Phase:** 3, Step 3.6 (re-run after Phase 4 to fill the Story column) · **Author:** Partner B · **Date:** 2026-10-26
**Checked by machine:** `npm run trace:check` fails if a Test ID below does not exist in the code, if a test tag in the code is missing here (orphan test), if an AD-n has no test, if an Invariant-Binding-Table test name is missing, or if an FR has no row.

Status: `RED` = ATDD case that must fail with `NotImplementedError` until implemented · `GREEN` = physical-schema or architecture test that passes today and turns red if the rule is removed · `GAP` = requirement with no test possible yet (see `test/test-design.md` §4).
Scenario: S1 telemetry stream, S2 token spike alert, S3 unhealthy node drill-down, S4 executive report (`ux/C-UX-Scenarios/`).
Story: `TBD-P4` until `epics.md` exists (Phase 4).

| PRD FR / NFR | Scenario | AD-n | Contract clause | Test IDs | Story | Status |
|---|:-:|:-:|---|---|:-:|:-:|
| FR-01 | S1 | AD-01 | Op1 **P1** valid payload (events + inference metrics) | C1-P1a, C1-P1b, C1-P1c | TBD-P4 | RED |
| FR-01 | S1 | AD-01 | Op1 **P1** physical bounds in the schema (temperature -20..120, utilization, min ≤ max) | S-01d, S-01e | TBD-P4 | GREEN |
| FR-01 | S1 | AD-01 | Op1 **P2** clock drift ≤ 5,000 ms | C1-P2a, C1-P2b | TBD-P4 | RED |
| FR-05 | S1 | AD-01 | Op1 **P3** capacity rule (0 free → 429; partial → tail-drop) | C1-P3a, C1-Q3b, C1-EDGE-b | TBD-P4 | RED |
| FR-01 | S1 | AD-01 | Op1 **Q1** result schema, bucket id | C1-Q1a, C1-Q1b | TBD-P4 | RED |
| FR-01 | S1 | AD-01, AD-08 | Op1 **Q2** window statistics, idempotent persistence, inference histogram | C1-Q2a, C1-Q2b, C1-Q2c, D-DEC-a, D-DEC-b | TBD-P4 | RED |
| FR-01 | S1 | AD-01 | Op1 **Q3** audit event + dropped counter | C1-Q3a, C1-Q3b | TBD-P4 | RED |
| FR-01 | S1 | AD-01 | Op1 **Q4** explainability (AD-01 rule id, observed rate, free slots) | C1-Q4 | TBD-P4 | RED |
| FR-01 | S1 | AD-01 | Op1 **Q-fail** zero mutation, storage failure 503 | C1-P1b, C1-Qfail | TBD-P4 | RED |
| FR-05, NFR-05 | S1 | AD-02 | Op1 **I1** static 5,702,400 B ring buffer | C1-I1a, D-RING-a | TBD-P4 | RED |
| FR-05 | S1 | AD-01 | Op1 **I2** ≤ 4 dispatches / s | C1-I2, D-DEC-c | TBD-P4 | RED |
| FR-01 | S1 | AD-08 | Op1 **I1** (INV-08) two GPUs tracked independently | C1-I1b, D-DEC-d, S-08a, S-08b, S-08c, S-08d, S-08e, S-01c | TBD-P4 | RED + GREEN |
| NFR-01 | S1 | AD-01 | Op1 **Concurrency / idempotency** | C1-CON-a, C1-CON-b, S-01a, S-01b | TBD-P4 | RED + GREEN |
| NFR-01 | S1 | AD-01 | Op1 **Time** half-open 250 ms | C1-TIME | TBD-P4 | RED |
| FR-05 (P0 Mandatory Edge Case) | S1 | AD-01, AD-02, AD-05 | 5,000 ev/s storm: 4 Hz, static memory, visible drops, alert bypass | C1-EDGE-a, C1-EDGE-b, C1-EDGE-c | TBD-P4 | RED |
| FR-02 | S2 | AD-03 | Op2 **P1** valid rule / window / histograms | C2-P1 | TBD-P4 | RED |
| FR-02 | S2 | AD-03 | Op2 **Q1** result schema, TRIGGERED / CLEARED | C2-Q1a, C2-Q1b | TBD-P4 | RED |
| FR-02 | S2 | AD-03 | Op2 **Q2 step 1** cold start < 50 samples (INV-03) | C2-Q2c, C2-Q2d, C2-Q2e, D-ENG-b | TBD-P4 | RED |
| FR-02, NFR-03 | S2 | AD-03 | Op2 **Q2 step 2** baseline, ratio ≥ 10.0, P99 > 8,000 (AMD-14) | C2-Q2a, C2-Q2b, C2-PURE, C2-I2a, C2-I2b, D-ENG-a, D-ENG-c, D-ENG-d, D-ENG-e, D-HIST-a, D-HIST-b, D-HIST-c | TBD-P4 | RED |
| FR-02 | S2 | AD-05 | Op2 **Q2 step 3** atomic insert, one active alert (INV-05) | C2-I1a, C2-I1c, S-05a, S-05b, S-05e | TBD-P4 | RED + GREEN |
| FR-02 | S2 | AD-05 | Op2 **Q2 steps 4-5** 3-cycle persisted hysteresis | C2-Q2f, C2-Q2g, C2-Q2h, C2-I1b, S-05g, S-05h | TBD-P4 | RED + GREEN |
| FR-02 | S2 | AD-05 | Op2 **I1** recurrence after resolution, unique incident key | C2-I1d, S-05c, S-05d, S-05f | TBD-P4 | RED + GREEN |
| FR-02 | S2 | AD-03 | Op2 **Q4** explainability (triggered and suppressed) | C2-Q4a, C2-Q4b | TBD-P4 | RED |
| FR-02 | S2 | AD-03 | Op2 **Time** half-open windows | C2-TIME | TBD-P4 | RED |
| FR-02 | S2 | AD-03 | Op2 **Q-fail** storage failure | C2-Qfail | TBD-P4 | RED |
| FR-03, NFR-04 | S3 | AD-04 | Watchdog states at 5.0 s / 15.0 s, once-only report, 3-heartbeat recovery, no flapping (INV-04) | W-1, W-2, W-3, W-4, D-WD-a, D-WD-b, S-04a, S-04b | TBD-P4 | RED + GREEN |
| FR-03 | S3 | AD-04 | Forensic drill-down payload (last 50 stderr lines, timeline) | *none — no contract* (TG-4) | TBD-P4 | GAP |
| FR-04 | S4 | AD-06 | Op3 **P1** date range ≤ 168 h | C3-P1a, C3-P1b | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **P2** no future query | C3-P2 | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **P3** subject filter | C3-P3 | TBD-P4 | RED |
| FR-04, NFR-06 | S4 | AD-06 | Op3 **Q1** totals, per-subject, per-GPU | C3-Q1a, C3-Q1b | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **Q2** read-only, hourly rollups only (INV-06) | C3-Q2, C3-I1 | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **Q3** audit event + counter | C3-Q3 | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **Q4** explainability, typed error content | C3-Q4a, C3-Q4b | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **Empty state** (Loading/Empty/Error/Success/Denied needs a contract) | C3-EMPTY-a, C3-EMPTY-b | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **I2** hours add up, outage is unavailable not idle | C3-I2a, S-06a, S-06b, S-06c, S-06d | TBD-P4 | RED + GREEN |
| FR-04 | S4 | AD-06 | Op3 **Concurrency** idempotent read | C3-CON | TBD-P4 | RED |
| FR-04 | S4 | AD-06 | Op3 **Q-fail** storage failure | C3-Qfail | TBD-P4 | RED |
| NFR-08 | S1-S4 | AD-07 | Standalone: zero network I/O, pure domain, injected clock | X-AD07, A-R1, A-R2, A-R3, A-R4, A-R5 | TBD-P4 | RED + GREEN |
| NFR-02 | S1 | AD-01 | Render latency | *none — UI* (see nfr-evidence N-02) | TBD-P4 | GAP |
| NFR-07 | S1-S4 | — | WCAG 2.1 AA | *none — UI* (see nfr-evidence N-07) | TBD-P4 | GAP |

## Invariant Binding Table ↔ test names (contracts.md section 3)

| Invariant | AD-n | Test name bound in contracts.md | Exists in suite | Also turns red via |
|:-:|:-:|---|:-:|---|
| INV-01 | AD-01 | `test_ingestion_enforces_4hz_dispatch_cap_under_5000_ev_storm` | ✔ | C1-EDGE-a |
| INV-02 | AD-02 | `test_ring_buffer_memory_remains_static_after_100k_events` | ✔ | D-RING-a |
| INV-03 | AD-03 | `test_cold_start_suppresses_anomaly_alarm_below_50_samples` | ✔ | D-ENG-b |
| INV-04 | AD-04 | `test_node_ws22_transitions_to_silent_timeout_after_15s` | ✔ | D-WD-a, S-04a |
| INV-05 | AD-05 | `test_alert_fires_exactly_once_per_incident_until_cleared` | ✔ | S-05a, S-05b |
| INV-06 | AD-06 | `test_7day_report_queries_strictly_hourly_rollups_not_raw` | ✔ | S-06b |
| INV-07 | AD-07 | `test_standalone_execution_requires_zero_cloud_network_io` | ✔ | A-R1 |
| INV-08 | AD-08 | `test_server_gpu01_tracks_dual_gpus_independently_without_averaging` | ✔ | S-08b |

## P0 risks ↔ tests (test-design.md §1)

| Risk | Pri | Red or guarding tests (see rows above) |
|:-:|:-:|---|
| R-01 storm | P0 | C1-EDGE-a, C1-EDGE-b, C1-EDGE-c, C1-I2, C1-P3a, C1-Q3b |
| R-02 alarm can never fire | P0 | C2-Q1a, C2-Q2a, C2-PURE, D-ENG-a, D-ENG-d |
| R-03 alert storm | P0 | C2-I1a, C2-I1b, C2-I1c, C2-I1d, C2-Q2f, S-05a |
| R-04 silent node | P0 | W-1, W-2, W-3, W-4, D-WD-a, D-WD-b |
| R-05 ring buffer | P0 | C1-I1a, D-RING-a, C1-EDGE-a |
| R-06 report accuracy | P0 | C3-Q1a, C3-Q1b, C3-I2a, C3-EMPTY-a, S-06b |
