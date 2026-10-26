# Visual Design Spine (DESIGN.md)
## Module 11: AI Infrastructure Observability Console
**Design Lead:** Freya (WDS UX Designer) & Juand (Lead Human Engineer)  
**Form Factor Target:** Desktop-First Data-Dense Observability Console (Optimized for 1080p, 1440p, and 4K Multi-Monitor Engineering Stations)  
**Theme:** High-Contrast Dark Console (Default & Sole Theme for Night/Lab Operations)

---

## 1. Visual Hierarchy & Philosophy

The console is an SRE-grade operational cockpit for **Liam** (Lead Cloud & Systems Engineer) and **Department Management**.
* **Zero Decoration:** Every pixel carries operational telemetry; no decorative animations, heavy drop shadows, or 3D WebGL meshes that consume client GPU cycles.
* **Information Density:** Liam must visualize the operational state of all 32 nodes (33 GPUs) simultaneously without horizontal scrolling.
* **Monospace Stability:** Numerical readings, byte metrics, and timestamps must never cause layout shift during high-frequency stream updates (up to 4 Hz).

---

## 2. Design Tokens & Palette

### 2.1 Surface & Neutral Tokens
| Token | Hex Value | Semantic Usage |
| :--- | :--- | :--- |
| `--surface-bg-base` | `#0B0F19` | Root viewport background; ultra-dark blue-black minimizing glare in server rooms. |
| `--surface-card` | `#111827` | Primary card and grid cell containers; subtle contrast against base. |
| `--surface-card-hover`| `#1F2937` | Hover state for interactive node cells and table rows. |
| `--surface-elevated` | `#1E293B` | Floating modals, inspector drawers, and tooltips. |
| `--border-subtle` | `#374151` | Default 1px borders between node tiles and chart panels. |
| `--border-active` | `#60A5FA` | Keyboard focus ring and active selected node border. |

### 2.2 Operational Severity & Status Tokens
Strict 5-state color system mapping physical hardware health:
| State | Token | Hex Value | Semantic Meaning |
| :--- | :--- | :--- | :--- |
| **Normal / Healthy** | `--status-normal` | `#10B981` | Temperature $< 65^\circ\text{C}$, VRAM $< 70\%$, heartbeats active ($< 5\text{ s}$). |
| **Warning / Elevated**| `--status-warning` | `#F59E0B` | Temperature $65\text{--}79^\circ\text{C}$, VRAM $70\text{--}89\%$, queue growing. |
| **Critical / Cordon** | `--status-critical`| `#EF4444` | Temperature $\ge 88^\circ\text{C}$, VRAM $\ge 90\%$, $P_{99} > 8.0\text{ s}$, Token Spike $10\times$. |
| **Silent / Timeout** | `--status-silent` | `#8B5CF6` | Node missing $\ge 3$ consecutive heartbeats ($\ge 15\text{ s}$). Pulsing purple. |
| **Offline / Inactive**| `--status-offline`| `#6B7280` | Planned maintenance, graceful drain, or cordoned machine. |

### 2.3 Typography Scale
* **Primary Sans (Chrome & UI):** `Inter, -apple-system, BlinkMacSystemFont, sans-serif`
* **Data Monospace (Metrics, Logs & Tables):** `JetBrains Mono, SF Mono, Menlo, monospace`

| Level | Size | Weight | Line Height | Font Family | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display Header** | `20px` (`1.25rem`) | `600 (Semi-bold)` | `28px` | Sans | Top navbar, active cluster summary. |
| **Card Header** | `14px` (`0.875rem`)| `600 (Semi-bold)` | `20px` | Sans | Section titles (Fleet Matrix, Alerts). |
| **Metric Value** | `13px` (`0.8125rem`)| `500 (Medium)` | `16px` | Monospace | Real-time temps, VRAM counts, tok/s. |
| **Node ID / Micro** | `11px` (`0.6875rem`)| `600 (Semi-bold)` | `14px` | Monospace | `ws-gpu-01` through `server-gpu-01`. |
| **Log Stream** | `11px` (`0.6875rem`)| `400 (Regular)` | `16px` | Monospace | Stderr tails, kernel traces, event logs. |

---

## 3. Surface Layout Specifications

### 3.1 32-Node Fleet Matrix Layout
* **Grid Topology:** 8 columns $\times$ 4 rows layout:
  * **Workstations (Row 1 to Row 3, plus Row 4 items 1–7):** 31 single-GPU cards (`ws-gpu-01` to `ws-gpu-31`). Each card occupies `1x` cell width ($140\text{px} \times 95\text{px}$).
  * **Central Server (Row 4 items 8):** 1 dual-GPU server (`server-gpu-01`). Occupies `2x` cell width ($290\text{px} \times 95\text{px}$) with side-by-side indicators for GPU-0 and GPU-1 (48 GB each).
* **Card Interior Visuals:**
  * Top bar: Node badge (`ws-gpu-22`) + Heartbeat pulse dot (Green/Purple).
  * Middle bar: Dual horizontal micro-gauges:
    * Left: Temperature gauge with absolute reading (`64°C`).
    * Right: VRAM gauge with percentage and gigabytes (`18.2 / 24 GB`).
  * Bottom bar: Current assigned subject badge (`CS-480`) or `IDLE`.

### 3.2 Persistent High-Priority Alert Banner
* **Position:** Fixed at top viewport, immediately below global status header.
* **Layout:** Flex row with left high-contrast alert badge, center incident synopsis with dynamic metrics, and right action buttons (`[Inspect Telemetry]`, `[Acknowledge]`).
* **Visual Styling:** Border-left $4\text{px}$ solid `--status-critical` (`#EF4444`), background tint `rgba(239, 68, 68, 0.12)`.
