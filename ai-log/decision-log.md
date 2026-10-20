# AI Decision & Governance Log
## Project: AI-Assisted Product Planning for the Academic AI Compute Fabric
### Module 11: AI Infrastructure Observability Console
**Lead Human Engineers:** Juand (Lead System Architect & Product Owner)  
**AI Assistants:** BMad Agent Council (John / PM, Freya / UX, Winston / Architect, Murat / TEA, BMad Reviewer)  
**Total Entries Logged:** 8 Detailed Entries (Phases 1 through 4 Completed — Fully Certified)

---

## Decision Matrix & Human Governance Overview

| Entry ID | Phase | Decision Topic | AI Recommendation | Human Decision & Intervention | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEC-01** | Phase 1 (PRD) | System Boundaries & Telemetry Storage | Deploy external distributed Prometheus & TimescaleDB cloud cluster. | **REJECTED AI PROPOSAL:** Enforced standalone in-memory ring buffer with pre-aggregated 1-hour rollups. | **ADOPTED** |
| **DEC-02** | Phase 1 (PRD) | Ingestion under 5,000 ev/s Storm | Standard HTTP Polling every 500 ms and direct unthrottled DOM state insertion. | **REJECTED AI PROPOSAL:** Enforced WebSocket push with client-side bucket downsampling (250 ms) in Web Worker. | **ADOPTED** |
| **DEC-03** | Phase 1 (Review) | Scope of Alerting & Automated Remediation | Execute automated remote SSH node reboot/cordon and trigger audible alarm sirens. | **REJECTED AI PROPOSAL:** Confined module strictly to read-only observability and high-contrast visual explainability banners. | **ADOPTED** |
| **DEC-04** | Phase 2 (UX) | Console Layout & Density Paradigm | Mobile-first responsive card carousel with heavy 3D WebGL computer models. | **REJECTED AI PROPOSAL:** Enforced desktop-first high-density monospace matrix (8x4 grid) with 2x width server slot. | **ADOPTED** |
| **DEC-05** | Phase 2 (UX) | Critical Anomaly Alert Ergonomics | Modal pop-up dialog that disables background interaction until dismissed. | **REJECTED AI PROPOSAL:** Mandated non-blocking persistent top banner with slide-over root-cause explainability drawer. | **ADOPTED** |
| **DEC-06** | Phase 3 (Arch) | Buffer Memory & Concurrency Strategy | Standard dynamic JS arrays (`Array.push`) in global React store with `filter()`. | **REJECTED AI PROPOSAL:** Mandated pre-allocated `Float32Array` circular ring buffer (7,200 slots) in Web Worker. | **ADOPTED** |
| **DEC-07** | Phase 3 (Arch) | Percentile Estimation & Cloud Dependency | Offload P99 calculation to external cloud API or compute naive arithmetic mean. | **REJECTED AI PROPOSAL:** Enforced local deterministic dual-window algorithm with fixed-bucket histogram in Web Worker. | **ADOPTED** |
| **DEC-08** | Phase 4 (Gate) | Readiness Sign-Off & Quality Gate Rigor | Issue provisional PASS while leaving 2 architectural edge-case findings unaddressed. | **REJECTED AI PROPOSAL:** Mandated 100% triage of all 22 review findings before granting formal PASS certification. | **ADOPTED** |

---

## Detailed Audit Entries

### Entry DEC-01: System Boundaries & Standalone Architecture
* **Timestamp:** 2026-09-28T19:20:00-05:00
* **Lifecycle Phase:** Phase 1 — PRD & Capability Scoping
* **Trigger Prompt / Context:** Defining the data persistence model and external dependencies for Module 11 telemetry ingestion and 7-day reporting.
* **AI Generated Proposal:** The AI suggested integrating a full production Prometheus server and an external TimescaleDB/PostgreSQL distributed cluster via network connection to handle 7-day metrics storage.
* **Human Evaluation & Critique:** Juand analyzed the assignment constraints. Constraint #1 explicitly dictates *"Independent Executability: The subsystem must be runnable as a standalone unit using Docker Compose or a clean local virtual environment"*. Mandating external enterprise database clusters introduces heavy runtime overhead, network failure modes, and breaks local portability for grading.
* **Human Action Taken (REJECTION):** Rejected the external database proposal. Instructed the AI to model an in-memory high-resolution circular buffer (30 minutes) combined with pre-aggregated hourly rollup fixtures stored locally in JSON format for the 7-day executive report.
* **Verifiable Evidence in Artifacts:** Enshrined in `planning/prd.md` Section 1.3 (System Boundaries) and Section 3 (FR-04).

---

### Entry DEC-02: Telemetry Ingestion & UI Storm Resilience (5,000 ev/s)
* **Timestamp:** 2026-09-28T19:20:05-05:00
* **Lifecycle Phase:** Phase 1 — PRD Specification (Mandatory Edge Case)
* **Trigger Prompt / Context:** Formulating the ingestion architecture to survive the mandatory edge case of a telemetry storm flooding the console with 5,000 events/second.
* **AI Generated Proposal:** The AI proposed standard HTTP long-polling every 500 ms and pushing all incoming telemetry directly into reactive UI component state.
* **Human Evaluation & Critique:** Juand calculated the compute impact: 5,000 events/second would trigger 5,000 state mutations per second in the JavaScript single-threaded event loop, leading to immediate thread starvation, dropped frames, $> 10\text{ s}$ latency, and browser tab crashes (OOM).
* **Human Action Taken (REJECTION):** Rejected direct unthrottled state insertion and HTTP polling. Mandated a push-based WebSocket ingestion pipeline feeding an isolated Web Worker, where raw events are decanted into $250\text{ ms}$ buckets ($4\text{ Hz}$ UI dispatch) and mathematically summarized as `{min, max, avg, count}`.
* **Verifiable Evidence in Artifacts:** Formulated in `planning/prd.md` FR-05, NFR-01, NFR-02, and NFR-05.

---

### Entry DEC-03: Scope Control on Cordoning and Audio Alarms
* **Timestamp:** 2026-09-28T19:21:00-05:00
* **Lifecycle Phase:** Phase 1 — PRD Adversarial Review
* **Trigger Prompt / Context:** Reviewing adversarial findings on silent node `ws-gpu-22` and the $10\times$ token latency alarm.
* **AI Generated Proposal:** The AI suggested adding automated cluster mutation tools (automated SSH daemon reboot of `ws-gpu-22`) and triggering browser audio sirens on P99 latency spikes.
* **Human Evaluation & Critique:** Juand rejected this as scope creep and poor SRE ergonomics. Automatic mutation violates the module boundaries (cordoning belongs to Module 3 Digital Twin). Continuous sound alerts cause operator cognitive fatigue in university environments.
* **Human Action Taken (REJECTION):** Enforced strict read-only diagnostic capability with forensic drill-down for `ws-gpu-22` and high-contrast visual explainability banners for token spikes.
* **Verifiable Evidence in Artifacts:** Documented in `reviews/review-prd-adversarial.md` findings ADV-PRD-02 and ADV-PRD-05, and `planning/prd.md` Section 5.

---

### Entry DEC-04: High-Density Monospace Grid vs 3D Mobile Carousel
* **Timestamp:** 2026-09-28T19:23:00-05:00
* **Lifecycle Phase:** Phase 2 — UX Design Spines (`ux/DESIGN.md`)
* **Trigger Prompt / Context:** Choosing the visual layout and interaction pattern for displaying the 32 cluster nodes (33 GPUs).
* **AI Generated Proposal:** The AI proposed a mobile-responsive layout featuring individual workstation cards in a scrolling carousel with Three.js / WebGL 3D rotating graphics of workstation towers.
* **Human Evaluation & Critique:** Juand evaluated this against Liam's persona. Systems engineers operate multi-monitor desktop environments; hiding 24 of 32 nodes off-screen in a carousel guarantees missed anomalies. Furthermore, WebGL 3D rendering consumes local client GPU resources, directly conflicting with the goal of lightweight observability.
* **Human Action Taken (REJECTION):** Rejected mobile carousels and 3D graphics. Enforced a desktop-first $8 \times 4$ high-density monospace grid where all 32 nodes are visible concurrently. Mandated a dedicated double-width ($2\text{x}$) slot for the central server (`server-gpu-01`) to expose its dual 48 GB GPUs independently without numerical averaging.
* **Verifiable Evidence in Artifacts:** Embodied in `ux/DESIGN.md` Section 1 & 3, `ux/C-UX-Scenarios/scenario-1.md`, and `ux/wireframes/wireframe-telemetry-heatmap.md`.

---

### Entry DEC-05: Non-Blocking Header Banner vs Intrusive Modal Dialog
* **Timestamp:** 2026-09-28T19:24:00-05:00
* **Lifecycle Phase:** Phase 2 — UX Scenarios (`scenario-2.md` & `review-ux-edge-cases.md`)
* **Trigger Prompt / Context:** Determining how the console should surface the automated visual alarm when a 10x token spike causes P99 latency $> 8.0\text{ s}$.
* **AI Generated Proposal:** The AI suggested displaying a centered modal dialog (pop-up) with a dark backdrop overlay that locks keyboard and mouse interaction until the user acknowledges the incident.
* **Human Evaluation & Critique:** Juand identified a severe operational flaw: during an active cluster outage or latency breach, an engineer cannot afford to have their screen locked. Liam must be able to click on individual nodes, inspect queues, and check thermal levels while the alert remains visible.
* **Human Action Taken (REJECTION):** Rejected the blocking pop-up modal. Replaced it with a persistent, non-modal top alert banner with an expandable slide-over drawer for deep explainability metrics, preserving full clickability across the entire 32-node fleet canvas.
* **Verifiable Evidence in Artifacts:** Documented in `ux/C-UX-Scenarios/scenario-2.md`, `reviews/review-ux-edge-cases.md` finding EDGE-UX-02, and `ux/EXPERIENCE.md` Section 3.1.

---

### Entry DEC-06: Pre-Allocated TypedArray Ring Buffer vs Dynamic JS Arrays
* **Timestamp:** 2026-10-19T11:45:00-05:00
* **Lifecycle Phase:** Phase 3 — Technical Architecture (`planning/ARCHITECTURE.md`)
* **Trigger Prompt / Context:** Designing the in-memory metric history storage to withstand continuous high-throughput telemetry without memory leaks.
* **AI Generated Proposal:** The AI proposed storing incoming telemetry objects in standard JavaScript dynamic arrays (`Array.push`), using `setInterval` and `Array.filter` every second to prune entries older than 30 minutes.
* **Human Evaluation & Critique:** Juand analyzed the memory allocation behavior of V8 under a 5,000 ev/s storm. Appending and pruning thousands of dynamic objects per second triggers rapid heap fragmentation and frequent major Garbage Collection (GC) pauses exceeding 100 ms, directly causing UI stutter and risking Out-Of-Memory (OOM) browser tab termination.
* **Human Action Taken (REJECTION):** Rejected dynamic JavaScript arrays. Mandated a statically allocated circular ring buffer using `Float32Array` typed arrays with exactly 7,200 slots per metric (30 minutes at 4 Hz). Write pointers wrap modulo 7,200, achieving zero heap allocations during streaming and bounding memory to $\le 6\text{ MB}$.
* **Verifiable Evidence in Artifacts:** Formalized in `planning/ARCHITECTURE.md` Section 2.2 and Invariant `AD-02`.

---

### Entry DEC-07: Local Dual Sliding-Window Percentiles vs Cloud Microservice
* **Timestamp:** 2026-10-19T11:45:30-05:00
* **Lifecycle Phase:** Phase 3 — Technical Architecture (Scenario 2 Anomaly Detection)
* **Trigger Prompt / Context:** Implementing the calculation of rolling P99 latency and the 10x token spike ratio.
* **AI Generated Proposal:** The AI suggested sending request metrics to an external cloud percentile calculation service via HTTP POST, or alternatively computing a simple arithmetic mean latency in the browser.
* **Human Evaluation & Critique:** Juand rejected both options. Delegating to a cloud service violates the assignment requirement for standalone local execution without external dependencies. Relying on average latency masks high-tail latency degradation ($P_{99}$), which is critical for identifying model worker bottlenecks.
* **Human Action Taken (REJECTION):** Mandated a local, deterministic dual sliding-window evaluator ($W_{\text{short}} = 30\text{ s}$, $W_{\text{long}} = 300\text{ s}$) implemented inside the Web Worker using a fixed 100-bucket histogram ($200\text{ ms}$ resolution) for $O(1)$ percentile extraction.
* **Verifiable Evidence in Artifacts:** Formalized in `planning/ARCHITECTURE.md` Section 2.3, Invariant `AD-03`, and `reviews/review-arch-adversarial.md` finding ADV-ARCH-05.

---

### Entry DEC-08: Readiness Gate Sign-Off Rigor & Zero Untriaged Blockers
* **Timestamp:** 2026-10-19T11:47:00-05:00
* **Lifecycle Phase:** Phase 4 — Implementation Readiness Gate Check
* **Trigger Prompt / Context:** Evaluating whether the planning package could be certified for PASS with two non-triaged edge cases flagged during architecture review.
* **AI Generated Proposal:** The AI suggested bypassing the untriaged findings to quickly generate the sign-off report, arguing that they were minor edge conditions.
* **Human Evaluation & Critique:** Juand enforced strict engineering gate discipline. The rubric states: *"Before running this check, ensure all review findings from phases 1, 2, and 3 have been triaged — the readiness check will flag untriaged findings as blockers"*. Issuing a PASS with untriaged findings risks critical architecture flaws during future implementation.
* **Human Action Taken (REJECTION):** Halted premature sign-off. Formally evaluated, resolved, and documented all 22 findings across all 4 review artifacts before running the readiness audit and certifying the formal PASS sign-off.
* **Verifiable Evidence in Artifacts:** Documented in `planning/readiness-gate-report.md` Section 3 and the sign-off certification block.
