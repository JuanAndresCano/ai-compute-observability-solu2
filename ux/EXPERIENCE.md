# Behavioral Experience Spine (EXPERIENCE.md)
## Module 11: AI Infrastructure Observability Console
**Experience Lead:** Freya (WDS UX Designer) & Juand (Lead Human Engineer)  
**Standard Compliance:** WCAG 2.1 AA Accessible Observability Console

---

## 1. Core Interaction Principles

1. **Non-Blocking Observability:** Critical alarms, telemetry storms, and node failures must never disable navigation or block inspection. The console informs without arresting operator workflow.
2. **Deterministic Root-Cause Explainability:** Whenever an anomaly alert fires (such as the $10\times$ token surge) or a node drops heartbeats (`ws-gpu-22`), the interface provides a human-readable, metric-backed rationale explaining *why* the condition was flagged.
3. **Graceful Degradation under Stress:** During telemetry floods ($5,000\text{ ev/s}$), the interface signals downsampling status transparently rather than freezing the viewport.

---

## 2. Universal 4-Way Surface State Machine

Every primary surface in the console (Fleet Heatmap, Anomaly Banner, Forensic Drill-Down, Executive Report) explicitly implements the 4 standard states:

```
┌─────────────┐       Data Stream Active        ┌─────────────┐
│   LOADING   │ ──────────────────────────────> │   SUCCESS   │
└─────────────┘                                 └──────┬──────┘
       │                                               │
       │ No Data / 0 Nodes                             │ Socket Error /
       ▼                                               │ Stale Stream
┌─────────────┐                                        ▼
│    EMPTY    │                                 ┌─────────────┐
└─────────────┘                                 │    ERROR    │
                                                └─────────────┘
```

### 2.1 State Matrix Across Surfaces

| Surface | Loading State | Empty State | Error State | Success (Nominal) State |
| :--- | :--- | :--- | :--- | :--- |
| **Fleet Heatmap (32 Nodes)** | 32 pulsing skeleton grid cells with shimmering `--border-subtle` borders ($< 1.0\text{ s}$). | Visual card: *"No simulated nodes registered in cluster profile. Verify telemetry generator connection."* with `[Retry Discovery]` button. | Persistent banner: *"Telemetry stream disconnected (WebSocket EOF). Attempting reconnect 1/5 in 3s..."* Cells display last cached state with grayscale wash. | Live 32-node interactive grid with real-time temperature/VRAM color gradients updating at $\ge 4\text{ Hz}$. |
| **Alert & Anomaly Engine** | Subtle inline spinner in header metric badge. | Green status pill: *"All systems nominal. Zero active cluster anomalies."* | Warning callout: *"Anomaly evaluator degraded: insufficient sample buffer ($< 50$ events). Evaluation paused."* | Dynamic high-contrast banner displaying active alerts with metric spike factor, affected node/model, and timestamp. |
| **Forensic Node Drill-Down (`ws-gpu-22`)** | Drawer opens with animated wireframe timeline skeleton ($< 300\text{ ms}$). | Informational banner: *"No error logs or events recorded for this node in the active 30-minute window."* | Error toast: *"Failed to fetch forensic buffer for ws-gpu-22: Node cache corrupted."* with `[Reload Local Fixture]` action. | Chronological timeline of events leading up to failure, last 50 lines of stderr, active job metadata, and status badges. |
| **Executive 7-Day Report** | Shimmering bar chart placeholders and calculating spinner: *"Aggregating 5,544 GPU-hours..."* | Empty report canvas: *"No historical telemetry recorded for selected window [2026-09-21 to 2026-09-28]."* | Error callout: *"Query timeout calculating subject token rollups. Fixture data unreadable."* | Complete executive summary cards (Total GPU hours, % idle, token consumption breakdown, peak contention chart). |

---

## 3. Explainability Banner System

When an operational alert triggers, operators require immediate context without guessing. The system displays structured explainability cards adhering to the following schema:

### 3.1 Token Spike & Latency Alert Explainability
* **Visual Presentation:** Non-modal persistent banner at viewport top with expandable details drawer.
* **Component Structure:**
  * **Header:** `[CRITICAL ALERT] 10.5x Token Influx Detected on Llama-3-8B | P99 Latency Breach`
  * **Observed Metrics:**
    * *Baseline Throughput:* $1,200\text{ tokens/sec}$ (5-minute rolling average)
    * *Current Influx:* $12,650\text{ tokens/sec}$ ($+10.54\times$ increase)
    * *Observed $P_{99}$ Latency:* $9.24\text{ seconds}$ (SLA Threshold: $8.0\text{ seconds}$)
    * *Queue Saturation:* 84 requests queued on `server-gpu-01`
  * **Human-Readable Explanation:** *"System detected an abrupt 10x spike in prompt tokens submitted by coursework CS-480 (NLP Lab). Request queue exceeded capacity on worker nodes ws-gpu-10 through ws-gpu-14, pushing P99 response time to 9.24s."*
  * **Action Triggers:** `[Inspect CS-480 Queue]`, `[Filter Fleet by Affected Model]`, `[Acknowledge Alert]`.

### 3.2 Silent Node Timeout Explainability (`ws-gpu-22`)
* **Visual Presentation:** Pulsing purple border on tile `ws-gpu-22` with badge: `SILENT (18s)`.
* **Component Structure:**
  * **Root Cause Assessment:** *"Node stopped emitting periodic telemetry heartbeats (5.0s interval). Missed 3 consecutive intervals (18.2s elapsed since last packet at 19:14:02)."*
  * **Impacted Workload:** `job-cs480-lora-run-84` (User: `student-mateo`, Subject: `CS-480 NLP`).
  * **Last Known Metric State:** GPU Temp: $84^\circ\text{C}$, VRAM: $22.8\text{ GB / }24\text{ GB}$ ($95\%$). Last syslog message: `Xid 62: NVML communication lost`.

---

## 4. Accessibility Standards (WCAG 2.1 AA)

1. **Color Independence:** Status states never rely on color alone. Every metric badge and node cell includes text labels and iconic indicators (e.g., `✓ Normal`, `⚠ Warning`, `✕ Critical`, `⏱ Silent`).
2. **Contrast Ratios:** All text elements exceed the $4.5:1$ contrast ratio against their respective background tiles:
   * Metric text (`#F3F4F6`) on Card background (`#111827`): **$13.2:1$** (Exceeds AAA).
   * Critical red text (`#EF4444`) on dark badge: **$5.1:1$** (Exceeds AA).
   * Warning amber text (`#F59E0B`) on dark badge: **$6.2:1$** (Exceeds AA).
3. **Keyboard Navigation & Focus Management:**
   * Full keyboard tab navigation across all 32 node cells (`Tab` / `Shift+Tab`).
   * Arrow key grid navigation (`Up`, `Down`, `Left`, `Right`) across the 8x4 matrix.
   * `Enter` / `Space` opens the forensic drill-down drawer for the focused node.
   * `Escape` dismisses drawers and returns focus to the previously selected cell.
4. **Live Screen Reader Announcements (`aria-live`):**
   * The alert banner container is marked `role="alert"` with `aria-live="assertive"`.
   * High-frequency telemetry updates use `aria-live="polite"` on individual cells with throttling to prevent screen reader buffer floods.
