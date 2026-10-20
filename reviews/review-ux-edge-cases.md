# Edge-Case Hunter Review: UX & Interface Specifications
## Target Directory: `ux/` (`DESIGN.md`, `EXPERIENCE.md`, `C-UX-Scenarios/*`, `wireframes/*`)
**Review Lens:** Edge-Case Hunter & UI Failure Modes  
**Auditor Persona:** BMad Review Agent / Lead UX Systems Specialist  
**Reviewed By:** Juand & Freya  
**Date:** 2026-09-28  
**Status:** TRIAGED & CLOSED

---

## 1. Executive Summary
This review systematically probes the UX specifications for failure states, accessibility violations, layout breaking points during telemetry floods, and operator fatigue hazards.

---

## 2. Edge-Case Findings & Triage Matrix

| ID | Category | Severity | UX Edge-Case Finding / Failure Scenario | Triage Decision | Engineering & Design Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **EDGE-UX-01** | **Layout & Storm** | HIGH | **DOM Lag during 5,000 ev/s Storm:** If every metric stream frame updates individual DOM nodes, React virtual DOM reconciliation locks up the browser main thread. | **ACCEPT** | **Fixed in `scenario-1.md` & `DESIGN.md`:** Decoupled raw telemetry from the DOM using Web Worker decimation. UI updates are capped at a strict 4 Hz tick rate, rendering pre-computed `{min, max, avg}` bucket tuples. |
| **EDGE-UX-02** | **Interaction / Modal** | HIGH | **Blocking Modal locks Liam out during Cluster Crisis:** The AI initially recommended presenting the Token Spike Alert as a centered blocking pop-up modal. | **REJECT** | **Engineering Rationale:** Rejected by human engineer. In a live production outage, blocking modals prevent engineers from clicking node heatmaps or inspecting queues. Enforced a non-blocking persistent header banner with an expandable drawer (`scenario-2.md`). |
| **EDGE-UX-03** | **Hardware Disparity** | MEDIUM | **Server 2-GPU Visual Squishing:** Workstations have 1 GPU; `server-gpu-01` has 2 GPUs. If forced into standard 1x card width, metrics become unreadable. | **ACCEPT** | **Fixed in `DESIGN.md` & Wireframes:** Designed a dedicated 2x double-width card ($290\text{px}$) with split side-by-side sub-cards for GPU-0 and GPU-1, preventing data truncation. |
| **EDGE-UX-04** | **Flapping State** | MEDIUM | **Node Flapping Alert Storm:** If `ws-gpu-22` oscillates online/offline every 5 seconds, the UI will flash violently between Green and Purple, inducing operator disorientation. | **ACCEPT** | **Fixed in `scenario-3.md`:** Implemented a state-hysteresis rule: transition from `SILENT` to `NORMAL` requires 3 consecutive successful heartbeats ($15\text{ s}$), entering an intermediate yellow `RECOVERING` state first. |
| **EDGE-UX-05** | **Executive UX** | LOW | **3D Charting for Executive 7-Day View:** The AI suggested interactive 3D WebGL bar charts for Department Management. | **REJECT** | **Engineering Rationale:** Rejected by human engineer. 3D charts are visually ambiguous, distort data comparisons, consume excessive GPU memory, and fail WCAG 2.1 AA keyboard navigation. Clean 2D monospace tables and high-contrast horizontal bars adopted. |

---

## 3. Triage Summary & Sign-off

* **Total Findings Evaluated:** 5
* **Accepted (Incorporated into Specs):** 3
* **Rejected (Documented Human Rationale):** 2
* **Deferred (Post-V1):** 0
* **Audit Verdict:** **PASS (Fully Triaged and Closed)**
