#!/usr/bin/env node
// Red-guard: the ATDD suite is red on purpose. This script FAILS (exit 1) if any ATDD case passes, is skipped/todo,
// or fails for a reason other than NotImplementedError (e.g. import error, typo, tautology that happens to throw).
// It is the CI control that keeps "red for the right reason" machine-enforced.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'red-guard-'));
const out = join(dir, 'atdd.json');
// node + the vitest entry point: portable (no `npx` / `npx.cmd` difference between Linux, macOS and Windows)
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'test/vitest.atdd.config.ts', '--reporter=json', `--outputFile=${out}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(readFileSync(out, 'utf8'));
} catch {
  console.error('red-guard: vitest produced no JSON report\n', run.stdout, run.stderr);
  process.exit(1);
}
const cases = report.testResults.flatMap((f) => f.assertionResults);
const red = cases.filter((c) => c.status === 'failed');
const notRed = cases.filter((c) => c.status !== 'failed');
const wrongReason = red.filter((c) => !c.failureMessages.join('\n').includes('NotImplementedError'));
const MIN = Number(process.env.ATDD_MIN_CASES ?? 100);

console.log(`${cases.length} ATDD cases - ${red.length - wrongReason.length} red for the right reason, ${wrongReason.length} red for another reason, ${notRed.length} not red (passed/skipped/todo)`);
for (const c of notRed) console.error(`  NOT RED  [${c.status}] ${c.fullName}`);
for (const c of wrongReason) console.error(`  WRONG REASON  ${c.fullName}\n      ${c.failureMessages[0].split('\n')[0]}`);
if (cases.length < MIN) console.error(`  suite shrank: ${cases.length} < ${MIN} cases`);
process.exit(notRed.length === 0 && wrongReason.length === 0 && cases.length >= MIN ? 0 : 1);
