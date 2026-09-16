const crypto = require('crypto');

// Machine auth for the endpoints the nas-laptop timers call: they have no browser
// session, so the shared secret is the gate. Routes using this are mounted BEFORE
// requireAuth in index.js. Constant-time compare so the secret can't be probed byte
// by byte, and an unset secret fails closed.
function machineAuthorized(req) {
  const secret = process.env.COACH_RUN_SECRET;
  if (!secret) return false;
  const given = req.get('x-coach-secret') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { machineAuthorized };
