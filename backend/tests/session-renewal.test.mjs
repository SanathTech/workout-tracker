// A session renews itself once it's a day old, so it lapses after 90 days of disuse
// rather than 90 days after login. Drives util/auth directly: the server under test runs
// with auth off, and the gate is what's being tested here.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
process.env.SESSION_SECRET = 'test-session-secret';
process.env.AUTH_PASSWORD_HASH = 'scrypt$00$00';
const auth = require('../src/util/auth');

let pass = 0, fail = 0;
const ok = (c, label, detail = '') => {
  if (c) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`); fail++; }
};

const DAY = 24 * 60 * 60 * 1000;
// Mint a token as if it had been issued `ageDays` ago, signed like issueToken signs.
function tokenAged(ageDays, secret = process.env.SESSION_SECRET) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + (90 - ageDays) * DAY })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const reqWith = (token) => ({ headers: token ? { cookie: `${auth.COOKIE_NAME}=${token}` } : {} });
function fakeRes() {
  const res = { headers: {}, code: 200 };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.code = c; return res; };
  res.json = () => res;
  return res;
}
// Run requireAuth; report whether it passed and what cookie it set.
function gate(token) {
  const res = fakeRes();
  let passed = false;
  auth.requireAuth(reqWith(token), res, () => { passed = true; });
  return { passed, code: res.code, cookie: res.headers['Set-Cookie'] };
}
const freshExp = (cookie) => {
  const value = cookie.split(';')[0].split('=').slice(1).join('=');
  return JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString('utf8')).exp;
};

console.log('\n─── a session over a day old is reissued ───');
{
  const r = gate(tokenAged(89));
  ok(r.passed, 'an 89-day-old session still passes');
  ok(r.cookie && r.cookie.includes('Max-Age=7776000'), 'and comes back with a fresh 90-day cookie', r.cookie);
  ok(r.cookie && freshExp(r.cookie) > Date.now() + 89 * DAY, 'whose expiry is ~90 days out');
  ok(auth.verifyToken(r.cookie.split(';')[0].split('=').slice(1).join('='), process.env.SESSION_SECRET),
    'and the reissued token verifies');
}

console.log('\n─── a young session is left alone ───');
{
  const r = gate(tokenAged(0.5));
  ok(r.passed, 'a 12-hour-old session passes');
  ok(r.cookie === undefined, 'without a Set-Cookie on the response', r.cookie);
}

console.log('\n─── renewal never creates a session ───');
{
  const expired = gate(tokenAged(91));
  ok(!expired.passed && expired.code === 401, 'an expired session is refused');
  ok(expired.cookie === undefined, 'and is not renewed');
  const forged = gate(tokenAged(30, 'wrong-secret'));
  ok(!forged.passed && forged.cookie === undefined, 'a token signed with another secret is refused, not renewed');
  const none = gate(null);
  ok(!none.passed && none.cookie === undefined, 'no cookie, no renewal');
}

console.log('\n─── /auth/me renews too (it sits outside requireAuth) ───');
{
  const router = require('../src/routes/auth');
  const layer = router.stack.find((l) => l.route?.path === '/me');
  const res = fakeRes();
  let body;
  res.json = (b) => { body = b; return res; };
  layer.route.stack[0].handle(reqWith(tokenAged(10)), res);
  ok(body?.authenticated === true, '/me reports signed in');
  ok(res.headers['Set-Cookie']?.includes('Max-Age=7776000'), 'and reissues the cookie', res.headers['Set-Cookie']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
