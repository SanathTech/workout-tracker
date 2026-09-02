// The evening-ramp toggles: three self-reported booleans on the daily check-in that
// feed the bedtime-anchor decision loop. The load-bearing distinction everywhere here
// is NULL vs false — "didn't say" vs "broke the rule" — because the coach grades
// kept-of-answered, and a logging gap must never read as caffeine at 4pm.
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body: json };
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

await db.query(`DELETE FROM checkins WHERE date = $1`, [today]);

console.log('\nEvening ramp — saving');
{
  const { status } = await api('POST', '/api/coach/checkin', { no_caffeine_pm: true });
  ok(status === 200, 'a toggle alone is a check-in, not "nothing to save"', `got ${status}`);

  const { body: c1 } = await api('GET', '/api/coach/checkin');
  ok(c1?.no_caffeine_pm === true, 'the answer round-trips', `got ${c1?.no_caffeine_pm}`);
  ok(c1?.food_by_cutoff === null, 'unanswered stays NULL, not false', `got ${c1?.food_by_cutoff}`);

  await api('POST', '/api/coach/checkin', { screens_by_cutoff: false });
  const { body: c2 } = await api('GET', '/api/coach/checkin');
  ok(c2?.screens_by_cutoff === false, 'an honest "broke it" saves as false', `got ${c2?.screens_by_cutoff}`);
  ok(c2?.no_caffeine_pm === true, 'and does not disturb an earlier toggle', `got ${c2?.no_caffeine_pm}`);

  await api('POST', '/api/coach/checkin', { screens_by_cutoff: true });
  const { body: c3 } = await api('GET', '/api/coach/checkin');
  ok(c3?.screens_by_cutoff === true, 'an answer can be changed', `got ${c3?.screens_by_cutoff}`);

  const { status: bad } = await api('POST', '/api/coach/checkin', { no_caffeine_pm: 'false' });
  ok(bad === 400, 'the string "false" is rejected, not saved truthy', `got ${bad}`);
}

console.log('\nEvening ramp — protocol counts');
{
  // Two answered days for caffeine (1 kept), one for screens (kept via today), none
  // for food beyond today's NULL. Kept-of-answered, so caffeine reads 1/2 — the
  // false day counts against, the unanswered days count nowhere.
  await db.query(
    `INSERT INTO checkins (date, no_caffeine_pm)
          VALUES ($1::date - 1, false)
     ON CONFLICT (date) DO UPDATE SET no_caffeine_pm = EXCLUDED.no_caffeine_pm`,
    [today]
  );
  const { body: t } = await api('GET', '/api/coach/trends');
  const ramp = t?.protocol?.evening_ramp;
  ok(ramp != null, 'protocol carries the evening ramp block');
  const caf = ramp?.last_7_days?.no_caffeine_pm;
  ok(caf?.kept === 1 && caf?.answered === 2,
    'caffeine reads kept-of-answered (1/2)', `got ${JSON.stringify(caf)}`);
  const food = ramp?.last_7_days?.food_by_cutoff;
  ok(food?.answered === 0, 'a rule never answered has denominator 0, not 7',
    `got ${JSON.stringify(food)}`);
  ok((ramp?.last_14_days || []).every((r) => r.when),
    'ledger rows carry when-labels for the coach');
}

await db.query(`DELETE FROM checkins WHERE date >= $1::date - 1`, [today]);
await db.end();
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
