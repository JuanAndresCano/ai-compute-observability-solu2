#!/usr/bin/env node
// Mechanical part of the Sprint Readiness Audit (workshop section 7, Step 4.2, checks 1, 3, 4 and the Annex B story fields).
// The judgement part (do artifacts contradict each other? is every decision recorded?) is in planning/readiness-gate-report.md.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const read = (p) => readFileSync(join(root, p), 'utf8');
const epicsMd = read('planning/epics.md');
const prd = read('planning/prd.md');
const code = ['test/atdd/observability_contracts.test.ts', 'test/schema/schema.contract.test.ts', 'test/architecture/purity.test.ts'].map(read).join('\n');
const problems = [];
const bad = (m) => problems.push(m);

// ---- parse epics and stories (same heading grammar as sprint_plan.py)
const epics = [];
let cur = null;
for (const line of epicsMd.split('\n')) {
  const e = line.match(/^##\s*Epic\s+(\d+)\s*:\s*(.*)$/);
  const s = line.match(/^###\s*Story\s+(\d+)\.(\d+)\s*:\s*(.*)$/);
  if (e) { cur = { n: +e[1], title: e[2], stories: [] }; epics.push(cur); }
  else if (s) { cur.stories.push({ id: `${s[1]}.${s[2]}`, epic: +s[1], title: s[3], body: '' }); }
  else if (cur?.stories.length) cur.stories.at(-1).body += line + '\n';
}
const stories = epics.flatMap((e) => e.stories);

// ---- structure rules (workshop 4.1)
if (epics.length < 3 || epics.length > 4) bad(`epics: ${epics.length} (need 3-4)`);
if (stories.length < 9 || stories.length > 16) bad(`stories: ${stories.length} (need 9-16)`);
for (const e of epics) if (e.stories.length < 3 || e.stories.length > 5) bad(`Epic ${e.n} has ${e.stories.length} stories (need 3-5)`);

// ---- Annex B: required fields in every story
const FIELDS = ['Traceability', 'Binding invariants', 'Depends on', 'Contract clauses', 'Files', 'Schema / DTO', 'ATDD', 'UI surface', 'Definition of Done'];
for (const s of stories) {
  for (const f of FIELDS) if (!new RegExp(`\\*\\*${f.replace(/[/]/g, '\\/')}:\\*\\*`).test(s.body)) bad(`Story ${s.id}: missing field "${f}"`);
  const scenarios = (s.body.match(/^\s*Scenario:/gm) ?? []).length;
  if (scenarios < 2) bad(`Story ${s.id}: needs a happy and a failure Gherkin scenario (found ${scenarios})`);
  if (!/Given[\s\S]*When[\s\S]*Then/.test(s.body)) bad(`Story ${s.id}: Gherkin lacks Given/When/Then`);
  s.field = (name) => (s.body.match(new RegExp(`\\*\\*${name}:\\*\\*([^\\n]*)`)) ?? [, ''])[1];
}

// ---- dependencies: only on earlier stories (check 4)
const order = new Map(stories.map((s, i) => [s.id, i]));
for (const s of stories) {
  const dep = s.field('Depends on');
  for (const d of dep.match(/\b\d+\.\d+\b/g) ?? []) {
    if (!order.has(d)) bad(`Story ${s.id}: depends on unknown story ${d}`);
    else if (order.get(d) >= order.get(s.id)) bad(`Story ${s.id}: FORWARD dependency on ${d}`);
  }
  if (!/none|\d+\.\d+/.test(dep)) bad(`Story ${s.id}: "Depends on" is neither "none" nor story ids`);
}

// ---- check 1: requirements -> stories and stories -> requirements
const frs = [...prd.matchAll(/^### (FR-\d+)/gm)].map((m) => m[1]);
const nfrs = [...prd.matchAll(/\*\*(NFR-\d+)\*\*/g)].map((m) => m[1]);
for (const r of new Set([...frs, ...nfrs])) if (!stories.some((s) => s.field('Traceability').includes(r) || s.body.includes(r))) bad(`${r}: no story traces to it (forward orphan)`);
for (const s of stories) if (!/(FR|NFR)-\d+/.test(s.field('Traceability'))) bad(`Story ${s.id}: traces to no FR/NFR (backward orphan)`);

// ---- check 3: every AD-n in >= 1 story binding, and every AD-n has a test (matrix)
for (let n = 1; n <= 8; n++) {
  const ad = `AD-0${n}`;
  if (!stories.some((s) => s.field('Binding invariants').includes(ad))) bad(`${ad}: appears in no story's Binding invariants`);
}

// ---- tests <-> stories: every tag in code in exactly one story; every story test exists in code
const TAG = /\[((?:C[1-4]-|W-|X-|D-|S-)[A-Za-z0-9-]+|A-R\d)\]/g;
const inCode = new Set([...code.matchAll(TAG)].map((m) => m[1]));
const ID = /\b(?:C[1-4]-[A-Z0-9a-z]+(?:-[A-Za-z0-9]+)*|W-\d|X-AD07|D-[A-Z]+-[a-e]|S-\d\d[a-h]|A-R\d)\b/g;
const owner = new Map();
for (const s of stories) {
  for (const t of s.field('ATDD').match(ID) ?? []) {
    if (!inCode.has(t)) bad(`Story ${s.id}: lists test ${t} that does not exist`);
    owner.set(t, [...(owner.get(t) ?? []), s.id]);
  }
}
for (const t of inCode) {
  const o = owner.get(t) ?? [];
  if (o.length === 0) bad(`test ${t} belongs to no story`);
  if (o.length > 1) bad(`test ${t} is claimed by several stories: ${o.join(', ')}`);
}

// ---- check 5 (mechanical part): names cited by a story must exist in dto.ts / the DDL (a renamed DTO is a broken link)
const dto = read('planning/detailed-design/schemas/dto.ts');
const ddl = read('planning/detailed-design/schemas/001_observability_schema.sql');
const dtoNames = new Set([...dto.matchAll(/export (?:interface|type) (\w+)/g)].map((m) => m[1]));
const ddlNames = new Set([...ddl.matchAll(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX)(?: IF NOT EXISTS)? |CONSTRAINT )(\w+)/g)].map((m) => m[1]));
const ddlColumns = new Set([...ddl.matchAll(/^\s{4}(\w+) (?:TEXT|INTEGER|REAL)/gm)].map((m) => m[1]));
for (const st of stories) {
  const line = st.field('Schema / DTO') + ' ' + st.field('Contract clauses');
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    for (const tok of m[1].match(/\b[A-Z][A-Za-z]*(?:DTO|Dto|dto|Type|type)\b/g) ?? []) if (!dtoNames.has(tok)) bad(`Story ${st.id}: DTO/type "${tok}" does not exist in dto.ts`);
    for (const tok of m[1].match(/\b(?:idx|chk)_\w+/g) ?? []) if (!ddlNames.has(tok)) bad(`Story ${st.id}: constraint/index "${tok}" does not exist in the DDL`);
  }
  for (const m of st.field('Schema / DTO').matchAll(/(?:table|tables|rows? of)\s+`(\w+)`|`((?:cluster_nodes|telemetry_buckets|ingested_batches|operational_alerts|node_heartbeats|node_forensics|rollup_hourly_metrics|audit_events)\w*)`/g)) {
    const t = m[1] ?? m[2];
    if (t && !ddlNames.has(t)) bad(`Story ${st.id}: table "${t}" does not exist in the DDL`);
  }
  for (const m of st.field('Schema / DTO').matchAll(/`(consecutive_clear_cycles|last_cycle_index|gpu_hours_unavailable|log_tail_json)`/g)) if (!ddlColumns.has(m[1])) bad(`Story ${st.id}: column "${m[1]}" does not exist in the DDL`);
}

// ---- matrix Story column has no TBD left once stories exist
if (/TBD-P4/.test(read('test/traceability-matrix.md'))) bad('traceability-matrix.md still has TBD-P4 in the Story column');

console.log(`${epics.length} epics, ${stories.length} stories; ${frs.length} FR + ${nfrs.length} NFR traced; ${inCode.size} tests each owned by exactly one story`);
for (const e of epics) console.log(`  Epic ${e.n}: ${e.stories.map((s) => s.id).join(', ')} - ${e.title}`);
problems.forEach((p) => console.error('  ✗ ' + p));
console.log(problems.length ? `READINESS CHECK: ${problems.length} problem(s)` : 'READINESS CHECK: no structural problem found');
process.exit(problems.length ? 1 : 0);
