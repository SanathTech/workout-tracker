const express = require('express');
const router = express.Router();
const { verifyPassword, issueToken, setSession, clearSession, isConfigured, isAuthed } = require('../util/auth');
const { serverError } = require('../util/errors');

// Per-instance throttle. On serverless this only slows a burst that happens to land on
// one warm lambda — the real cost to an attacker is scrypt, which is ~100ms per guess.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map(); // ip -> { count, resetAt }

function throttled(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

router.get('/me', (req, res) => {
  res.json({ authenticated: isAuthed(req), required: isConfigured() });
});

router.post('/login', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Login is not configured on the server.' });
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  if (throttled(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  try {
    const ok = await verifyPassword(password, process.env.AUTH_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    attempts.delete(ip);
    setSession(res, issueToken(process.env.SESSION_SECRET));
    res.json({ authenticated: true });
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ authenticated: false });
});

module.exports = router;
