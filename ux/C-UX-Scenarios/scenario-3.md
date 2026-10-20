# UX Scenario 3: Unhealthy Node Drill-Down (`ws-gpu-22`)
## Module 11: AI Infrastructure Observability Console
**Protagonist:** Liam (Lead Cloud & Systems Engineer)  
**Surface:** Fleet Heatmap Matrix & Forensic Node Inspector Drawer  
**Target FR:** `FR-03` | **Target NFR:** `NFR-04`, `NFR-07`

---

## 1. Scenario Context & User Story
> *"As Liam, when workstation node ws-gpu-22 drops off the network or crashes its driver, I need immediate visual notification on the fleet map and a one-click forensic drill-down into its timeline, recent error logs, and last running job so I can diagnose the physical machine without SSH access."*

---

## 2. Design Loop: [C] Conceptualize
* **User Flow:**
  1. Workstation `ws-gpu-22` in Lab Room 302 experiences a thermal trip or GPU bus lockup (`Xid 62`).
  2. The local node agent stops transmitting periodic $5.0\text{ s}$ heartbeats.
  3. The console's heartbeat watchdog tracks missing intervals:
     - At $t = 5\text{ s}$: Warning dot turns Amber.
     - At $t = 10\text{ s}$: Card border turns Orange (`STALE`).
     - At $t = 15.0\text{ s}$ ($\ge 3$ missed intervals): State transitions to `SILENT_TIMEOUT`.
  4. The card for `ws-gpu-22` begins pulsing with a high-contrast purple border (`#8B5CF6`).
  5. Liam clicks on `ws-gpu-22` (or navigates with keyboard and presses `Enter`).
  6. The **Forensic Node Inspector Drawer** smoothly slides in from the right edge ($< 300\text{ ms}$).
  7. Liam inspects the chronological degradation timeline, the tail of stderr/syslog logs, and the last executed job.

---

## 3. Design Loop: [P] Detailed Component Specifications

### 3.1 Unhealthy State on Fleet Grid (`NodeHeatmapCard - ws-gpu-22`)
* **Visual Styling:**
  * Background: `#1F1A2E` (tinted dark purple).
  * Border: $2\text{px}$ solid `#8B5CF6` with a $1.5\text{ s}$ infinite pulse animation.
  * Status Badge: `STATUS: SILENT (No Heartbeat for 18.2s)` in bold purple text.
  * Quick Action: Badge reads `[Click for Forensic Triage]`.

### 3.2 Forensic Node Inspector Drawer (`ForensicDrawer`)
* **Dimensions:** Width $540\text{px}$, Height $100\text{vh}$, slides over right side of viewport.
* **Header Block:**
  * Title: `FORENSIC DRILL-DOWN: ws-gpu-22 (Workstation Node)`
  * Last Seen: `19:14:02 UTC (18.2 seconds ago)`
  * Hardware Profile: `1x NVIDIA RTX 4090 (24 GB VRAM) | AMD Ryzen 9 7950X (32 vCPU) | 64 GB RAM`
  * Action Button: `[Copy Diagnostic Bundle]` (JSON export).
* **Panel 1 — Chronological Metric Degradation Timeline:**
  * Visual timeline with 5 key state markers:
    * `19:10:00` — Normal: GPU Temp $62^\circ\text{C}$, VRAM $14.2\text{ GB}$, Util $65\%$.
    * `19:12:30` — Job Launched: `job-cs480-lora-run-84` submitted by student `mateo`.
    * `19:13:45` — Thermal Rise: Temp climbed to $86^\circ\text{C}$, VRAM spiked to $23.1\text{ GB / }24\text{ GB}$ ($96.2\%$).
    * `19:14:02` — Last Valid Heartbeat: Temp $89^\circ\text{C}$ (Critical threshold breached).
    * `19:14:17` — Watchdog Timeout: Node declared `SILENT` (3 missed heartbeats).
* **Panel 2 — Error Logs Tail (Last 50 Lines):**
  * Monospace terminal box (`JetBrains Mono`, 11px):
    ```text
    [19:13:58.120] kernel: NVRM: GPU at PCI:0000:01:00.0 has fallen off the bus.
    [19:13:59.042] nvml-agent: Error: NVML_ERROR_GPU_IS_LOST
    [19:14:01.890] vllm-worker: PyTorch CUDA execution failed: device-side assert triggered
    [19:14:02.105] systemd[1]: nvml-telemetry.service: Main process exited, code=killed, status=9/KILL
    [19:14:17.000] console-watchdog: Heartbeat expired (15.0s elapsed). Node transitioned to SILENT.
    ```
* **Panel 3 — Last Known Job Metadata:**
  * Job ID: `job-cs480-lora-run-84`
  * Owner: `student-mateo` | Subject: `CS-480 NLP Deep Learning`
  * Model: `Llama-3-8B-Instruct-FP16`
  * Compute Allocated: `1 GPU (24 GB)`

---

## 4. Design Loop: [V] Validation & Edge Conditions

1. **State Preservation Across Silence:** The console preserves the last known valid telemetry packet and in-memory log buffer even after connection dies, allowing post-mortem inspection without data loss.
2. **Drawer Accessibility:** When the drawer opens, keyboard focus is trapped within the drawer; pressing `Escape` dismisses the drawer and returns focus cleanly to the `ws-gpu-22` grid cell.
3. **Flapping Connection Safeguard:** If `ws-gpu-22` reconnects briefly for 1 packet, the state transitions to `RECOVERING` rather than immediately clearing to `HEALTHY`, requiring 3 consecutive valid heartbeats to restore normal status.
