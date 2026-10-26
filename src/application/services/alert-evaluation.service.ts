import type { AlertRuleDTO, SlidingWindowDTO, AlertEvaluationDTO, AnomalyAlertPayloadDTO } from '../../dto';
import type { AlertEvaluationPort } from '../../ports/in/alert-evaluation.port';
import type { Deps } from '../../composition';
import type { AlertRecord } from '../../ports/out/alert-repository.port';
import { AnomalyDetectionEngine } from '../../domain/services/anomaly-detector';
import { ContractError, StorageUnavailableError } from '../../shared/errors';

export class AlertEvaluationService implements AlertEvaluationPort {
  private readonly engine = new AnomalyDetectionEngine();

  constructor(private readonly deps: Deps) {}

  async evaluateAlertRule(rule: AlertRuleDTO, window: SlidingWindowDTO): Promise<AlertEvaluationDTO> {
    const nowMs = this.deps.clock.nowMs();

    // P1 Validation
    if (
      !rule ||
      rule.rule_id !== 'TOKEN_SPIKE_AND_LATENCY_BREACH' ||
      window.short_window_seconds !== 30 ||
      window.long_window_seconds !== 300 ||
      window.histogram_bucket_count !== 100 ||
      !Array.isArray(window.short_histogram) ||
      window.short_histogram.length !== 100 ||
      !Array.isArray(window.long_histogram) ||
      window.long_histogram.length !== 100 ||
      !Number.isInteger(window.short_window_prompt_tokens) ||
      window.short_window_prompt_tokens < 0 ||
      !Number.isInteger(window.long_window_prompt_tokens) ||
      window.long_window_prompt_tokens < 0 ||
      window.long_window_prompt_tokens < window.short_window_prompt_tokens
    ) {
      throw new ContractError({
        error_code: 'ERR_INVALID_ALERT_RULE_SPEC',
        http_status: 422,
        message: 'Invalid alert rule or window specification',
        timestamp_ms: nowMs,
        retryable: false,
        details: {},
      });
    }

    for (let i = 0; i < 100; i++) {
      const s = window.short_histogram[i]!;
      const l = window.long_histogram[i]!;
      if (!Number.isInteger(s) || s < 0 || !Number.isInteger(l) || l < 0 || l < s) {
        throw new ContractError({
          error_code: 'ERR_INVALID_ALERT_RULE_SPEC',
          http_status: 422,
          message: `Bucket ${i} specification invalid: short=${s}, long=${l}`,
          timestamp_ms: nowMs,
          retryable: false,
          details: { bucket: i, short: s, long: l },
        });
      }
    }

    const verdict = this.engine.evaluate(rule, window);
    const evaluationId = this.deps.ids.uuid();

    // Cold start suppression
    if (verdict.suppressedColdStart) {
      return {
        evaluation_id: evaluationId,
        rule_id: rule.rule_id,
        status: 'SUPPRESSED_COLD_START',
        evaluated_at_ms: nowMs,
        alert_payload: null,
        explanation: {
          rule_id: 'AD-03-ANOMALY-EVAL',
          observed_values: {
            observed_samples: verdict.observedSamples,
          },
          thresholds: {
            required_samples: 50,
          },
          justification_text: `Suppressed cold start: observed ${verdict.observedSamples} samples in long window, minimum 50 required (AD-03).`,
        },
      };
    }

    // Storage call with error wrapping
    try {
      if (verdict.breach) {
        const incidentKey = `INC-TOKEN-P99-CLUSTER-${nowMs}`;
        const alertId = this.deps.ids.alertId();

        const recordToInsert: AlertRecord = {
          alert_id: alertId,
          incident_key: incidentKey,
          node_id: 'CLUSTER',
          trigger_rule: rule.rule_id,
          status: 'TRIGGERED',
          triggered_at_ms: nowMs,
          resolved_at_ms: null,
          consecutive_clear_cycles: 0,
          severity: 'CRITICAL',
          observed_baseline_tps: verdict.baselineTps,
          observed_current_tps: verdict.currentTps,
          spike_ratio: verdict.spikeRatio ?? 0,
          observed_p99_latency_ms: verdict.p99Ms,
          explanation_json: JSON.stringify({
            spike_ratio: verdict.spikeRatio ?? 0,
            p99_latency_ms: verdict.p99Ms,
          }),
          created_at_ms: nowMs,
          updated_at_ms: nowMs,
        };

        const { inserted, alert } = await this.deps.alerts.insertActiveIfAbsent(recordToInsert);

        if (inserted) {
          this.deps.events.emit({
            eventType: 'alert.anomaly.triggered',
            occurredAtMs: nowMs,
            payload: {
              alert_id: alert.alert_id,
              incident_key: alert.incident_key,
              rule_id: rule.rule_id,
            },
          });
          this.deps.metrics.increment('alerts_emitted_total', { rule_id: rule.rule_id }, 1);
        } else {
          await this.deps.alerts.resetClearCounter(rule.rule_id, 'CLUSTER');
        }

        const alertPayload: AnomalyAlertPayloadDTO = {
          alert_id: alert.alert_id,
          incident_key: alert.incident_key,
          severity: 'CRITICAL',
          trigger_rule: rule.rule_id,
          timestamp_ms: alert.triggered_at_ms,
          observed_metrics: {
            baseline_throughput_tok_per_sec: verdict.baselineTps,
            current_throughput_tok_per_sec: verdict.currentTps,
            spike_factor: verdict.spikeRatio ?? 0,
            p99_latency_ms: verdict.p99Ms,
            sla_threshold_ms: 8000.0,
            saturated_nodes: [],
            primary_subject: 'CS-480',
          },
          human_explainability: `Token throughput spiked to ${verdict.currentTps.toFixed(1)} tok/s with P99 latency ${verdict.p99Ms.toFixed(1)} ms.`,
          acknowledged: false,
        };

        return {
          evaluation_id: evaluationId,
          rule_id: rule.rule_id,
          status: 'TRIGGERED',
          evaluated_at_ms: nowMs,
          alert_payload: alertPayload,
          explanation: {
            rule_id: 'AD-03-ANOMALY-EVAL',
            observed_values: {
              observed_baseline_tok_per_sec: verdict.baselineTps,
              observed_current_tok_per_sec: verdict.currentTps,
              spike_ratio: verdict.spikeRatio ?? 0,
              observed_p99_latency_ms: verdict.p99Ms,
            },
            thresholds: {
              threshold_ms: 8000,
            },
            justification_text: `Breach detected: spike ratio ${verdict.spikeRatio?.toFixed(2)} and P99 ${verdict.p99Ms} ms exceed threshold.`,
          },
        };
      }

      // No breach
      const cycle = Math.floor(nowMs / 5000);

      if (verdict.p99Exceeded) {
        // Sustained latency degradation: reset counter
        const activeAlert = await this.deps.alerts.resetClearCounter(rule.rule_id, 'CLUSTER');
        if (activeAlert) {
          const alertPayload: AnomalyAlertPayloadDTO = {
            alert_id: activeAlert.alert_id,
            incident_key: activeAlert.incident_key,
            severity: 'CRITICAL',
            trigger_rule: rule.rule_id,
            timestamp_ms: activeAlert.triggered_at_ms,
            observed_metrics: {
              baseline_throughput_tok_per_sec: verdict.baselineTps,
              current_throughput_tok_per_sec: verdict.currentTps,
              spike_factor: verdict.spikeRatio ?? 0,
              p99_latency_ms: verdict.p99Ms,
              sla_threshold_ms: 8000.0,
              saturated_nodes: [],
              primary_subject: 'CS-480',
            },
            human_explainability: `Sustained latency degradation: P99 latency ${verdict.p99Ms.toFixed(1)} ms.`,
            acknowledged: false,
          };

          return {
            evaluation_id: evaluationId,
            rule_id: rule.rule_id,
            status: 'TRIGGERED',
            evaluated_at_ms: nowMs,
            alert_payload: alertPayload,
            explanation: {
              rule_id: 'AD-03-ANOMALY-EVAL',
              observed_values: {
                observed_baseline_tok_per_sec: verdict.baselineTps,
                observed_current_tok_per_sec: verdict.currentTps,
                spike_ratio: verdict.spikeRatio ?? 0,
                observed_p99_latency_ms: verdict.p99Ms,
              },
              thresholds: {
                threshold_ms: 8000,
              },
              justification_text: `Sustained P99 breach: ${verdict.p99Ms} ms > 8000 ms.`,
            },
          };
        }

        return {
          evaluation_id: evaluationId,
          rule_id: rule.rule_id,
          status: 'CLEARED',
          evaluated_at_ms: nowMs,
          alert_payload: null,
          explanation: {
            rule_id: 'AD-03-ANOMALY-EVAL',
            observed_values: {
              observed_baseline_tok_per_sec: verdict.baselineTps,
              observed_current_tok_per_sec: verdict.currentTps,
              spike_ratio: verdict.spikeRatio ?? 0,
              observed_p99_latency_ms: verdict.p99Ms,
            },
            thresholds: {
              threshold_ms: 8000,
            },
            justification_text: 'No active alert and no breach.',
          },
        };
      }

      // Calm (P99 <= 8000 ms)
      const updated = await this.deps.alerts.countClearCycle(rule.rule_id, 'CLUSTER', cycle, nowMs);

      if (!updated) {
        return {
          evaluation_id: evaluationId,
          rule_id: rule.rule_id,
          status: 'CLEARED',
          evaluated_at_ms: nowMs,
          alert_payload: null,
          explanation: {
            rule_id: 'AD-03-ANOMALY-EVAL',
            observed_values: {
              observed_baseline_tok_per_sec: verdict.baselineTps,
              observed_current_tok_per_sec: verdict.currentTps,
              spike_ratio: verdict.spikeRatio ?? 0,
              observed_p99_latency_ms: verdict.p99Ms,
            },
            thresholds: {
              threshold_ms: 8000,
            },
            justification_text: 'Calm window: no active alert.',
          },
        };
      }

      if (updated.status === 'CLEARED') {
        this.deps.events.emit({
          eventType: 'alert.anomaly.resolved',
          occurredAtMs: nowMs,
          payload: {
            alert_id: updated.alert_id,
            incident_key: updated.incident_key,
          },
        });

        return {
          evaluation_id: evaluationId,
          rule_id: rule.rule_id,
          status: 'CLEARED',
          evaluated_at_ms: nowMs,
          alert_payload: null,
          explanation: {
            rule_id: 'AD-03-ANOMALY-EVAL',
            observed_values: {
              observed_baseline_tok_per_sec: verdict.baselineTps,
              observed_current_tok_per_sec: verdict.currentTps,
              spike_ratio: verdict.spikeRatio ?? 0,
              observed_p99_latency_ms: verdict.p99Ms,
            },
            thresholds: {
              threshold_ms: 8000,
            },
            justification_text: 'Active alert resolved after 3 consecutive clear cycles.',
          },
        };
      }

      // Still TRIGGERED during hysteresis clearing
      const alertPayload: AnomalyAlertPayloadDTO = {
        alert_id: updated.alert_id,
        incident_key: updated.incident_key,
        severity: 'CRITICAL',
        trigger_rule: rule.rule_id,
        timestamp_ms: updated.triggered_at_ms,
        observed_metrics: {
          baseline_throughput_tok_per_sec: verdict.baselineTps,
          current_throughput_tok_per_sec: verdict.currentTps,
          spike_factor: verdict.spikeRatio ?? 0,
          p99_latency_ms: verdict.p99Ms,
          sla_threshold_ms: 8000.0,
          saturated_nodes: [],
          primary_subject: 'CS-480',
        },
        human_explainability: `Hysteresis cycle ${updated.consecutive_clear_cycles}/3 towards resolution.`,
        acknowledged: false,
      };

      return {
        evaluation_id: evaluationId,
        rule_id: rule.rule_id,
        status: 'TRIGGERED',
        evaluated_at_ms: nowMs,
        alert_payload: alertPayload,
        explanation: {
          rule_id: 'AD-03-ANOMALY-EVAL',
          observed_values: {
            observed_baseline_tok_per_sec: verdict.baselineTps,
            observed_current_tok_per_sec: verdict.currentTps,
            spike_ratio: verdict.spikeRatio ?? 0,
            observed_p99_latency_ms: verdict.p99Ms,
          },
          thresholds: {
            threshold_ms: 8000,
          },
          justification_text: `Clearing in progress (${updated.consecutive_clear_cycles}/3 clear cycles).`,
        },
      };
    } catch (err: any) {
      if (err instanceof ContractError) throw err;
      throw new ContractError({
        error_code: 'ERR_DATABASE_UNAVAILABLE',
        http_status: 503,
        message: err?.message || 'Storage unavailable',
        timestamp_ms: nowMs,
        retryable: true,
        details: {},
      });
    }
  }
}
