# Edge-Case Hunter Review: Technical Architecture & Invariants
## Target Artifact: `planning/ARCHITECTURE.md`
**Review Lens:** Architectural Edge Cases, Boundary Violations & Failure Modes  
**Auditor Persona:** BMad Review Agent / Lead Reliability Engineer Lens  
**Reviewed By:** Liam & Juand  
**Date:** 2026-10-19  
**Status:** TRIAGED & CLOSED

---

## 1. Executive Summary
This review systematically probes the technical architecture for edge-case vulnerabilities, including flapping network nodes, division-by-zero during cold starts, composite key collisions on heterogeneous hardware, and buffer saturation under prolonged metric storms.

---

## 2. Architectural Edge-Case Findings & Triage Matrix

| ID | Category | Severity | Edge-Case Finding / Failure Vector | Triage Decision | Technical Resolution & Invariant Link |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EDGE-ARCH-01** | **Network Flapping** | HIGH | **Rapid Online/Offline Flapping of `ws-gpu-22`:** If a degraded node re-establishes network connectivity for a single 50ms pulse every 5 seconds, a naïve watchdog will constantly bounce between `HEALTHY` and `SILENT_TIMEOUT`, triggering an alert storm. | **ACCEPT** | **Fixed in Architecture (AD-04):** Implemented a state-machine hysteresis rule: moving from `SILENT_TIMEOUT` to `HEALTHY` requires 3 consecutive uninterrupted valid heartbeats ($15.0\text{ s}$ total), holding the node in an intermediate `RECOVERING` state until stability is proven. |
| **EDGE-ARCH-02** | **Cold Start / Zero Div** | HIGH | **Zero-Division in Anomaly Spike Ratio:** If the cluster starts from an idle state where prompt throughput is 0 tokens/s, the first batch of 100 tokens creates an infinite ($\infty$) spike factor, triggering a false critical alarm. | **ACCEPT** | **Fixed in Architecture (AD-03):** Cold-start suppression rule strictly enforces that the baseline window must accumulate at least 50 valid request samples before the 10x ratio is evaluated. |
| **EDGE-ARCH-03** | **Hardware Heterogeneity** | MEDIUM | **Central Server GPU Index Overwrite:** The central server has 2 GPUs (48 GB each). If the metric generator emits telemetry keyed only by `node_id = "server-gpu-01"`, GPU-1 metrics will overwrite GPU-0 in the ring buffer. | **ACCEPT** | **Fixed in Architecture (AD-08):** Formulated an invariant requiring a composite primary key `(node_id, gpu_index)` across all internal data schemas, buffer storage arrays, and UI state mappings. |
| **EDGE-ARCH-04** | **Data Corruption** | MEDIUM | **Clock Rollover / Out-of-Order Packets during Storm:** During a 5,000 ev/s storm, network jitter can cause packets to arrive out of chronological order, corrupting sliding window rate calculations. | **ACCEPT** | **Fixed in Architecture (Section 2.1):** Web Worker bucket queues sort incoming events by monotonic generator timestamp (`timestamp_ms`) before committing to the 250ms decimation bucket, discarding packets older than 2,000 ms as stale. |
| **EDGE-ARCH-05** | **Cloud Integration** | LOW | **Cloud Backup of Ring Buffer State:** The AI proposed streaming ring buffer snapshots to an S3-compatible cloud object store every 60 seconds. | **REJECT** | **Engineering Rationale:** Rejected by human engineer. The console is an on-premise academic workstation tool designed for standalone local operation. External cloud dependencies violate the assignment boundaries (AD-07). |

---

## 3. Triage Summary & Sign-off

* **Total Findings Evaluated:** 5
* **Accepted (Fixed in Architecture):** 4
* **Rejected (Documented Human Rationale):** 1
* **Deferred (Post-V1):** 0
* **Audit Verdict:** **PASS (Fully Triaged and Closed)**
