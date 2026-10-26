# Module 11 — AI Infrastructure Observability Console (Solu-2)

Solutioning package for the Unit 4 / Solu-2 workshop: contracts, ports & adapters, schemas, a **red-phase** test suite, and (Phase 4) epics + readiness gate.
**Solutioning Stop-Point Rule:** no production logic. `src/` holds interface stubs that throw `NotImplementedError`, test doubles and nothing else.

| Where | What |
|---|---|
| `planning/detailed-design/contracts.md` | P / Q / I contracts for `ingestMetricBatch`, `evaluateAlertRule`, `buildUtilizationReport`; typed error catalog (8 codes); invariant binding table |
| `planning/detailed-design/ports-and-adapters.md`, `schemas/` | hexagonal map, DDL, DTOs, events, OpenAPI |
| `reviews/` | Phase 0 audit, Phase 1-2 gate (+ Partner B re-review), `review-test-quality.md` |
| `test/test-design.md`, `nfr-evidence.md`, `traceability-matrix.md`, `tea-skill-matrix.md` | Phase 3 documents |
| `test/atdd/observability_contracts.test.ts` | 133 red cases (82 test functions) |
| `test/schema/`, `test/architecture/`, `test/harness/` | green suites: physical constraints, hexagon rules, fixture self-tests |
| `ai-log/decision-log-solu2.md` | AI governance log (DEC-09 … DEC-15) |

```bash
nvm use            # Node 20+
npm ci
npm test                  # 100 green: fixture self-tests, schema constraints, architecture rules
npm run test:atdd         # 133 RED on purpose
npm run test:atdd:guard   # fails if any ATDD case passes, is skipped, or is red for another reason than NotImplementedError
npm run trace:check       # traceability matrix vs code
npm run typecheck
npm run ci                # all of the above
STORM_SECONDS=900 npm run test:atdd:guard   # the 15-minute storm (NFR-01), nightly
```
