import { expect } from 'vitest';
import type { ExplanationDTO } from '../../src/dto';

/**
 * A decision is explainable iff it cites a non-empty rule id AND the observed values and thresholds it used.
 * `observed`/`thresholds` assert exact values; `observedKeys` only demands presence.
 */
export function assertExplanation(
  exp: ExplanationDTO | undefined | null,
  spec: { ruleId: string; observed?: Record<string, unknown>; observedKeys?: string[]; thresholds?: Record<string, unknown>; cited?: Record<string, unknown> },
): void {
  expect(exp, 'explanation must be present').toBeTruthy();
  const e = exp as ExplanationDTO;
  expect(typeof e.rule_id).toBe('string');
  expect(e.rule_id.length).toBeGreaterThan(0);
  expect(e.rule_id).toBe(spec.ruleId);
  expect(Object.keys(e.observed_values).length, 'explanation must cite at least one observed value').toBeGreaterThan(0);
  for (const k of spec.observedKeys ?? []) expect(e.observed_values, `observed_values.${k}`).toHaveProperty(k);
  if (spec.observed) expect(e.observed_values).toMatchObject(spec.observed);
  if (spec.thresholds) expect(e.thresholds).toMatchObject(spec.thresholds);
  // `cited`: the contract names the value but not whether it is an observed value or a threshold; either map is accepted.
  for (const [k, v] of Object.entries(spec.cited ?? {})) {
    const found = k in e.observed_values ? e.observed_values[k] : e.thresholds[k];
    expect(found, `explanation must cite ${k}`).toBe(v);
  }
}
