/**
 * Fitness functions for the hexagonal rules of ports-and-adapters.md section 2 and AD-07.
 * Green while the stubs are pure; they turn RED the moment someone imports a driver, reads the wall clock or uses randomness in domain/.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN_IMPORT = /from\s+['"](fastify|express|better-sqlite3|sqlite3|ws|fs|node:fs|http|node:http|https|net|node:net|child_process|node:child_process|crypto|node:crypto)['"]/;
const FORBIDDEN_CALL = /\b(Date\.now\s*\(|new\s+Date\s*\(|performance\.now\s*\(|setTimeout\s*\(|setInterval\s*\(|Math\.random\s*\(|crypto\.randomUUID\s*\(|fetch\s*\()/;

export function scan(source: string, rules: { imports: boolean; calls: boolean }): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const out: string[] = [];
  if (rules.imports && FORBIDDEN_IMPORT.test(code)) out.push('forbidden import');
  if (rules.calls && FORBIDDEN_CALL.test(code)) out.push('wall-clock / randomness / network call');
  return out;
}

describe('the scanner itself (so a green result is not vacuous)', () => {
  it.each([
    ["import Database from 'better-sqlite3';", 'forbidden import'],
    ["import { createServer } from 'node:http';", 'forbidden import'],
    ['const t = Date.now();', 'wall-clock / randomness / network call'],
    ['const d = new Date();', 'wall-clock / randomness / network call'],
    ['const r = Math.random();', 'wall-clock / randomness / network call'],
    ['setTimeout(() => {}, 5);', 'wall-clock / randomness / network call'],
    ["await fetch('http://x')", 'wall-clock / randomness / network call'],
  ])('flags %s', (src, expected) => {
    expect(scan(src, { imports: true, calls: true })).toContain(expected);
  });
  it('ignores the same words inside comments', () => {
    expect(scan('// Date.now() is forbidden\n/* new Date() */ const a = 1;', { imports: true, calls: true })).toEqual([]);
  });
});

describe('[A-R1] AD-07 / R1: domain/ is pure', () => {
  const domain = files(join(ROOT, 'src/domain'));
  it('has files to scan', () => expect(domain.length).toBeGreaterThanOrEqual(4));
  it.each(domain.map((f) => [f.replace(ROOT + '/', ''), f]))('%s has no framework, driver, wall-clock, random or network use', (_n, f) => {
    expect(scan(readFileSync(f as string, 'utf8'), { imports: true, calls: true })).toEqual([]);
  });
  it('domain/ never imports from adapters/ or application/ (dependency direction)', () => {
    for (const f of domain) expect(readFileSync(f, 'utf8')).not.toMatch(/from\s+['"][./]+\/(adapters|application|api)\//);
  });
});

describe('[A-R2] R2: application and ports reach time and randomness only through ClockPort / IdGeneratorPort', () => {
  const targets = [...files(join(ROOT, 'src/application')), ...files(join(ROOT, 'src/ports'))];
  it.each(targets.map((f) => [f.replace(ROOT + '/', ''), f]))('%s', (_n, f) => {
    expect(scan(readFileSync(f as string, 'utf8'), { imports: true, calls: true })).toEqual([]);
  });
});

describe('[A-R3] R3: only adapters/db may import the SQLite driver', () => {
  it('no other src file imports better-sqlite3 at runtime', () => {
    const offenders = files(join(ROOT, 'src'))
      .filter((f) => !f.includes('/adapters/db/'))
      .filter((f) => /from\s+['"]better-sqlite3['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('[A-R4] R4: DTOs and port signatures are primitive-typed (no framework types)', () => {
  it('dto.ts has no imports at all', () => {
    expect(readFileSync(join(ROOT, 'planning/detailed-design/schemas/dto.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
  });
  it.each(files(join(ROOT, 'src/ports/in')).map((f) => [f.replace(ROOT + '/', ''), f]))('%s names no framework object', (_n, f) => {
    expect(readFileSync(f as string, 'utf8')).not.toMatch(/FastifyRequest|FastifyReply|WebSocket|express|Request\b|Response\b/);
  });
});

describe('[A-R5] R5: no SELECT-then-UPDATE in adapters (grep fitness function for the future implementation)', () => {
  it('adapters/db contains no read-modify-write pair on operational_alerts', () => {
    const src = files(join(ROOT, 'src/adapters/db')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toMatch(/SELECT[^;]*FROM\s+operational_alerts[^;]*;[\s\S]{0,200}(INSERT|UPDATE)\s+(INTO\s+)?operational_alerts/i);
  });
});
