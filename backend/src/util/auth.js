const crypto = require('crypto');

const COOKIE_NAME = 'wt_session';
const SESSION_DAYS = 90;

// scrypt parameters. N=2^15 costs ~100ms per verify, which is the actual brute-force
// defence here — per-instance rate limiting is close to worthless on serverless, where
// every cold lambda gets its own memory.
const SCRYPT_N = 32768;
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTS = { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

// Stored as `scrypt$<saltHex>$<keyHex>` so the hash carries its own salt.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = await scrypt(password, salt);
  return crypto.timingSafeEqual(actual, expected);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function issueToken(secret) {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = b64url(JSON.stringify({ exp: expiresAt }));
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  // timingSafeEqual throws on a length mismatch, so check that first.
  if (provided.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(provided, expected)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

// Minimal cookie header parse — avoids a dependency for one header.
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function sessionCookie(value, maxAgeSeconds) {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure would make the cookie unusable over plain-http localhost.
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

const setSession = (res, token) => res.setHeader('Set-Cookie', sessionCookie(token, SESSION_DAYS * 24 * 60 * 60));
const clearSession = (res) => res.setHeader('Set-Cookie', sessionCookie('', 0));

// Auth is configured only when both secrets are present. When they aren't, the API
// stays open and every response says so — see requireAuth for why that's deliberate.
const isConfigured = () => Boolean(process.env.AUTH_PASSWORD_HASH && process.env.SESSION_SECRET);

function isAuthed(req) {
  if (!isConfigured()) return false;
  return verifyToken(readCookie(req, COOKIE_NAME), process.env.SESSION_SECRET);
}

let warned = false;

// Fails OPEN when unconfigured, and loudly. The alternative — refusing every request
// until the env vars land — would brick the live app the moment this deploys, before
// there is any way to log in. `GET /health` reports `auth: "off"` so the state is
// never a guess. Set AUTH_PASSWORD_HASH + SESSION_SECRET to turn it on.
function requireAuth(req, res, next) {
  if (!isConfigured()) {
    if (!warned) {
      console.warn('[auth] AUTH_PASSWORD_HASH / SESSION_SECRET not set — the API is UNPROTECTED.');
      warned = true;
    }
    return next();
  }
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  readCookie,
  setSession,
  clearSession,
  isConfigured,
  isAuthed,
  requireAuth,
};
