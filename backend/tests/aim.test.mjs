// The aim is the engine's verdict alone (2026-11-03): coach notes no longer override it,
// so the session's one Aim line can only say what the progression engine says.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveAim } = require('../src/util/aim');

let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};

console.log('\n─── increase: new weight at the bottom of the range ───');
{
  const { aim } = resolveAim(
    { action: 'increase', suggested_weight_kg: 52.5, suggested_reps_low: 6, suggested_reps_high: 8, reason: 'top of range' },
    [null, 2, 1]
  );
  ok(aim.weight_kg === 52.5 && aim.reps === 6, '52.5 × 6', JSON.stringify(aim));
  ok(aim.rir === 2, "RIR is the routine's first set target, skipping blanks", aim.rir);
  ok(aim.why === 'top of range' && aim.action === 'increase', 'carries the reason and verdict');
  ok(!('source' in aim) && !('note_id' in aim), 'no coach fields left on the aim');
}

console.log('\n─── hold: same weight, the next rep ───');
{
  const { aim } = resolveAim(
    { action: 'hold', suggested_weight_kg: 40, suggested_reps_next: 7, suggested_reps_low: 6, suggested_reps_high: 8, reason: 'r' },
    null
  );
  ok(aim.reps === 7 && aim.reps_high === 8, 'reps_next, with the ceiling for the row ghosts', JSON.stringify(aim));
  ok(aim.rir === null, 'no RIR target: null, not undefined');
}

console.log('\n─── no verdict, no aim ───');
for (const action of ['no_history', 'no_target']) {
  ok(resolveAim({ action }, [2]).aim === null, `${action} → null`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
