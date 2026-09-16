// The check-in nudges (2026-09-16 rethink, PR 4): "unless I go out of my way to do it and
// remember it, it wont get done. It needs to insert itself at a natural point."
//
// The rules worth pinning: the morning push waits for a night to exist, neither push goes
// out once its half is answered, and the morning trigger — which fires every half hour
// while he wakes up — can only ever buzz once.
import pg from 'pg';

const BASE = process.env.TEST_API_URL || 'http://localhost:3997';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};
const SECRET = process.env.COACH_RUN_SECRET || '';
async function nudge(kind, secret = SECRET) {
  const res = await fetch(`${BASE}/api/coach/nudge?kind=${kind}`, {
    method: 'POST', headers: secret ? { 'x-coach-secret': secret } : {},
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, body };
}
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Australia/Melbourne',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

console.log('\n─── the gate ───');
{
  ok((await nudge('morning', '')).status === 401, 'no secret is unauthorized');
  ok((await nudge('morning', 'wrong-secret-entirely')).status === 401, 'a wrong secret is unauthorized');
  ok((await nudge('sideways')).status === 400, 'an unknown kind is a 400');
}

console.log('\n─── morning waits for a night to rate ───');
{
  const first = await nudge('morning');
  ok(first.body?.sent === false && first.body?.reason === 'no night synced yet', 'nothing to rate → no push', JSON.stringify(first.body));
  ok((await db.query('SELECT * FROM checkin_nudges')).rows.length === 0, 'and nothing is recorded, so it can fire again after the sync');

  await db.query(
    `INSERT INTO wellness_daily (date, sleep_secs, sleep_score, body_battery_at_wake, raw)
          VALUES ($1::date, 36300, 83, 79, '{}'::jsonb)
     ON CONFLICT (date) DO UPDATE SET sleep_secs = 36300, sleep_score = 83`,
    [today]
  );
  const sent = await nudge('morning');
  ok(sent.body?.sent === true, 'once the night lands, it goes', JSON.stringify(sent.body));
  const again = await nudge('morning');
  ok(again.body?.sent === false && again.body?.reason === 'already sent today', 'and the next trigger half an hour later does not', JSON.stringify(again.body));
  const row = (await db.query('SELECT kind, delivered FROM checkin_nudges WHERE for_date = $1', [today])).rows;
  ok(row.length === 1 && row[0].kind === 'morning', 'exactly one row for the morning', JSON.stringify(row));
}

console.log('\n─── an answered half is never nudged ───');
{
  await db.query(
    `INSERT INTO checkins (date, no_caffeine_pm, food_by_cutoff, screens_by_cutoff)
          VALUES ($1::date, true, true, false)
     ON CONFLICT (date) DO UPDATE SET no_caffeine_pm = true, food_by_cutoff = true, screens_by_cutoff = false`,
    [today]
  );
  const evening = await nudge('evening');
  ok(evening.body?.sent === false && evening.body?.reason === 'already answered', 'a finished ramp gets no wind-down push', JSON.stringify(evening.body));

  await db.query('UPDATE checkins SET screens_by_cutoff = NULL WHERE date = $1', [today]);
  const partial = await nudge('evening');
  ok(partial.body?.sent === true, 'a half-answered ramp still does', JSON.stringify(partial.body));

  await db.query('UPDATE checkins SET mood = 4, energy = 4, soreness = 2 WHERE date = $1', [today]);
  await db.query('DELETE FROM checkin_nudges WHERE kind = $1', ['morning']);
  const morning = await nudge('morning');
  ok(morning.body?.sent === false && morning.body?.reason === 'already answered', 'and answered ratings get no morning push', JSON.stringify(morning.body));
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
