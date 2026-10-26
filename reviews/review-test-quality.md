# Test Quality Review — Phase 3 (`bmad-testarch-test-review` criteria)

**Target:** `test/atdd/observability_contracts.test.ts` (133 cases), `test/schema/` (31), `test/harness/` (32), `test/architecture/` (37), fixtures in `test/fixtures/`, `test/support/`
**Reviewer:** Partner B (author of the suite) with Claude Code, plus the **independent re-review by Partner A (Juand) on 2026-10-26: PASS (TQ-A CLOSED)**. His scope: the ATDD, schema, harness and architecture suites and the fixtures; criteria: no tautologies, deterministic time, isolation, red for the right reason (`red-guard`), mutation of the DDL. He cites 11 of 11 schema mutants killed; the current mutation set has 15 (adds 4 in Phase 4), all killed.
**Date:** 2026-10-26 · *Counts below are those of the review moment (133 red / 100 green). After the Phase 4 amendments the suite is 157 red / 117 green; the findings and checks still apply and `npm run ci` is the live source.* · **Criteria:** determinism, isolation, explicit assertions, no hard waits, traceable IDs, no tautologies, right-reason failure, strength against mutation.

## 1. Checks executed (all reproducible)

| # | Check | Command / method | Result |
|:-:|---|---|---|
| 1 | Typecheck, strict | `npm run typecheck` | 0 errors |
| 2 | Harness + schema + architecture suites | `npm test` | **100 / 100 green** |
| 3 | ATDD is red for the right reason | `npm run test:atdd:guard` | **133 / 133 red, all `NotImplementedError`**, 0 passed, 0 skipped |
| 4 | The guard itself works | injected a passing case, a skipped case and a `TypeError` case in `test/atdd/zz_probe.test.ts` (then deleted) | guard exited 1 and named all three |
| 5 | Traceability has no broken link | `npm run trace:check` | 41 rows, 111 ids, 0 orphan tests, 8/8 bound invariant tests exist; broken link injected → exit 1 |
| 6 | Physical constraints are really tested | 11 DDL mutants (drop unique index, neutralise each `CHECK`, drop each `PRIMARY KEY`, widen the counter bound) run against `test/schema` with `SCHEMA_PATH` | **11 / 11 killed** |
| 7 | Fixtures are valid by default | independent contract oracle in `test/harness/fixtures.test.ts` over 2,000 generated events | 0 violations |
| 8 | Fixture coverage | `npm run test:coverage` | 99.4 % lines, 91.4 % branches, 100 % functions |
| 9 | Determinism | no `setTimeout`, no `sleep`, no `Date.now`, no `Math.random` in tests (grep); seeded PRNG (`mulberry32`); `FakeClock` | 0 occurrences |
| 10 | Tautologies | grep for `expect(true)`, `toBe(1)` on literals, empty bodies, assertions on mocks configured by the test | 0. The only spies (`EventSpy`, `MetricsSpy`, `UiSpy`) record what the SUT emits; none returns a canned answer |
| 11 | Every rejection test asserts "what did NOT happen" | `expectNoSideEffects` (database fingerprint of 6 tables, audit events, metrics, UI dispatches) in all P-violation and Q-fail tests | present in 11 of 13 rejection test functions (54 of 56 cases). The other two assert absence differently: `C1-P1b` checks that no bucket row and no extra audit event exist after the rejected 1,250-event batch; `C3-Q4b` checks only the error message content |

## 2. Findings and triage

| ID | Sev | Finding | Triage | Action / evidence |
|:-:|:-:|---|:-:|---|
| **TQ-1** | HIGH | `traceSql` replaced `db.prepare`; an adapter that prepares statements in its constructor (normal better-sqlite3 practice) would bypass it, making `expect(sql).toEqual([])` vacuous and `selects.length > 0` fail for the wrong reason (`C3-Q2`, `C3-I1`, `C3-P1a`, `C3-P3`). | **ACCEPT — FIXED** | Replaced by `verbose`-based tracing in `test/fixtures/db.ts`; 3 self-tests prove statements prepared *before* tracing are seen. |
| **TQ-2** | MED | Explanation tests fixed *which map* (`observed_values` vs `thresholds`) holds each Q4 key, but contracts.md only lists the keys. A correct implementation could fail for the wrong reason. | **ACCEPT — PARTLY FIXED** | `assertExplanation` gained `cited` (either map) for `resolution_minutes`; the remaining placements follow the key names (`observed_*`, `*_threshold`, `required_*`). **Defer to Partner A:** add a Q4 key → map table to `contracts.md` (proposed AMD-21, not applied). |
| **TQ-3** | MED | Tests assume the 250 ms window closes *when the next batch arrives* (pull model, as Op1 Q2 reads). A timer-driven close would also be legitimate and would break `flush()`. | **ACCEPT — DOCUMENTED** | Assumption recorded as TG-13 in `test-design.md`; confirm with Partner A. |
| **TQ-4** | MED | By count the red suite is acceptance-heavy: 28 pure-domain cases of 133 (21 %), against the "pure domain highest share" target. | **ACCEPT** | 19 domain-level cases (7 of them fast-check properties) were added in this phase (`D-*`). Story DoD must add unit tests per clause (TG-12). |
| **TQ-5** | LOW | `C1-P2b` and `C2-Q2d` had a single expectation. | **ACCEPT — FIXED** | Added `dropped_count`, audit event, active-alert count and explanation checks. |
| **TQ-6** | MED | `Promise.all` concurrency tests (`C2-I1a`, `C1-CON-b`) only interleave on `await` points; a fully synchronous implementation has no race to detect. | **ACCEPT — LIMIT DOCUMENTED** | They do catch the common bug (`await find(); await insert()`). A two-connection test against file-backed SQLite is deferred to Epic 2's integration story. |
| **TQ-7** | MED | `C1-EDGE-a` with `STORM_SECONDS=900` writes 118,800 bucket rows in one test and would hit the 30 s default timeout. | **ACCEPT — FIXED** | Per-test timeout `max(30 s, STORM_SECONDS × 1 s)`. |
| **TQ-8** | LOW | 6 uses of `any` (decimator `closed` list, `alertRows` row type). | **REJECT** | Test-only typing of untyped SQLite rows; replacing it with row interfaces adds code without catching defects. |
| **TQ-9** | LOW | Property tests contain no `expect`; the assertion is `fc.assert`. | **REJECT** | fast-check reports the shrunk counter-example; they fail red today through `NotImplementedError` (guard-verified). |
| **TQ-10** | LOW | `D-ENG-e` (same window → same verdict) is trivially true for any pure implementation. | **ACCEPT, KEEP** | Its value is catching hidden state (e.g. caching across calls); engine instances are created fresh per call. |
| **TQ-11** | MED | No test for "next call succeeds after a storage failure" (recovery) — NFR plan row N-09. | **DEFER** | Epic 1 integration story; needs the real adapter. |
| **TQ-12** | LOW | Error message templates are asserted only for `ERR_INVALID_ACADEMIC_SUBJECT` and the drift code. | **DEFER** | One table-driven template test per catalog code in Epic 1. |
| **TQ-13** | LOW | Rule R5 (no SELECT-then-UPDATE) is a regex fitness function and can miss other shapes. | **ACCEPT — HEURISTIC** | The behavioural proof is `C2-I1a` + `S-05b`; R5 is a tripwire only. |
| **TQ-14** | INFO | The suite was **never run against an implementation** (Stop-Point Rule forbids writing one). Test correctness is therefore established by: independent oracles for fixtures, DDL execution, mutation of the schema, and hand-checked arithmetic — not by seeing the tests go green. | **ACCEPT — LIMIT STATED** | First story's PR must show the relevant `RED → GREEN` transition; any case that cannot turn green is a test bug to fix before merging. |
| **TQ-A** | — | Independent re-review by Partner A. | **CLOSED - PASS** | Done by Partner A (Juand) on 2026-10-26. |

## 3. Quality score

Scored with the TEA rubric dimensions the author can evidence (not an official `bmad-testarch-test-review` run): determinism ✔, isolation ✔ (fresh DB + clock per test), explicit assertions ✔, traceability ✔ (111 ids), no hard waits ✔, right-reason red ✔ (guard), mutation-checked ✔ (schema only; domain mutation pending implementation).
**Verdict:** *acceptable; TQ-A closed and AMD-14 confirmed by both partners on 2026-10-26.*
