# Product Requirements Document (PRD)
## Module 11: AI Infrastructure Observability Console
**Document Version:** 1.0.0  
**Status:** APPROVED  
**Author:** Liam (Lead Cloud & Systems Engineer) & Juand (Lead Product Engineer)  
**Target Environment:** Academic AI Compute Fabric (Standalone Local / Docker Compose)

---

## 1. Executive Summary & Problem Framing

### 1.1 Core Problem
The university operates a heterogeneous on-premise compute cluster comprising **31 Workstations** (1 NVIDIA GPU with 24 GB VRAM each, 16–32 vCPUs, 64 GB RAM, 500 GB NVMe) and **1 Central Server** (2 NVIDIA GPUs with 48 GB VRAM each, 96 GB VRAM total, 64 vCPUs, 256 GB RAM, 4 TB NVMe), totaling 32 nodes and 33 GPUs.

Currently, infrastructure engineers and department heads lack a unified pane of glass into the cluster. They cannot determine in real time if machines are idle, models are unresponsive, quotas are saturated, or hardware is overheating. Ad-hoc coordination via spreadsheets and chat channels leads to compute contention, silent node dropouts, and untracked resource allocation across courses.

### 1.2 Solution Vision
The **AI Infrastructure Observability Console (Module 11)** delivers a unified, high-density, real-time observability workstation. It ingests simulated Prometheus-compatible metrics from all 32 nodes, computes live aggregations (GPU utilization, VRAM usage, GPU temperature, token throughput, request latencies, and active queues), renders interactive heatmaps, triggers automated visual alerts for anomaly spikes, provides forensic drill-down into failing nodes, and generates executive 7-day academic capacity reports.

### 1.3 System Boundaries (Owns vs. Mocks/Delegates)
To adhere to the **Independent Executability** and **Hardware Agnosticism** mandates:
* **What Module 11 Owns:**
  * Real-time metrics ingestion engine (push via WebSocket stream with fallback).
  * Client-side downsampling and bucket decimation engine to withstand metric storms up to 5,000 events/second.
  * In-memory circular ring buffer for time-series telemetry.
  * Anomaly detection engine calculating rolling $P_{99}$ latency and token acceleration spikes.
  * Node health state-machine tracking heartbeat freshness for all 32 cluster nodes.
  * Interactive Observability Dashboard UI (telemetry heatmap, alert banner, node drill-down, 7-day summary).
* **What Module 11 Mocks / Delegates:**
  * Physical GPU hardware and NVIDIA NVML drivers (simulated through a high-frequency telemetry generator fixture).
  * Kubernetes Device Plugin, Kubeflow PyTorchJob operators, and vLLM servers (simulated via deterministic mock event streams).
  * Campus Single-Sign-On / LDAP (simulated with mock session contexts for Liam and Management).

---

## 2. Named Academic Protagonistas

| Protagonist | Role & Institutional Context | Primary JTBD (Job To Be Done) | Critical Frustration / Tension |
| :--- | :--- | :--- | :--- |
| **Liam** | **Lead Cloud & Systems Engineer**<br>Oversees physical cluster health, thermal envelopes, node uptime, and hardware-level stability across all 32 machines. | *"When a node silently crashes or GPU thermals spike, I need instant visual isolation and deep root-cause telemetry so I can triage before lab classes fail."* | Receives complaints from students hours after a node dies; lacks chronological log alignment between hardware states and inference jobs. |
| **Department Management**<br>*(Dr. Rebecca Reed, Lab Director; Dean Morales, Academic Dean)* | **Executive Academic Leadership**<br>Governs compute budget allocation, curriculum department quotas, and capital expenditure decisions. | *"At the end of each academic week, I need audited numbers of GPU consumption by subject and idle capacity to justify next semester's hardware grant."* | No visibility into whether machines are actually being utilized or sitting idle while courses claim resource shortages. |

---

## 3. Functional Requirements (FRs)

### FR-01: Real-Time Cluster Telemetry Ingestion & Heatmap Matrix
* **System Responsibility:** The system shall continuously ingest metric frames emitted by all 32 nodes (31 single-GPU workstations, 1 dual-GPU server) and render real-time dual-matrix heatmaps for GPU Temperature ($^\circ\text{C}$) and VRAM Utilization ($\text{GB}$ / $\%$).
* **Trigger:** Telemetry stream connection established from the cluster metrics generator.
* **Inputs:** Node telemetry payload: `node_id`, `gpu_index`, `temperature_celsius`, `vram_used_bytes`, `vram_total_bytes`, `gpu_utilization_pct`, `active_jobs_count`, `timestamp`.
* **Validation Rules:**
  * `temperature_celsius` must be between $-20.0^\circ\text{C}$ and $120.0^\circ\text{C}$ (sensor validity range; the colour bands below are unchanged). *[Amended 2026-10-26, REV-DET-17: was 20.0-115.0, which contradicted `contracts.md` Op1 P1.]*
  * `vram_used_bytes` must not exceed `vram_total_bytes` ($24\text{ GB}$ for workstations, $48\text{ GB}$ per GPU for the central server).
  * Missing node frames within 1 heartbeat cycle retain their last known state flagged as `STALE_CACHED`.
* **Outputs:** 32-cell visual interactive grid updated at $\ge 4\text{ Hz}$ with color-coded severity:
  * *Temperature:* Green ($< 65^\circ\text{C}$), Yellow ($65\text{--}79^\circ\text{C}$), Orange ($80\text{--}87^\circ\text{C}$), Red/Alert ($\ge 88^\circ\text{C}$).
  * *VRAM:* Green ($< 70\%$), Amber ($70\text{--}89\%$), Magenta ($\ge 90\%$).
* **Measurable Test Condition:** Ingestion of 32 concurrent node streams simultaneously reflects metric shifts on the UI canvas within $\le 250\text{ ms}$ of arrival.

### FR-02: Token Spike & $P_{99}$ Latency Anomaly Alarm
* **System Responsibility:** The system shall compute a 30-second sliding window of prompt token throughput and $P_{99}$ inference latency across active model workers. If prompt tokens increase by $\ge 10\times$ relative to the 5-minute baseline and cause $P_{99} \text{ latency} > 8.0\text{ s}$, the system must trigger an automated, high-priority visual alarm banner.
* **Trigger:** Execution of sliding-window evaluation loop every $1,000\text{ ms}$.
* **Inputs:** Array of inference completion metrics: `request_id`, `node_id`, `gpu_index`, `model_id`, `academic_subject`, `prompt_tokens`, `completion_tokens`, `queue_duration_ms`, `inference_duration_ms`, `total_latency_ms`, `timestamp_ms`. *[Amended 2026-10-26, REV-DET-18: field names aligned to `InferenceMetricPacketDTO`.]*
* **Validation Rules:**
  * Baseline token velocity calculated over prior 300 seconds (minimum 50 sample events required to avoid false positives during cluster warmup).
  * Current velocity calculated over prior 30 seconds.
* **Outputs:** 
  * High-priority visual alarm banner displayed at the top of the console with pulsing amber/red border (`#E53E3E`).
  * Structured alert payload containing: `spike_factor` (e.g., $11.4\times$), `p99_latency_observed` (e.g., $9.24\text{ s}$), `saturated_nodes`, `primary_subject`, `sla_threshold_ms`, and `timestamp_ms`. *[Amended 2026-10-26, REV-DET-19: `impacted_models` and `active_queue_depth` are not produced by any contract; `AnomalyAlertPayloadDTO` carries `saturated_nodes` and `primary_subject`. Queue depth is deferred.]*
  * Explainability justification: *"Prompt token influx surged from 1,200 tok/s to 13,800 tok/s (+10.5x); queue saturation drove P99 latency to 9.1s exceeding the 8.0s SLA limit."*
* **Measurable Test Condition:** Injecting a synthetic burst of 15,000 tokens/s with response times $> 8,000\text{ ms}$ fires the alarm within $\le 1.0\text{ s}$ of the 30-second window condition being met.

### FR-03: Forensic Unhealthy Node Drill-Down (`ws-gpu-22`)
* **System Responsibility:** When node `ws-gpu-22` (or any cluster node) stops transmitting heartbeats for $\ge 3$ consecutive reporting intervals (interval $= 5.0\text{ s}$, threshold $\ge 15.0\text{ s}$), the console shall transition the node state to `SILENT_TIMEOUT`, surface a warning flag in the fleet view, and provide Liam with a 1-click drill-down forensic dashboard.
* **Trigger:** Heartbeat watchdog timer expiration for `ws-gpu-22`.
* **Inputs:** Node registry identifier: `ws-gpu-22`; time since last heartbeat: $\Delta t \ge 15.0\text{ s}$.
* **Validation Rules:**
  * Must preserve the last known valid telemetry snapshot and the last 50 error log entries emitted prior to silence.
  * Must identify the active job running at the moment of failure (`job_id`, user, subject, model, submitted timestamp).
* **Outputs:** Dedicated forensic inspection modal/panel showing:
  * Chronological timeline of metric degradation leading up to timeout.
  * Raw stderr/syslog tail (e.g., `Xid 62: GPU bus error; NVML communication lost`).
  * Last known job summary: `job-cs480-lora-run-84`, user: `student-mateo`, subject: `CS-480 NLP`.
  * Status indicator: `STATUS: SILENT (No heartbeat for 18s) | Cordon Recommended`.
* **Measurable Test Condition:** Halting heartbeats from `ws-gpu-22` triggers `SILENT_TIMEOUT` status at $15.0\text{ s} \pm 0.5\text{ s}$ and opens forensic timeline with full historical buffer.

### FR-04: Executive 7-Day Utilization & Capacity Reporting
* **System Responsibility:** The console shall aggregate cluster telemetry across a sliding 7-day window ($168\text{ hours}$) into an executive report detailing total GPU compute hours, token consumption segmented by academic subject, and overall cluster idle capacity percentage.
* **Trigger:** User interaction by Department Management (selection of 7-day date range or "Generate Executive Summary" button).
* **Inputs:** Pre-aggregated 1-hour rollup metric store covering 168 hourly intervals across all 32 nodes.
* **Validation Rules:**
  * Total available capacity defined as: $32\text{ nodes} \times 24\text{ h/day} \times 7\text{ days} = 5,376\text{ machine-hours}$ ($33\text{ GPUs} \times 168\text{ h} = 5,544\text{ GPU-hours}$).
  * Segmented academic subjects: `CS-101 (Intro to ML)`, `CS-480 (NLP Deep Learning)`, `CS-530 (Computer Vision)`, `Faculty Research`, `Unallocated/Idle`.
* **Outputs:** 
  * Executive dashboard view with printable/exportable JSON and tabular cards:
    * Total GPU Hours Consumed: e.g., $4,218.5\text{ GPU-hours}$ ($76.1\%$ utilization).
    * Total Idle Capacity: $1,325.5\text{ GPU-hours}$ ($23.9\%$).
    * Token Consumption by Subject: `CS-480` ($48.2\%$), `CS-530` ($31.5\%$), `Faculty Research` ($14.1\%$), `CS-101` ($6.2\%$).
    * Peak Contention Window: Identifies weekday hours of $100\%$ saturation.
* **Measurable Test Condition:** Executing report generation over a 7-day fixture generates verified mathematical totals with $\le 1.5\text{ s}$ latency.

### FR-05: Metric Collection Storm Throttling & Client Decimation (Mandatory Edge Case)
* **System Responsibility:** When the simulated metrics generator subjects the console to a telemetry storm of $5,000\text{ events/second}$, the system shall activate client-side decimation and bucket windowing to prevent UI thread starvation, browser crash, or memory overflow.
* **Trigger:** Incoming telemetry event arrival rate exceeding $1,000\text{ events/second}$ over a $1.0\text{ s}$ window.
* **Inputs:** High-frequency event stream of up to $5,000\text{ events/second}$.
* **Validation Rules:**
  * Raw metrics are batched into a non-blocking Web Worker / Ring Buffer.
  * UI rendering is downsampled to fixed $250\text{ ms}$ render ticks ($4\text{ updates/second}$ max).
  * High-frequency metric points within each $250\text{ ms}$ bucket are mathematically reduced to `{min, max, avg, count}` summary tuples.
* **Outputs:**
  * Console remains fully responsive with UI frame rate $\ge 30\text{ FPS}$.
  * Visual indicator tag: `"Storm Mode Active: Downsampling 5,000 ev/s -> 4 Hz Buckets"`.
  * Zero dropped alert evaluations (critical alerts bypass decimation).
* **Measurable Test Condition:** 15-minute continuous injection of $5,000\text{ events/second}$ completes with zero browser tab crash and heap memory consumption bounded under $128\text{ MB}$.

---

## 4. Non-Functional Requirements (NFRs)

Every non-functional requirement is specified with explicit numeric bounds without ambiguous adjectives:

| ID | Category | Metric & Threshold | Verification Method |
| :--- | :--- | :--- | :--- |
| **NFR-01** | **Ingestion Throughput** | $\ge 5,000\text{ events/second}$ sustained for $\ge 15\text{ minutes}$ without process crash or buffer overflow. | Automated load injector script benchmarking websocket ingestion pipeline. |
| **NFR-02** | **Telemetry Rendering Latency** | $\le 250\text{ ms}$ from metric timestamp to visual heatmap cell update under nominal load ($\le 500\text{ ev/s}$); $\le 500\text{ ms}$ under storm conditions ($5,000\text{ ev/s}$). | High-resolution timestamp diff logging between generator emission and DOM paint. |
| **NFR-03** | **Alarm Detection Latency** | $\le 1.0\text{ second}$ elapsed from the exact moment the 30-second sliding window satisfies both $10\times$ token surge and $P_{99} > 8.0\text{ s}$. | Synthetic anomaly test suite asserting alert dispatch callback timestamp. |
| **NFR-04** | **Heartbeat Watchdog Precision** | Node silent transition occurs at exactly $15.0\text{ s} \pm 0.5\text{ s}$ following the last received heartbeat packet (3 intervals $\times 5.0\text{ s}$). | Unit test measuring timeout trigger clock delta. |
| **NFR-05** | **Client Memory Bounds** | Browser Heap Memory footprint shall not exceed $128\text{ MB}$ over a continuous 60-minute telemetry session under storm conditions. | Chrome DevTools Memory Profiler heap snapshot delta measurement. |
| **NFR-06** | **Report Compute Performance** | Executive 7-day aggregated summary query and render completes in $\le 1,500\text{ ms}$ for 168 hourly intervals across all 32 nodes. | Benchmark timing on report generation execution. |
| **NFR-07** | **Accessibility Standard** | Interface must achieve $100\%$ compliance with **WCAG 2.1 AA** standards (minimum 4.5:1 text contrast ratio, full keyboard tab navigation). | Automated axe-core accessibility audit runner. |
| **NFR-08** | **Hardware Agnosticism & Independence** | $100\%$ runnable in local standalone mode without access to physical NVIDIA GPUs or cloud infrastructure. | Execution validation on non-GPU host via simulated fixtures. |

---

## 5. Non-Goals & Out-Of-Scope Declarations

1. **No Real-Time CUDA Profiling:** The console does not attach `nsys` or `nvprof` kernel profilers to live GPU kernels. It monitors cluster-level Prometheus metrics (utilization, VRAM, thermals, throughput).
2. **No Monolithic Multi-Service Integration:** The module operates completely independently; it does not require live integration with Module 1 (Auth), Module 4 (Reservations), or external university LDAP servers.
3. **No Direct Node Execution / SSH:** The console is an observability and diagnostic system, not an orchestration agent. It triggers visual cordons and alerts, but does not execute remote SSH commands or kernel reboots.
