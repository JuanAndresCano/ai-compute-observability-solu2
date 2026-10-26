# UX Scenario 1: Real-Time Telemetry Stream & Cluster Heatmap
## Module 11: AI Infrastructure Observability Console
**Protagonist:** Liam (Lead Cloud & Systems Engineer)  
**Surface:** Primary Fleet Heatmap Matrix & Metric Stream Healthbar  
**Target FR:** `FR-01`, `FR-05` | **Target NFR:** `NFR-01`, `NFR-02`, `NFR-05`

---

## 1. Scenario Context & User Story
> *"As Liam, the lead cloud and systems engineer, I need to monitor the physical health of all 32 cluster machines in real-time on my workstation monitor, so that I can immediately identify thermal throttling or VRAM exhaustion before student training jobs fail."*

---

## 2. Design Loop: [C] Conceptualize
* **User Flow:**
  1. Liam loads the Observability Console at `http://localhost:3000/`.
  2. The console establishes a persistent push stream (WebSocket) to the simulated metric generator.
  3. The 32-node matrix paints within $\le 250\text{ ms}$:
     - 31 compact cards for `ws-gpu-01` through `ws-gpu-31` (1x 24GB GPU each).
     - 1 wide card for `server-gpu-01` (2x 48GB GPUs side-by-side).
  4. Liam toggles between two heatmap overlays via header buttons:
     - **Temperature View ($^\circ\text{C}$):** Visualizes thermal envelopes.
     - **VRAM Utilization View ($\text{GB}$ / $\%$):** Visualizes memory pressure.
  5. If the generator initiates the **Metric Collection Storm ($5,000\text{ ev/s}$)**:
     - A pill badge illuminates in the header: `STORM MODE (5,000 ev/s) | 4 Hz Downsampling Active`.
     - The UI remains completely fluid ($\ge 30\text{ FPS}$), with zero frame drops or input lag.

---

## 3. Design Loop: [P] Detailed Component Specifications

### 3.1 Node Cell Component (`NodeHeatmapCard`)
* **Dimensions:** Standard workstation: $140\text{px} \times 95\text{px}$; Central Server: $290\text{px} \times 95\text{px}$.
* **Header Row:**
  * Node ID text: `ws-gpu-14` (Font: Monospace 11px, bold `#E5E7EB`).
  * Heartbeat indicator: $6\text{px}$ circular glowing dot (Green `#10B981` when $\Delta t < 5\text{ s}$).
* **Metric Bar 1 (Temperature):**
  * Label: `TMP: 68°C`
  * Gauge: $4\text{px}$ height horizontal progress bar with dynamic fill based on temperature thresholds:
    * Green: $< 65^\circ\text{C}$
    * Amber: $65\text{--}79^\circ\text{C}$
    * Orange: $80\text{--}87^\circ\text{C}$
    * Red: $\ge 88^\circ\text{C}$
* **Metric Bar 2 (VRAM Usage):**
  * Label: `VRAM: 18.4G` (Workstation: `/24G`; Server: `/48G` per slot)
  * Gauge: Horizontal progress bar mapping memory consumption.
* **Footer Row:**
  * Active course tag: `[CS-480]` or `[IDLE]` badge.

### 3.2 Dual-GPU Server Cell (`server-gpu-01`)
* Specifically accommodates two independent GPU metrics:
  * Left partition: `GPU-0 (48GB)` -> Temp & VRAM.
  * Right partition: `GPU-1 (48GB)` -> Temp & VRAM.
* Guarantees total hardware truth without aggregating distinct physical devices into an ambiguous average.

---

## 4. Design Loop: [V] Validation & Edge Conditions

1. **Storm Decimation Verification:** During $5,000\text{ events/sec}$, the Web Worker batches incoming events into $250\text{ ms}$ buckets. Only the latest bucket summary `{min, max, avg, count}` triggers React DOM reconciliation, keeping heap memory strictly bounded under $128\text{ MB}$.
2. **Missing Telemetry (Stale Cache):** If a single node misses 1 packet, the cell retains its prior reading with a subtle amber border and timestamp relative counter (`Last updated: 6s ago`).
3. **Keyboard Accessibility:** Liam can hit `Tab` to navigate node cells sequentially, with an accessible focus ring (`#60A5FA`, $2\text{px}$ offset).
