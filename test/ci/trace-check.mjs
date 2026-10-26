#!/usr/bin/env node
// Machine check of test/traceability-matrix.md against the code. Exit 1 on any broken link.
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url))); // fileURLToPath: .pathname breaks on Windows
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const matrix = read('test/traceability-matrix.md');

const TAG = /\[((?:C[1-4]-|W-|X-|D-|S-)[A-Za-z0-9-]+|A-R\d)\]/g;
const sources = ['test/atdd/observability_contracts.test.ts', 'test/schema/schema.contract.test.ts', 'test/architecture/purity.test.ts'];
const testSrc = sources.map(read).join('\n');
const inCode = new Set([...testSrc.matchAll(TAG)].map((m) => m[1]));

const ID = /\b(?:C[1-4]-[A-Z0-9a-z]+(?:-[A-Za-z0-9]+)*|W-\d|X-AD07|D-[A-Z]+-[a-f]|S-\d\d[a-h]|A-R\d)\b/g;
const rows = matrix.split('\n').filter((l) => /^\|\s*(FR|NFR)/.test(l));
const inMatrix = new Set();
const problems = [];

for (const row of rows) {
  const cells = row.split('|').map((c) => c.trim());
  const [, req, , ad, , tests, , status] = cells;
  const ids = [...(tests ?? '').matchAll(ID)].map((m) => m[0]);
  ids.forEach((i) => inMatrix.add(i));
  if (!ids.length && !/GAP/.test(status ?? '')) problems.push(`row without tests and not marked GAP: ${req} | ${ad}`);
  for (const i of ids) if (!inCode.has(i)) problems.push(`Test ID in matrix but not in code: ${i}`);
}
for (const t of inCode) if (!inMatrix.has(t)) problems.push(`orphan test (in code, not in matrix): ${t}`);

for (let n = 1; n <= 8; n++) {
  const ad = `AD-0${n}`;
  const covered = rows.some((r) => r.includes(ad) && [...r.matchAll(ID)].length > 0);
  if (!covered) problems.push(`${ad} has no test in the matrix`);
}
for (let n = 1; n <= 5; n++) {
  const fr = `FR-0${n}`;
  if (!rows.some((r) => r.split('|')[1]?.includes(fr))) problems.push(`${fr} has no row`);
}
const binding = [...read('planning/detailed-design/contracts.md').matchAll(/`(test_[a-z0-9_]+)`/g)].map((m) => m[1]);
for (const name of new Set(binding)) if (!testSrc.includes(name)) problems.push(`Invariant Binding Table test missing in suite: ${name}`);
if (new Set(binding).size !== 8) problems.push(`expected 8 bound test names in contracts.md, found ${new Set(binding).size}`);

const gaps = rows.filter((r) => /\|\s*GAP\s*\|?$/.test(r.trim())).length;
console.log(`${rows.length} matrix rows, ${inMatrix.size} test ids traced, ${inCode.size} tags in code, ${gaps} documented GAP rows, ${new Set(binding).size} bound invariant tests`);
problems.forEach((p) => console.error('  ✗ ' + p));
process.exit(problems.length ? 1 : 0);
