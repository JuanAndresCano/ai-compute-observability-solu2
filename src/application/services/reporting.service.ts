import type {
  ReportQueryDTO,
  ExecutiveReportDTO,
  SubjectBreakdownDTO,
  NodeRollupDTO,
  AcademicSubjectType,
} from '../../dto';
import type { ReportingPort } from '../../ports/in/reporting.port';
import type { Deps } from '../../composition';
import { ContractError, StorageUnavailableError } from '../../shared/errors';

const VALID_SUBJECT_FILTERS = new Set(['CS-101', 'CS-480', 'CS-530', 'FAC-RES', 'ALL']);
const ACADEMIC_SUBJECTS = new Set(['CS-101', 'CS-480', 'CS-530', 'FAC-RES']);

export class ReportingService implements ReportingPort {
  constructor(private readonly deps: Deps) {}

  async buildUtilizationReport(query: ReportQueryDTO): Promise<ExecutiveReportDTO> {
    const nowMs = this.deps.clock.nowMs();

    // P1: Date range checks
    if (
      !query ||
      typeof query.from_timestamp_ms !== 'number' ||
      typeof query.to_timestamp_ms !== 'number' ||
      !Number.isInteger(query.from_timestamp_ms) ||
      !Number.isInteger(query.to_timestamp_ms) ||
      query.from_timestamp_ms <= 0 ||
      query.to_timestamp_ms <= 0 ||
      query.from_timestamp_ms >= query.to_timestamp_ms ||
      query.to_timestamp_ms - query.from_timestamp_ms > 604_800_000
    ) {
      throw new ContractError({
        error_code: 'ERR_INVALID_DATE_RANGE',
        http_status: 400,
        message: 'Invalid date range: must be positive integers, from < to, duration <= 168 hours',
        timestamp_ms: nowMs,
        retryable: false,
        details: {},
      });
    }

    // P2: Future upper bound barrier
    if (query.to_timestamp_ms > nowMs) {
      throw new ContractError({
        error_code: 'ERR_FUTURE_REPORT_QUERY',
        http_status: 422,
        message: `Report query upper bound ${query.to_timestamp_ms} extends into the future relative to current clock ${nowMs}`,
        timestamp_ms: nowMs,
        retryable: false,
        details: { to_timestamp_ms: query.to_timestamp_ms, now_ms: nowMs },
      });
    }

    // P3: Subject filter validation
    if (
      !query.academic_subjects ||
      !Array.isArray(query.academic_subjects) ||
      query.academic_subjects.length === 0 ||
      query.academic_subjects.some((s) => !VALID_SUBJECT_FILTERS.has(s))
    ) {
      const bad =
        query.academic_subjects?.find((s) => !VALID_SUBJECT_FILTERS.has(s)) ??
        (Array.isArray(query.academic_subjects) ? query.academic_subjects.join(',') : '');
      throw new ContractError({
        error_code: 'ERR_INVALID_ACADEMIC_SUBJECT',
        http_status: 400,
        message: `Academic subject filter '${bad}' is invalid. Allowed: CS-101, CS-480, CS-530, FAC-RES, ALL.`,
        timestamp_ms: nowMs,
        retryable: false,
        details: { subjects: query.academic_subjects.join(',') },
      });
    }

    try {
      const rows = await this.deps.rollups.queryHourly(
        query.from_timestamp_ms,
        query.to_timestamp_ms,
        query.academic_subjects,
      );

      const scannedBucketsCount = rows.length;
      let totalClusterGpuHours = 0;
      let utilizedGpuHours = 0;
      let idleGpuHours = 0;
      let unavailableGpuHours = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      // Maps for subject breakdown, node aggregates, and hourly contention
      const subjectMap = new Map<
        string,
        { allocated_gpu_hours: number; prompt_tokens: number; completion_tokens: number }
      >();
      const nodeMap = new Map<
        string,
        { node_id: string; gpu_index: number; busy: number; idle: number; unavailable: number }
      >();
      const hourMap = new Map<number, { busy: number; total: number }>();

      for (const row of rows) {
        const busy = row.gpu_hours_busy;
        const idle = row.gpu_hours_idle;
        const unavailable = row.gpu_hours_unavailable;
        const total = busy + idle + unavailable;

        totalClusterGpuHours += total;
        utilizedGpuHours += busy;
        idleGpuHours += idle;
        unavailableGpuHours += unavailable;
        totalPromptTokens += row.prompt_tokens_total;
        totalCompletionTokens += row.completion_tokens_total;

        // Subject breakdown (only academic subjects, ignore IDLE)
        if (ACADEMIC_SUBJECTS.has(row.primary_subject)) {
          let s = subjectMap.get(row.primary_subject);
          if (!s) {
            s = { allocated_gpu_hours: 0, prompt_tokens: 0, completion_tokens: 0 };
            subjectMap.set(row.primary_subject, s);
          }
          s.allocated_gpu_hours += busy;
          s.prompt_tokens += row.prompt_tokens_total;
          s.completion_tokens += row.completion_tokens_total;
        }

        // Node aggregates
        const nodeKey = `${row.node_id}:${row.gpu_index}`;
        let n = nodeMap.get(nodeKey);
        if (!n) {
          n = { node_id: row.node_id, gpu_index: row.gpu_index, busy: 0, idle: 0, unavailable: 0 };
          nodeMap.set(nodeKey, n);
        }
        n.busy += busy;
        n.idle += idle;
        n.unavailable += unavailable;

        // Hourly contention
        let h = hourMap.get(row.hour_epoch_s);
        if (!h) {
          h = { busy: 0, total: 0 };
          hourMap.set(row.hour_epoch_s, h);
        }
        h.busy += busy;
        h.total += total;
      }

      const overallUtilizationPct =
        totalClusterGpuHours === 0 ? 0 : (utilizedGpuHours / totalClusterGpuHours) * 100;

      const totalTokens = totalPromptTokens + totalCompletionTokens;

      const bySubject: Record<string, SubjectBreakdownDTO> = {};
      for (const [subj, data] of subjectMap.entries()) {
        const subjTokens = data.prompt_tokens + data.completion_tokens;
        const sharePct = totalTokens === 0 ? 0 : (subjTokens / totalTokens) * 100;
        bySubject[subj] = {
          subject: subj as AcademicSubjectType,
          allocated_gpu_hours: data.allocated_gpu_hours,
          prompt_tokens: data.prompt_tokens,
          completion_tokens: data.completion_tokens,
          share_pct: sharePct,
        };
      }

      const nodeAggregates: NodeRollupDTO[] = Array.from(nodeMap.values())
        .map((n) => ({
          node_id: n.node_id,
          gpu_index: n.gpu_index,
          gpu_hours_busy: n.busy,
          gpu_hours_idle: n.idle,
          gpu_hours_unavailable: n.unavailable,
        }))
        .sort((a, b) => {
          if (a.node_id === b.node_id) return a.gpu_index - b.gpu_index;
          return a.node_id.localeCompare(b.node_id);
        });

      const peakContentionWindows: { hour_start_ms: number; utilization_pct: number }[] = [];
      const sortedHours = Array.from(hourMap.keys()).sort((a, b) => a - b);
      for (const h of sortedHours) {
        const stats = hourMap.get(h)!;
        const pct = stats.total === 0 ? 0 : (stats.busy / stats.total) * 100;
        if (pct >= 99.9 - 1e-6) {
          peakContentionWindows.push({
            hour_start_ms: h * 1000,
            utilization_pct: pct,
          });
        }
      }

      const isEmpty =
        scannedBucketsCount === 0 ||
        (utilizedGpuHours === 0 && totalPromptTokens === 0 && totalCompletionTokens === 0);

      const reportId = this.deps.ids.uuid();

      // Q3: Audit event and metric
      const rangeHours = Math.round((query.to_timestamp_ms - query.from_timestamp_ms) / 3_600_000);
      this.deps.events.emit({
        eventType: 'report.utilization.generated',
        occurredAtMs: nowMs,
        payload: {
          report_id: reportId,
          actor: 'MANAGEMENT',
          range_hours: rangeHours,
        },
      });

      this.deps.metrics.increment('executive_reports_generated_total', { status: 'SUCCESS' }, 1);

      return {
        report_id: reportId,
        generated_at_ms: nowMs,
        query_window: {
          from_ms: query.from_timestamp_ms,
          to_ms: query.to_timestamp_ms,
          duration_hours: rangeHours,
        },
        summary: {
          total_cluster_gpu_hours: totalClusterGpuHours,
          utilized_gpu_hours: utilizedGpuHours,
          idle_gpu_hours: idleGpuHours,
          unavailable_gpu_hours: unavailableGpuHours,
          overall_utilization_pct: overallUtilizationPct,
          total_prompt_tokens: totalPromptTokens,
          total_completion_tokens: totalCompletionTokens,
        },
        by_subject: bySubject,
        node_aggregates: nodeAggregates,
        peak_contention_windows: peakContentionWindows,
        is_empty: isEmpty,
        explanation: {
          rule_id: 'AD-06-HOURLY-ROLLUPS',
          observed_values: {
            scanned_buckets_count: scannedBucketsCount,
          },
          thresholds: {
            resolution_minutes: 60,
          },
          empty_state_reason: isEmpty ? 'NO_WORKLOADS_FOUND_IN_WINDOW' : null,
          justification_text: isEmpty
            ? 'No workloads found in window.'
            : `Aggregated 7-day executive report from ${scannedBucketsCount} hourly buckets.`,
        },
      };
    } catch (err: any) {
      if (err instanceof ContractError) throw err;
      throw new ContractError({
        error_code: 'ERR_DATABASE_UNAVAILABLE',
        http_status: 503,
        message: err?.message || 'Storage engine unavailable',
        timestamp_ms: nowMs,
        retryable: true,
        details: {},
      });
    }
  }
}
