# UX Scenario 4: Executive Utilization Reporting
## Module 11: AI Infrastructure Observability Console
**Protagonist:** Department Management (Dr. Rebecca Reed, Lab Director; Dean Morales, Academic Dean)  
**Surface:** Executive Capacity & Academic Consumption Dashboard Tab  
**Target FR:** `FR-04` | **Target NFR:** `NFR-06`, `NFR-07`

---

## 1. Scenario Context & User Story
> *"As Dean Morales and Dr. Rebecca Reed, we need a 7-day aggregated academic utilization summary showing total GPU compute hours, token consumption broken down by course subject, and cluster idle capacity percentage, so we can verify faculty grant utilization and allocate GPU quotas for next semester."*

---

## 2. Design Loop: [C] Conceptualize
* **User Flow:**
  1. Department Management navigates to the console and clicks the **[Executive 7-Day Reports]** tab in the main navigation.
  2. The console queries the local pre-aggregated 1-hour rollup store covering the last 168 hours across all 32 nodes ($33\text{ GPUs}$).
  3. Within $\le 1.5\text{ seconds}$, the executive dashboard renders three high-level summary cards, a donut chart of token consumption by subject, and a weekly utilization heatmap.
  4. Management can filter by department (`Computer Science`, `Data Science`, `Faculty Research`) or export the report as an audited JSON / PDF summary.

---

## 3. Design Loop: [P] Detailed Component Specifications

### 3.1 High-Level KPI Summary Cards
* **Card 1: Total Compute Hours Delivered:**
  * Primary Metric: `4,218.5 GPU-Hours`
  * Baseline Context: `Total Fleet Capacity: 5,544.0 GPU-Hours (33 GPUs x 168h)`
  * Utilization Percentage: `76.09% Effective Utilization` (Badge: Green `#10B981`)
* **Card 2: Idle & Unallocated Capacity:**
  * Primary Metric: `1,325.5 GPU-Hours`
  * Baseline Context: `23.91% Unallocated Capacity`
  * Insight Badge: `Amber #F59E0B | Off-Peak Window (02:00 - 07:00)`
* **Card 3: Total Token Throughput:**
  * Primary Metric: `142.8 Million Tokens`
  * Prompt vs Completion: `108.2M Prompt / 34.6M Completion`
  * Average Generation Latency: `1.62s per inference request`

### 3.2 Academic Subject Token Consumption Breakdown
Tabular breakdown and proportional bar visualization:

| Academic Subject | Course Code | Enrolled Students | GPU-Hours Consumed | Total Tokens Processed | % of Cluster Total |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NLP Deep Learning** | `CS-480` | 64 | $1,842.0\text{ h}$ | $68.4\text{ M}$ | **$47.9\%$** |
| **Computer Vision Lab** | `CS-530` | 48 | $1,320.5\text{ h}$ | $44.2\text{ M}$ | **$30.9\%$** |
| **Faculty Research** | `FAC-RES` | 12 | $740.0\text{ h}$ | $20.8\text{ M}$ | **$14.6\%$** |
| **Intro to AI & ML** | `CS-101` | 120 | $316.0\text{ h}$ | $9.4\text{ M}$ | **$6.6\%$** |
| **Idle Capacity** | `IDLE` | — | $1,325.5\text{ h}$ | $0\text{ M}$ | — |

### 3.3 Export & Audit Actions
* `[Export Audited JSON Summary]`: Downloads machine-readable JSON containing hourly aggregations for institutional compliance.
* `[Print / Save PDF Executive Brief]`: Triggers a print-optimized CSS stylesheet removing navigation bars and rendering high-contrast tabular pages.

---

## 4. Design Loop: [V] Validation & Edge Conditions

1. **Pre-Aggregated Query Speed:** By querying pre-computed 1-hour rollup fixtures rather than scanning raw streaming points, calculation and rendering complete in $\le 1.5\text{ seconds}$ ($NFR\text{-}06$).
2. **Mathematical Precision:** Total GPU hours consumed plus idle hours strictly equals total hardware capacity:
   $$4,218.5 + 1,325.5 = 5,544.0\text{ GPU-Hours} \quad (31 \times 1 + 1 \times 2 = 33\text{ GPUs} \times 168\text{ h})$$
3. **Empty Data Guardrail:** If an academic subject recorded 0 jobs during the week, the table renders an explicit row with `0.0 h | 0 Tokens` rather than omitting the subject or displaying `NaN%`.
