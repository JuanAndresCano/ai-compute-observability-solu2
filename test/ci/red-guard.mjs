#!/usr/bin/env node
// Red-guard: the ATDD suite is red on purpose. This script FAILS (exit 1) if any ATDD case passes, is skipped/todo,
// or fails for a reason other than NotImplementedError (e.g. import error, typo, tautology that happens to throw).
// It is the CI control that keeps "red for the right reason" machine-enforced.
import { startVitest } from 'vitest/node';

async function main() {
  const vitest = await startVitest('test', [], {
    run: true,
    config: 'test/vitest.atdd.config.ts',
  });

  const files = vitest.state.getFiles();
  function getTests(tasks) {
    return tasks.flatMap((t) => (t.type === 'test' ? [t] : t.tasks ? getTests(t.tasks) : []));
  }
  const allTests = getTests(files);

  const red = allTests.filter((t) => t.result?.state === 'fail');
  const notRed = allTests.filter((t) => t.result?.state !== 'fail');
  const wrongReason = red.filter((t) => {
    const msgs = (t.result?.errors ?? []).map((e) => String(e?.stack || e?.message || '')).join('\n');
    return !msgs.includes('NotImplementedError');
  });

  const MIN = Number(process.env.ATDD_MIN_CASES ?? 100);

  console.log(`${allTests.length} ATDD cases - ${red.length - wrongReason.length} red for the right reason, ${wrongReason.length} red for another reason, ${notRed.length} not red (passed/skipped/todo)`);
  for (const c of notRed) console.error(`  NOT RED  [${c.result?.state}] ${c.name}`);
  for (const c of wrongReason) console.error(`  WRONG REASON  ${c.name}\n      ${c.result?.errors?.[0]?.message}`);
  if (allTests.length < MIN) console.error(`  suite shrank: ${allTests.length} < ${MIN} cases`);

  await vitest.close();
  process.exit(notRed.length === 0 && wrongReason.length === 0 && allTests.length >= MIN ? 0 : 1);
}

main().catch((err) => {
  console.error('red-guard fatal error:', err);
  process.exit(1);
});
