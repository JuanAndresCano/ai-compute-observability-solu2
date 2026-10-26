# Module 11 — AI Infrastructure Observability Console (Task Impl-1)

> **Implementation Delivery Walkthrough:** [`walkthrough-impl1.md`](walkthrough-impl1.md)  
> **AI Governance & Decision Log:** [`docs/ai-decision-log.md`](docs/ai-decision-log.md)  
> **Sprint Tracking Artifact:** [`implementation-artifacts/sprint-status.yaml`](implementation-artifacts/sprint-status.yaml) (and [`docs/sprint-status.yaml`](docs/sprint-status.yaml))

Production implementation of Module 11 (**AI Infrastructure Observability Console**) for the **Academic AI Compute Fabric**. Built with strict Hexagonal Architecture (Ports & Adapters), in-memory ring-buffer telemetry decimation, SQLite persistence, native Node.js HTTP REST endpoints, and a comprehensive 282-test automated verification suite.

---

## 1. Quickstart & Verification (Local)

### Prerequisites
* **Node.js:** 20.x or newer (`node -v`)
* **npm:** 9.x or newer
* **OS:** Windows, Linux, or macOS (cross-platform path and CRLF normalisation verified)
* No external database or GPU hardware required (self-contained SQLite and simulation adapters)

### Step-by-Step Execution

```bash
# 1. Install dependencies deterministically
npm ci

# 2. Run the full verification pipeline (Typecheck + 282 Tests + Traceability + Readiness)
npm run ci

# 3. Alternatively run test suites directly:
npm run test:all       # Runs both test/harness and test/atdd (282 passing tests, 0 skipped)
npm test               # Runs architecture purity, schemas, BDD scaffold tests (125 passed)
npm run test:atdd      # Runs ATDD contract operations 1-4 tests (157 passed)

# 4. Compile the production bundle
npm run build

# 5. Start the production HTTP server
npm start
```

When started, the console listens on `http://0.0.0.0:8080` (or `PORT` specified in environment).

---

## 2. Docker & Container Execution

A multi-stage [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](docker-compose.yml) are provided for isolated, production-like execution:

```bash
# Build and run the service in container
docker-compose up --build

# Verify container liveness probe
curl -f http://localhost:8080/health
```

The container includes a built-in `HEALTHCHECK` probe running every 10 seconds against `GET /health`.

---

## 3. Environment Variables Configuration

Copy [`.env.example`](.env.example) to `.env` or pass variables to your runtime:

| Variable | Description | Default | Allowed Values |
|---|---|---|---|
| `NODE_ENV` | Runtime environment | `development` | `development`, `production`, `test` |
| `HOST` | HTTP binding interface | `0.0.0.0` | IP string |
| `PORT` | HTTP port | `8080` | Valid port integer (0 for dynamic) |
| `DB_PATH` | SQLite file location | `:memory:` | `:memory:` or file path e.g. `data/observability.db` |
| `MAX_RAW_QUEUE_CAPACITY` | Raw event buffer limit | `10000` | Integer |
| `DECIMATION_WINDOW_MS` | Bucketing window interval | `250` | Integer (milliseconds) |
| `LOG_LEVEL` | Logging verbosity | `info` | `debug`, `info`, `warn`, `error` |

---

## 4. Implemented Stories & Endpoints

### Story 11.1: Multi-Node Telemetry Ingestion & Real-Time Aggregation
* **Route:** `POST /v1/telemetry/batches` & `POST /api/v1/metrics/stream`
* **Route:** `GET /api/v1/metrics/cluster-summary`
* **Features:** Ingests metric batches from all 32 nodes (31 single-GPU workstations + 1 dual-GPU server). Enforces 250 ms decimation window into a static 5.7 MB `Float32Array` circular ring buffer, 10,000-event queue saturation protection (HTTP 429), and 1-hour duplicate batch rejection.

### Story 11.2: Fleet Thermal & Utilization Heatmap Matrix
* **Route:** `GET /api/v1/metrics/heatmap` & `GET /v1/metrics/heatmap`
* **Features:** Outputs sorted matrix of all 32 machines with temperature categorization (`NORMAL` < 75°C, `WARM` 75–84.9°C, `CRITICAL` >= 85°C). Fully preserves independent metric channels for dual-GPU node `server-gpu-01` (gpu_index 0 and 1, INV-08).

### Story 11.3: Token Throughput Spike & Latency Alarm
* **Route:** `POST /v1/alerts/evaluate`
* **Route:** `GET /api/v1/alerts`
* **Features:** Pure anomaly detection engine (AD-03) evaluating 30 s vs 300 s sliding windows. Triggers alerts on token spike ratio >= 10.0 or P99 latency > 8,000 ms. Enforces 3-cycle hysteresis clearing and single-active-alert deduplication via partial unique SQL index.

### Supplementary Operations
* **Executive Utilization Reporting (Operation 3):** `GET /v1/reports/utilization` (7-day hourly rollups, subject-level compute hours, peak contention detection where $u_h \ge 99.9\%$).
* **Frozen Forensic Capture (Operation 4):** `GET /v1/nodes/:node_id/forensics` (Inspects 50-event snapshot and degradation timeline for degraded/offline nodes; auto-clears on recovery).

---

## 5. Architectural Quality Guarantees

* **Domain Purity:** All files under `src/domain/` contain pure algorithms and state machines. Zero framework imports, zero SQLite drivers, and zero system wall-clock reads. All time enters via `ClockPort`.
* **Zero Hallucination:** Strict adherence to `openapi.yaml`. Canonical `ErrorBodyDTO` (`error_code`, `http_status`, `message`, `timestamp_ms`, `retryable`, `details`).
* **Test Suite:** **282 tests passing (100%)**, 0 skipped, 0 failing.
  - 125 architectural purity, schema contract, and BDD scaffold tests.
  - 157 acceptance test-driven development (ATDD) contract tests.
* **Traceability:** 46 matrix rows, 136 test IDs mapped 1:1 to epics, stories, and functional requirements.
