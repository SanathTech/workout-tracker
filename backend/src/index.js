require('dotenv').config();
const express = require('express');
const cors = require('cors');

const exercisesRouter = require('./routes/exercises');
const programsRouter = require('./routes/programs');
const workoutsRouter = require('./routes/workouts');
const progressRouter = require('./routes/progress');
const coachRouter = require('./routes/coach');
const coachRunRouter = require('./routes/coachRun');
const mcpRouter = require('./routes/mcp');
const authRouter = require('./routes/auth');
const eventsRouter = require('./routes/events');
const { requireAuth, isConfigured } = require('./util/auth');

const app = express();

const ALLOWED_HOSTS = ['workout.sanathtech.com'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps, same-origin)
    if (!origin) return callback(null, true);
    let hostname;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return callback(new Error('Not allowed by CORS'));
    }
    if (
      ALLOWED_HOSTS.includes(hostname) ||
      hostname.endsWith('.vercel.app') ||
      hostname === 'localhost'
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// Every /api response depends on the session cookie, but nothing said so: Vercel applies
// `Cache-Control: public, max-age=0, must-revalidate` by default and Express adds an ETag,
// while the only `Vary` was on Origin. That advertises per-session data as shared-cacheable
// and keyed on the wrong thing — /auth/me signed-out and signed-in are the same cache entry
// to any intermediary. The origin does revalidate correctly, so this wasn't proven to cause
// the sign-in loop it was found chasing; it's wrong on its own terms regardless.
app.set('etag', false);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, Cookie');
  next();
});

// Health check. `auth` is here so the protection state is verifiable from outside
// rather than inferred — it reads "off" until both auth env vars are set.
app.get('/health', (req, res) => res.json({ status: 'ok', auth: isConfigured() ? 'on' : 'off' }));

// Login/logout are the only session-unauthenticated API routes — plus the coach run
// endpoint, which is machine-to-machine: the nas-laptop timers have no browser
// session, so it authenticates with its own shared secret instead.
app.use('/api/auth', authRouter);
app.use('/api/coach/run', coachRunRouter);
// The claude.ai MCP connector — capability-URL auth (token in path), not session auth.
app.use('/api/mcp/:token', mcpRouter);

// Everything below requires a valid session cookie once auth is configured.
app.use('/api', requireAuth);

// Behind requireAuth like everything else — it writes to his database, and an open
// ingest is an open write endpoint however boring the payload looks.
app.use('/api/events', eventsRouter);

app.use('/api/exercises', exercisesRouter);
app.use('/api/programs', programsRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/progress', progressRouter);
app.use('/api/coach', coachRouter);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  // A rejected origin is a client error, not a server fault — don't report it as a 500.
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Local dev: start the server normally
// Vercel: exports `app` as a serverless function
if (process.env.NODE_ENV !== 'production' || process.env.LOCAL_DEV) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Workout Tracker API running on http://localhost:${PORT}`);
  });
}

module.exports = app;
