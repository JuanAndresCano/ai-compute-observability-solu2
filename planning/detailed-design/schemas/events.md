# Event Specification Catalog & Schemas
## Module 11: AI Infrastructure Observability Console
**Document Path:** `planning/detailed-design/schemas/events.md`  
**Status:** APPROVED (Phase 2 Baseline)  
**Standard:** CloudEvents v1.0.2 / JSON Schema Draft-07 Compliant  
**Enforced Envelope:** Every event MUST carry `eventId`, `eventType`, `occurredAt` (UTC, ISO-8601), and `schemaVersion`.

---

## 1. Event Envelope Standard

All events ingested or emitted by Module 11 adhere to this immutable envelope structure:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CloudEventEnvelope",
  "type": "object",
  "required": ["eventId", "eventType", "occurredAt", "schemaVersion", "payload"],
  "properties": {
    "eventId": {
      "type": "string",
      "format": "uuid",
      "description": "Unique event identifier (UUIDv4)."
    },
    "eventType": {
      "type": "string",
      "pattern": "^[a-z]+(\\.[a-z]+)+$",
      "description": "Reverse-DNS style event classification."
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time",
      "description": "UTC timestamp in ISO-8601 format (e.g. 2026-10-19T17:00:00.000Z)."
    },
    "schemaVersion": {
      "type": "string",
      "enum": ["1.0.0"],
      "description": "Semantic schema version."
    },
    "payload": {
      "type": "object",
      "description": "Domain-specific typed event payload."
    }
  }
}
```

---

## 2. Ingested Events (Telemetry & Metrics)

### 2.1 `telemetry.node.heartbeat` (Ingested)
* **Emitter:** Simulated Node Daemons (`adapters/sim/simulated-telemetry-gen.ts`) or physical GPU exporters.
* **Volume:** 32 nodes pushing every $1.0\text{ s}$ baseline, bursting to $5,000\text{ events/sec}$ under stress tests.
* **Schema Definition:**
```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "eventType": "telemetry.node.heartbeat",
  "occurredAt": "2026-10-19T17:00:00.250Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "node_id": "ws-gpu-14",
    "gpu_index": 0,
    "timestamp_ms": 1792429200250,
    "temperature_celsius": 68.5,
    "vram_used_bytes": 19327352832,
    "vram_total_bytes": 25769803776,
    "gpu_utilization_pct": 87.4,
    "active_jobs_count": 2,
    "current_subject": "CS-480"
  }
}
```

### 2.2 `inference.request.completed` (Ingested)
* **Emitter:** In-cluster inference engines (vLLM / Triton / Ollama daemons).
* **Schema Definition:**
```json
{
  "eventId": "a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c",
  "eventType": "inference.request.completed",
  "occurredAt": "2026-10-19T17:00:01.100Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "request_id": "req-cs480-llama3-9081",
    "node_id": "ws-gpu-22",
    "gpu_index": 0,
    "model_id": "Llama-3-8B-Instruct",
    "academic_subject": "CS-480",
    "prompt_tokens": 4096,
    "completion_tokens": 512,
    "queue_duration_ms": 1250.0,
    "inference_duration_ms": 7800.0,
    "total_latency_ms": 9050.0,
    "timestamp_ms": 1792429201100
  }
}
```

---

## 3. Emitted Domain Events (Lifecycle & Audit)

### 3.1 `telemetry.batch.ingested` (Emitted)
* **Emitter:** `BucketDecimator` domain service upon committing a $250\text{ ms}$ summary bucket.
* **Schema Definition:**
```json
{
  "eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "eventType": "telemetry.batch.ingested",
  "occurredAt": "2026-10-19T17:00:00.255Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "decimation_bucket_id": "BUCKET-1792429200000",
    "node_id": "ws-gpu-14",
    "gpu_index": 0,
    "accepted_count": 1250,
    "dropped_count": 0,
    "duration_ms": 250,
    "summary": {
      "temperature_avg": 68.2,
      "gpu_utilization_pct": 86.9,
      "vram_used_bytes": 19327352832
    }
  }
}
```

### 3.2 `alert.anomaly.triggered` (Emitted)
* **Emitter:** `AnomalyDetectionEngine` upon detecting $10\times$ token surge and $P_{99} > 8.0\text{ s}$.
* **Delivery:** Bypasses 4 Hz decimation; dispatches via SSE/WebSocket immediately.
* **Schema Definition:**
```json
{
  "eventId": "3d5f8c2e-4b1a-4c9d-8e7f-6a5b4c3d2e1f",
  "eventType": "alert.anomaly.triggered",
  "occurredAt": "2026-10-19T17:00:15.000Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "alert_id": "ALT-7K3M9Q2X",
    "incident_key": "INC-TOKEN-P99-CLUSTER-1792429215000",
    "severity": "CRITICAL",
    "trigger_rule": "TOKEN_SPIKE_AND_LATENCY_BREACH",
    "observed_metrics": {
      "baseline_throughput_tok_per_sec": 1200.0,
      "current_throughput_tok_per_sec": 13440.0,
      "spike_factor": 11.2,
      "p99_latency_ms": 9450.0,
      "sla_threshold_ms": 8000.0,
      "saturated_nodes": ["ws-gpu-10", "ws-gpu-11", "ws-gpu-12", "ws-gpu-14"],
      "primary_subject": "CS-480"
    },
    "human_explainability": "Token generation surged 11.20x above 300s baseline (13,440.0 vs 1,200.0 tok/s) driven by CS-480 batch jobs, causing P99 queue latency to breach the 8.0s SLA at 9.45s."
  }
}
```

### 3.3 `alert.anomaly.resolved` (Emitted)
* **Emitter:** `AnomalyDetectionEngine` after condition clears for 3 consecutive cycles ($15.0\text{ s}$).
* **Schema Definition:**
```json
{
  "eventId": "2b4c6d8e-0f1a-3c5e-7a9b-1d3f5a7c9e1b",
  "eventType": "alert.anomaly.resolved",
  "occurredAt": "2026-10-19T17:00:30.000Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "alert_id": "ALT-7K3M9Q2X",
    "incident_key": "INC-TOKEN-P99-CLUSTER-1792429215000",
    "status": "CLEARED",
    "resolved_at_ms": 1792429230000,
    "clearance_reason": "Observed metrics returned below breach thresholds for 3 consecutive 5-second evaluation cycles (15.0s hysteresis)."
  }
}
```

### 3.4 `node.state.transitioned` (Emitted)
* **Emitter:** `NodeHeartbeatWatchdog` on state changes (e.g. `HEALTHY` $\to$ `SILENT_TIMEOUT`).
* **Schema Definition:**
```json
{
  "eventId": "9e8d7c6b-5a4f-3e2d-1c0b-a9b8c7d6e5f4",
  "eventType": "node.state.transitioned",
  "occurredAt": "2026-10-19T17:00:15.000Z",
  "schemaVersion": "1.0.0",
  "payload": {
    "node_id": "ws-gpu-22",
    "previous_state": "STALE",
    "new_state": "SILENT_TIMEOUT",
    "silence_duration_seconds": 15.2,
    "consecutive_missed_heartbeats": 3,
    "action_required": "FLAG_NODE_FOR_CORDON",
    "last_known_telemetry": {
      "timestamp_ms": 1792429199800,
      "temperature_celsius": 82.1,
      "vram_used_bytes": 24100000000,
      "last_job_id": "job-cs480-lora-run-84"
    }
  }
}
```
