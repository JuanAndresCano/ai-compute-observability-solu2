/**
 * Module 11: AI Infrastructure Observability Console
 * Data Transfer Objects (DTOs) & Typed Schemas
 * File: planning/detailed-design/schemas/dto.ts
 *
 * Hard Rules Enforced:
 * 1. Primitive types only (string, number, boolean, arrays, records).
 * 2. Zero framework imports (no Fastify, Express, WebSocket, or ORM types).
 * 3. Machine-enforceable contracts corresponding 1:1 with contracts.md.
 */

// ============================================================================
// 1. ENUMS & LITERAL UNIONS
// ============================================================================

export type NodeStateType = 
  | 'HEALTHY' 
  | 'STALE' 
  | 'SILENT_TIMEOUT' 
  | 'RECOVERING' 
  | 'CORDONED';

export type AlertSeverityType = 
  | 'INFO' 
  | 'WARNING' 
  | 'CRITICAL';

export type AlertRuleIdType = 
  | 'TOKEN_SPIKE_AND_LATENCY_BREACH' 
  | 'NODE_HEARTBEAT_TIMEOUT' 
  | 'THERMAL_CRITICAL_THRESHOLD';

export type AlertEvaluationStatusType = 
  | 'TRIGGERED' 
  | 'CLEARED' 
  | 'SUPPRESSED_COLD_START';

export type AcademicSubjectType = 
  | 'CS-101' 
  | 'CS-480' 
  | 'CS-530' 
  | 'FAC-RES' 
  | 'IDLE';

// ============================================================================
// 2. CANONICAL ERROR & EXPLANABILITY DTOS
// ============================================================================

export type ErrorCodeType =
  | 'ERR_INVALID_TELEMETRY_PAYLOAD'
  | 'ERR_FUTURE_TIMESTAMP_DRIFT'
  | 'ERR_BUFFER_OVERFLOW'
  | 'ERR_INVALID_ALERT_RULE_SPEC'
  | 'ERR_INVALID_DATE_RANGE'
  | 'ERR_FUTURE_REPORT_QUERY'
  | 'ERR_INVALID_ACADEMIC_SUBJECT'
  | 'ERR_DATABASE_UNAVAILABLE';

export interface ErrorBodyDTO {
  error_code: ErrorCodeType;
  http_status: number;
  message: string;
  timestamp_ms: number;
  retryable: boolean;
  details: Record<string, string | number | boolean>;
}

export interface ExplanationDTO {
  rule_id: string;
  observed_values: Record<string, number | string | boolean>;
  thresholds: Record<string, number | string>;
  justification_text: string;
  empty_state_reason?: string | null;
}

// ============================================================================
// 3. OPERATION 1: TELEMETRY INGESTION DTOS
// ============================================================================

export interface NodeTelemetryPacketDTO {
  node_id: string;              // Regex: ^(ws-gpu-(0[1-9]|[12][0-9]|3[01])|server-gpu-01)$
  gpu_index: number;            // 0 for ws-gpu; 0 or 1 for server-gpu-01
  timestamp_ms: number;         // Unix epoch ms
  temperature_celsius: number;  // Range: -20.0 to 120.0 (single source: contracts.md Op1 P1)
  vram_used_bytes: number;      // >= 0 and <= vram_total_bytes
  vram_total_bytes: number;     // 25769803776 or 51539607552
  gpu_utilization_pct: number;  // 0.0 to 100.0
  active_jobs_count: number;    // >= 0
  current_subject: AcademicSubjectType;
}

export interface InferenceMetricPacketDTO {
  request_id: string;           // UUIDv4
  node_id: string;              // Same regex as NodeTelemetryPacketDTO.node_id
  gpu_index: number;            // 0 for ws-gpu-*; 0 or 1 for server-gpu-01
  model_id: string;             // e.g. "Llama-3-8B-Instruct"
  academic_subject: AcademicSubjectType;
  prompt_tokens: number;        // >= 0
  completion_tokens: number;    // >= 0
  queue_duration_ms: number;    // >= 0.0
  inference_duration_ms: number;// >= 0.0
  total_latency_ms: number;     // queue_duration_ms + inference_duration_ms
  timestamp_ms: number;         // Arrival timestamp
}

export interface MetricBatchDTO {
  batch_id: string;             // Client-generated UUIDv4 for idempotency
  client_timestamp_ms: number;  // Must not exceed clock.nowMs() + 5000
  events: NodeTelemetryPacketDTO[];
  inference_metrics?: InferenceMetricPacketDTO[]; // 0..5000; folded into the Op2 window accumulators
}

export interface IngestionResultDTO {
  accepted_count: number;       // = min(events.length, free capacity)
  dropped_count: number;        // = events.length - accepted_count (tail-drop); visible to the UI
  decimation_bucket_id: string;
  ingested_at_ms: number;
  explanation: ExplanationDTO;
}

// ============================================================================
// 4. OPERATION 2: ANOMALY ALERT EVALUATION DTOS
// ============================================================================

export interface SlidingWindowDTO {
  short_window_seconds: number;   // Exactly 30
  long_window_seconds: number;    // Exactly 300
  histogram_bucket_count: number; // Exactly 100
  // Aggregated samples, assembled by the application service from the Op1 accumulators.
  short_histogram: number[];      // Exactly 100 integers >= 0; bucket i = latencies in [200*i, 200*(i+1)) ms; bucket 99 also holds >= 20,000 ms
  long_histogram: number[];       // Exactly 100 integers >= 0; long_histogram[i] >= short_histogram[i]
  short_window_prompt_tokens: number; // Integer >= 0, tokens in [now-30000, now)
  long_window_prompt_tokens: number;  // Integer >= 0, tokens in [now-300000, now); >= short_window_prompt_tokens
}

export interface AlertRuleDTO {
  rule_id: AlertRuleIdType;
  throughput_spike_multiplier: number; // Exactly 10.0
  p99_latency_threshold_ms: number;     // Exactly 8000.0
  hysteresis_cycles_required: number;   // Exactly 3
}

export interface AnomalyAlertPayloadDTO {
  alert_id: string;             // Regex: ^ALT-[A-Z0-9]{8,16}$
  incident_key: string;         // Unique incident identifier
  severity: AlertSeverityType;
  trigger_rule: AlertRuleIdType;
  timestamp_ms: number;
  observed_metrics: {
    baseline_throughput_tok_per_sec: number;
    current_throughput_tok_per_sec: number;
    spike_factor: number;
    p99_latency_ms: number;
    sla_threshold_ms: number;
    saturated_nodes: string[];
    primary_subject: AcademicSubjectType;
  };
  human_explainability: string;
  acknowledged: boolean;
}

export interface AlertEvaluationDTO {
  evaluation_id: string;
  rule_id: AlertRuleIdType;
  status: AlertEvaluationStatusType;
  evaluated_at_ms: number;
  alert_payload: AnomalyAlertPayloadDTO | null;
  explanation: ExplanationDTO;
}

// ============================================================================
// 5. OPERATION 3: 7-DAY EXECUTIVE UTILIZATION REPORT DTOS
// ============================================================================

export interface ReportQueryDTO {
  query_id: string;             // UUIDv4
  from_timestamp_ms: number;    // Epoch ms, from < to
  to_timestamp_ms: number;      // Epoch ms, to <= clock.nowMs()
  academic_subjects: string[];  // Subset of ["CS-101", "CS-480", "CS-530", "FAC-RES", "ALL"]
}

export interface SubjectBreakdownDTO {
  subject: AcademicSubjectType;
  allocated_gpu_hours: number;
  prompt_tokens: number;
  completion_tokens: number;
  share_pct: number;
}

export interface NodeRollupDTO {
  node_id: string;
  gpu_index: number;
  gpu_hours_busy: number;
  gpu_hours_idle: number;
  gpu_hours_unavailable: number;
  average_temperature_celsius: number;
  average_gpu_utilization_pct: number;
}

export interface ExecutiveReportDTO {
  report_id: string;
  generated_at_ms: number;
  query_window: {
    from_ms: number;
    to_ms: number;
    duration_hours: number;
  };
  summary: {
    total_cluster_gpu_hours: number;
    utilized_gpu_hours: number;
    idle_gpu_hours: number;
    unavailable_gpu_hours: number;
    overall_utilization_pct: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
  };
  by_subject: Record<string, SubjectBreakdownDTO>;
  node_aggregates: NodeRollupDTO[];
  is_empty: boolean;
  explanation: ExplanationDTO;
}
