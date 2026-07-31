require('dotenv').config();
const express = require('express');
const cors = require('cors');

const exercisesRouter = require('./routes/exercises');
const programsRouter = require('./routes/programs');
const workoutsRouter = require('./routes/workouts');
const progressRouter = require('./routes/progress');
const authRouter = require('./routes/auth');
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

// Health check. `auth` is here so the protection state is verifiable from outside
// rather than inferred — it reads "off" until both auth env vars are set.
app.get('/health', (req, res) => res.json({ status: 'ok', auth: isConfigured() ? 'on' : 'off' }));

// Login/logout are the only unauthenticated API routes.
app.use('/api/auth', authRouter);

// Everything below requires a valid session cookie once auth is configured.
app.use('/api', requireAuth);

app.use('/api/exercises', exercisesRouter);
app.use('/api/programs', programsRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/progress', progressRouter);

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
