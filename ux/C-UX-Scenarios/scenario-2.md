# UX Scenario 2: Token Spike & Latency Alert
## Module 11: AI Infrastructure Observability Console
**Protagonist:** Liam (Lead Cloud & Systems Engineer)  
**Surface:** Persistent Header Alert Banner & Anomaly Explainability Card  
**Target FR:** `FR-02` | **Target NFR:** `NFR-03`, `NFR-07`

---

## 1. Scenario Context & User Story
> *"As Liam, I need immediate visual alerting when an unoptimized student notebook or batch inference script creates an abrupt 10x token spike that degrades cluster P99 latency past 8 seconds, so that I can intervene before interactive student chatbots time out across the entire campus."*

---

## 2. Design Loop: [C] Conceptualize
* **User Flow:**
  1. Under normal operation, the cluster processes $\sim 1,200\text{ prompt tokens/sec}$ with $P_{99} \text{ latency} \approx 1.4\text{ s}$.
  2. A student notebook in `CS-480` executes an uncontrolled loop requesting multi-thousand token contexts across multiple workers.
  3. Prompt token velocity spikes abruptly to $13,400\text{ tokens/sec}$ ($> 11\times$ baseline surge).
  4. Workstation inference queues back up; $P_{99} \text{ latency}$ breaches $8.0\text{ seconds}$, reaching $9.45\text{ s}$.
  5. The Anomaly Detection Engine flags both conditions simultaneously.
  6. Within $\le 1.0\text{ second}$, a high-contrast visual alarm banner slides into view at the top of Liam's console without popping up an intrusive modal that locks his mouse.
  7. Liam clicks `[Explain Anomaly]` to reveal root-cause attribution.

---

## 3. Design Loop: [P] Detailed Component Specifications

### 3.1 Persistent Alert Banner Component (`AnomalyHeaderBanner`)
* **Position:** Fixed at viewport top (`z-index: 1000`).
* **Dimensions:** Width $100\%$, Min-height $48\text{px}$.
* **Background & Border:**
  * Background: `rgba(239, 68, 68, 0.15)`
  * Left Border: $5\text{px}$ solid `#EF4444` (Critical Red)
  * Perimeter Border: $1\text{px}$ solid `rgba(239, 68, 68, 0.4)`
* **Content Layout (Flex Row):**
  * Left Icon: Pulsing warning triangle `⚠` (Font-size 18px, `#EF4444`).
  * Headline: `CRITICAL ALARM: 11.2x Token Spike on Llama-3-8B | P99 Latency: 9.45s (Breach > 8.0s)`.
  * Time badge: `Triggered: 14s ago | CS-480 NLP Lab`.
  * Right Actions:
    * `[View Explainability (E)]` (Secondary button, outline `#EF4444`).
    * `[Silence / Ack (A)]` (Ghost button).

### 3.2 Expandable Explainability Card (`AnomalyExplainCard`)
* **Trigger:** Click on `[View Explainability]` or shortcut `E`.
* **Telemetry Data Points Displayed:**
  * **Baseline Token Rate:** $1,200\text{ tok/s}$ ($300\text{ s}$ moving average).
  * **Current Token Rate:** $13,440\text{ tok/s}$ ($+1,020\%$ increase).
  * **Measured $P_{99}$ Latency:** $9.45\text{ s}$ ($+575\%$ degradation over $1.4\text{ s}$ SLA target).
  * **Active Queue Depth:** 92 waiting inference requests across nodes `ws-gpu-10` to `ws-gpu-15`.
  * **Causal Attribution Text:** *"Subject CS-480 generated 1.2M prompt tokens in 90 seconds. Worker queues on 6 workstations reached max depth, driving latency past the 8.0s threshold."*

---

## 4. Design Loop: [V] Validation & Edge Conditions

1. **Non-Intrusive Workflow:** Unlike a modal dialog that disables clicks, this persistent banner permits Liam to interact with the underlying 32-node matrix while the alert remains visible.
2. **Cold-Start Protection:** If the cluster just started and baseline events $< 50$, the anomaly algorithm suppresses ratio calculation to avoid false positives from zero-division.
3. **Screen Reader Notification:** Banner markup uses `role="alert"` and `aria-live="assertive"` so that visually impaired operators receive immediate vocal notification without having to focus the element.
