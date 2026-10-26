-- Migration: 001_observability_schema.sql
-- Module 11: AI Infrastructure Observability Console
-- Target: SQLite 3 / PostgreSQL Compatible DDL
-- Enforces: AD-01, AD-02, AD-03, AD-04, AD-05, AD-06, AD-08 physically at storage level (v1.2: node_forensics)

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 1. CLUSTER NODES (The 32 Physical Machines & 33 GPUs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cluster_nodes (
    node_id TEXT NOT NULL,
    gpu_index INTEGER NOT NULL CHECK (gpu_index IN (0, 1)),
    node_type TEXT NOT NULL CHECK (node_type IN ('WORKSTATION', 'CENTRAL_SERVER')),
    vram_total_bytes INTEGER NOT NULL CHECK (vram_total_bytes IN (25769803776, 51539607552)),
    -- Seed value only: the live node state is node_heartbeats.state (single source of truth, written by NodeMonitorService.tick())
    current_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (current_state IN ('HEALTHY', 'STALE', 'SILENT_TIMEOUT', 'RECOVERING', 'CORDONED')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (node_id, gpu_index),
    -- Physical Invariant INV-08 / AD-08: Workstations MUST strictly have gpu_index = 0
    CONSTRAINT chk_node_gpu_topology CHECK (
        (node_type = 'WORKSTATION' AND gpu_index = 0 AND vram_total_bytes = 25769803776) OR
        (node_type = 'CENTRAL_SERVER' AND node_id = 'server-gpu-01' AND vram_total_bytes = 51539607552)
    )
);

-- ----------------------------------------------------------------------------
-- 2. DECIMATED TELEMETRY BUCKETS (250 ms / 4 Hz Summaries)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_buckets (
    bucket_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    gpu_index INTEGER NOT NULL,
    bucket_start_ms INTEGER NOT NULL CHECK (bucket_start_ms > 0),
    temperature_min REAL NOT NULL,
    temperature_max REAL NOT NULL,
    temperature_avg REAL NOT NULL,
    vram_used_bytes INTEGER NOT NULL,
    gpu_utilization_pct REAL NOT NULL,
    prompt_tokens_per_sec REAL NOT NULL DEFAULT 0.0,
    completion_tokens_per_sec REAL NOT NULL DEFAULT 0.0,
    p99_latency_ms REAL NOT NULL DEFAULT 0.0,
    event_count INTEGER NOT NULL CHECK (event_count > 0),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (node_id, gpu_index, bucket_start_ms),
    FOREIGN KEY (node_id, gpu_index) REFERENCES cluster_nodes(node_id, gpu_index) ON DELETE CASCADE,
    -- Physical Invariant: Values must reside within valid physical telemetry boundaries
    CONSTRAINT chk_telemetry_bounds CHECK (
        temperature_min <= temperature_max AND
        temperature_min >= -20.0 AND
        temperature_max <= 120.0 AND
        gpu_utilization_pct >= 0.0 AND
        gpu_utilization_pct <= 100.0 AND
        vram_used_bytes >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_telemetry_buckets_window 
ON telemetry_buckets(node_id, gpu_index, bucket_start_ms DESC);

-- ----------------------------------------------------------------------------
-- 3. OPERATIONAL ALERTS (Anomalies & Timeouts with Cooldown Enforcement)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operational_alerts (
    alert_id TEXT PRIMARY KEY CHECK (alert_id GLOB 'ALT-*'),
    -- One identifier per incident (resolved or not): 'INC-TOKEN-P99-CLUSTER-<triggered_at_ms>' (AMD-3)
    incident_key TEXT NOT NULL UNIQUE,
    -- 'CLUSTER' for cluster-wide rules; otherwise one of the 32 registered node IDs
    node_id TEXT NOT NULL CHECK (
        node_id = 'CLUSTER' OR node_id = 'server-gpu-01' OR
        (node_id GLOB 'ws-gpu-[0-3][0-9]' AND substr(node_id, 8, 2) BETWEEN '01' AND '31')
    ),
    trigger_rule TEXT NOT NULL CHECK (trigger_rule IN ('TOKEN_SPIKE_AND_LATENCY_BREACH', 'NODE_HEARTBEAT_TIMEOUT')),
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    status TEXT NOT NULL DEFAULT 'TRIGGERED' CHECK (status IN ('TRIGGERED', 'CLEARED', 'ACKNOWLEDGED')),
    observed_baseline_tps REAL NOT NULL,
    observed_current_tps REAL NOT NULL,
    spike_ratio REAL NOT NULL,
    observed_p99_latency_ms REAL NOT NULL,
    explanation_json TEXT NOT NULL,
    triggered_at_ms INTEGER NOT NULL,
    resolved_at_ms INTEGER,
    -- Persisted 3-cycle hysteresis (AMD-11): survives a process restart; cycle = floor(nowMs / 5000)
    consecutive_clear_cycles INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_clear_cycles BETWEEN 0 AND 3),
    last_cycle_index INTEGER,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CONSTRAINT chk_alert_resolution_order CHECK (resolved_at_ms IS NULL OR resolved_at_ms >= triggered_at_ms)
);

-- Physical Invariant INV-05 / AD-05: AT MOST ONE active (unresolved) alert per (trigger_rule, node_id).
-- Conflict target of the atomic insert: ON CONFLICT (trigger_rule, node_id) WHERE resolved_at_ms IS NULL DO NOTHING
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_alert 
ON operational_alerts(trigger_rule, node_id) 
WHERE resolved_at_ms IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_node_active 
ON operational_alerts(node_id, status) 
WHERE status = 'TRIGGERED';

-- ----------------------------------------------------------------------------
-- 4. NODE HEARTBEAT STATE MACHINE (Hysteresis & Watchdog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_heartbeats (
    node_id TEXT PRIMARY KEY,
    last_heartbeat_ms INTEGER NOT NULL,
    consecutive_missed INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_missed >= 0),
    consecutive_healthy INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_healthy >= 0),
    state TEXT NOT NULL CHECK (state IN ('HEALTHY', 'STALE', 'SILENT_TIMEOUT', 'RECOVERING', 'CORDONED')),
    updated_at_ms INTEGER NOT NULL,
    -- Physical Invariant INV-04 / AD-04: Timeout state requires at least 3 missed intervals (>= 15s)
    CONSTRAINT chk_watchdog_hysteresis CHECK (
        (state != 'SILENT_TIMEOUT') OR (consecutive_missed >= 3)
    )
);

-- ----------------------------------------------------------------------------
-- 3b. INGESTED BATCH IDS (Op1 idempotency, AMD-19): INSERT OR IGNORE -> 1 row = new batch, 0 rows = replay
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingested_batches (
    batch_id TEXT PRIMARY KEY CHECK (length(batch_id) = 36),
    ingested_at_ms INTEGER NOT NULL CHECK (ingested_at_ms > 0)
);

-- ----------------------------------------------------------------------------
-- 4b. NODE FORENSICS (FR-03, Op4): frozen at the moment a node leaves HEALTHY, deleted when it returns to HEALTHY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_forensics (
    node_id TEXT PRIMARY KEY CHECK (
        node_id = 'server-gpu-01' OR
        (node_id GLOB 'ws-gpu-[0-3][0-9]' AND substr(node_id, 8, 2) BETWEEN '01' AND '31')
    ),
    last_heartbeat_ms INTEGER NOT NULL CHECK (last_heartbeat_ms > 0),
    last_snapshot_json TEXT CHECK (last_snapshot_json IS NULL OR json_valid(last_snapshot_json)),
    -- Physical Invariant Op4 I1 / AD-04: at most 50 preserved log lines
    log_tail_json TEXT NOT NULL CHECK (json_valid(log_tail_json) AND json_array_length(log_tail_json) <= 50),
    last_job_json TEXT CHECK (last_job_json IS NULL OR json_valid(last_job_json)),
    captured_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- 5. EXECUTIVE 1-HOUR HOURLY ROLLUPS (7-Day Pre-Aggregated Analytic Storage)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rollup_hourly_metrics (
    node_id TEXT NOT NULL,
    gpu_index INTEGER NOT NULL,
    hour_epoch INTEGER NOT NULL CHECK (hour_epoch > 0), -- Unix SECONDS truncated to 1 hour (contracts.md Op3 Q1a; hour_start_ms = hour_epoch * 1000)
    gpu_hours_busy REAL NOT NULL CHECK (gpu_hours_busy >= 0.0 AND gpu_hours_busy <= 1.0001),
    gpu_hours_idle REAL NOT NULL CHECK (gpu_hours_idle >= 0.0 AND gpu_hours_idle <= 1.0001),
    -- GPU-hours in which the GPU was not HEALTHY (STALE / SILENT_TIMEOUT / RECOVERING / CORDONED) (AMD-8)
    gpu_hours_unavailable REAL NOT NULL DEFAULT 0.0 CHECK (gpu_hours_unavailable >= 0.0 AND gpu_hours_unavailable <= 1.0001),
    prompt_tokens_total INTEGER NOT NULL CHECK (prompt_tokens_total >= 0),
    completion_tokens_total INTEGER NOT NULL CHECK (completion_tokens_total >= 0),
    primary_subject TEXT NOT NULL CHECK (primary_subject IN ('CS-101', 'CS-480', 'CS-530', 'FAC-RES', 'IDLE')),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (node_id, gpu_index, hour_epoch),
    FOREIGN KEY (node_id, gpu_index) REFERENCES cluster_nodes(node_id, gpu_index) ON DELETE CASCADE,
    -- Physical Invariant INV-06 / AD-06: every GPU-hour is fully accounted for: busy + idle + unavailable = 1.0 ± 0.001
    CONSTRAINT chk_hourly_gpu_sum CHECK (ABS((gpu_hours_busy + gpu_hours_idle + gpu_hours_unavailable) - 1.0) <= 0.001)
);

CREATE INDEX IF NOT EXISTS idx_rollups_query_window 
ON rollup_hourly_metrics(hour_epoch, primary_subject);

-- ----------------------------------------------------------------------------
-- 6. AUDIT EVENTS LOG (Immutable Append-Only Compliance Record)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_time 
ON audit_events(occurred_at_ms DESC);
