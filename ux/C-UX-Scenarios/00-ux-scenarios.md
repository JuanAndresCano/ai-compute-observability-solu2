# UX Scenarios Index & Coverage Matrix
## Module 11: AI Infrastructure Observability Console
**Design Framework:** Whiteport Design Studio (WDS v0.4.3)  
**Authors:** Freya (WDS Designer) & Juand (Lead Human Engineer)

---

## 1. Executive Scenario Coverage Matrix

The 4 mandatory scenarios defined in the Task Statement Annex for Module 11, along with the mandatory edge case, are mapped to personas, functional requirements, visual surfaces, and edge states below:

| Scenario ID | Title | Protagonist | Target Surface | Linked PRD FR | Key Trigger / Precondition | Critical Edge Case Handled | Spec File Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UX-SC-01** | **Real-Time Telemetry Stream** | Liam (Lead Cloud Engineer) | 32-Node Fleet Matrix Heatmap | `FR-01`, `NFR-01`, `NFR-02` | Stream connection opened; metrics emitted by 32 nodes at $\ge 4\text{ Hz}$. | Heterogeneous server mapping (dual-GPU vs single-GPU nodes) without layout collapse. | [scenario-1.md](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Plan-2%20Task%20Statement%20Pairs/ux/C-UX-Scenarios/scenario-1.md) |
| **UX-SC-02** | **Token Spike & Latency Alert** | Liam (Lead Cloud Engineer) | Persistent Alert Header & Anomaly Drawer | `FR-02`, `NFR-03` | Prompt tokens jump $\ge 10\times$ causing $P_{99} \text{ latency} > 8.0\text{ s}$. | Cold start false-positive suppression; non-blocking non-modal alert. | [scenario-2.md](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Plan-2%20Task%20Statement%20Pairs/ux/C-UX-Scenarios/scenario-2.md) |
| **UX-SC-03** | **Unhealthy Node Drill-Down** | Liam (Lead Cloud Engineer) | Forensic Node Inspector Drawer | `FR-03`, `NFR-04` | Node `ws-gpu-22` misses $\ge 3$ consecutive heartbeats ($\ge 15.0\text{ s}$). | Preservation of last 50 stderr log lines and job metadata after node goes silent. | [scenario-3.md](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Plan-2%20Task%20Statement%20Pairs/ux/C-UX-Scenarios/scenario-3.md) |
| **UX-SC-04** | **Executive Utilization Reporting** | Department Management (Dr. Rebecca Reed / Dean Morales) | Executive Summary View & Export Modal | `FR-04`, `NFR-06` | User selects 7-day range and requests compute breakdown. | Instant rendering ($\le 1.5\text{ s}$) using pre-computed hourly rollups without raw log scans. | [scenario-4.md](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Plan-2%20Task%20Statement%20Pairs/ux/C-UX-Scenarios/scenario-4.md) |
| **UX-SC-05** *(Edge)* | **Metric Collection Storm (5k ev/s)** | Liam (Lead Cloud Engineer) | Global Console & Stream Health Indicator | `FR-05`, `NFR-01`, `NFR-05` | Telemetry generator floods console with 5,000 events/second. | Client-side bucket decimation to 4 Hz; zero DOM lockup; heap $\le 128\text{ MB}$. | Covered in all specs & [scenario-1.md](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Plan-2%20Task%20Statement%20Pairs/ux/C-UX-Scenarios/scenario-1.md) |

---

## 2. Navigational Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ GLOBAL HEADER: Cluster Health Summary | Active Alerts | Storm Mode Status   │
├─────────────────────────────────────────────────────────────────────────────┤
│ TAB NAVIGATION: [1. Live Fleet Heatmap]  [2. Executive 7-Day Reports]       │
├─────────────────────────────────────────────────────────────────────────────┤
│ TAB 1 CONTENT:                                                              │
│  - Active Alerts Banner (Scenario 2)                                        │
│  - 32-Node Real-Time Heatmap Matrix: ws-01..31 & server-01 (Scenario 1 & 5)│
│  - Interactive Forensic Drawer (Slides from right on node click) (Scenario 3)│
├─────────────────────────────────────────────────────────────────────────────┤
│ TAB 2 CONTENT:                                                              │
│  - 7-Day Executive Capacity Summary (Scenario 4)                            │
│  - Token Consumption by Academic Subject                                    │
│  - Peak Contention Timetable & Export JSON / Print                          │
└─────────────────────────────────────────────────────────────────────────────┘
```
