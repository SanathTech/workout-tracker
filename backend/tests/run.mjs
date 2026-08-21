// Boots the API against DATABASE_URL and runs every suite in tests/*.test.mjs.
//
//   npm test                    # expects DATABASE_URL to point at a THROWAWAY database
//
// Each suite gets a truncated database, because they all seed their own programs and a
// leftover active program would collide with the one-active-program index. Exercises are
// preserved — seeding 34 rows per suite is wasted work and nothing mutates them.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_PORT || 3997);
const BASE = `http://localhost:${PORT}`;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Point it at a throwaway database — this truncates tables.');
  process.exit(1);
}

// Guard against the obvious catastrophe: running the suite against Neon would wipe the
// real training log. Local/CI hosts only, and never a *-pooler production host.
const dbHost = new URL(process.env.DATABASE_URL).hostname;
const LOCAL = ['localhost', '127.0.0.1', 'postgres', 'db'];
if (!LOCAL.includes(dbHost)) {
  console.error(`Refusing to run: DATABASE_URL points at "${dbHost}".`);
  console.error('These tests TRUNCATE tables. Use a local or CI database.');
  process.exit(1);
}

// The hub tables are reset alongside the app's own: they are written by the nas-laptop
// timers in production, but a suite that seeds a wellness night or a run needs the same
// clean slate everything else gets.
const RESET = `TRUNCATE workouts, workout_exercises, workout_sets, routines,
  routine_exercises, routine_exercise_subs, programs, bodyweight_logs,
  activities, training_load, wellness_daily, checkins, session_feel, coach_advice,
  app_events
  RESTART IDENTITY CASCADE`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await wait(250);
  }
  return false;
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, file)], {
      // Suites must not inherit auth config — they drive the API unauthenticated.
      env: { ...process.env, TEST_API_URL: BASE, AUTH_PASSWORD_HASH: '', SESSION_SECRET: '' },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

const server = spawn(process.execPath, [path.join(here, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    LOCAL_DEV: '1',
    // Auth off: these suites test the domain, not the gate. Auth has its own coverage.
    AUTH_PASSWORD_HASH: '',
    SESSION_SECRET: '',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

let failed = false;
try {
  if (!(await waitForServer())) {
    console.error(`\n❌ API did not come up on ${BASE}`);
    process.exitCode = 1;
  } else {
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const files = (await readdir(here)).filter((f) => f.endsWith('.test.mjs')).sort();
    const results = [];

    for (const file of files) {
      await db.query(RESET);
      console.log(`\n${'─'.repeat(60)}\n▶ ${file}\n${'─'.repeat(60)}`);
      const ok = await runSuite(file);
      results.push({ file, ok });
      if (!ok) failed = true;
    }

    await db.end();
    console.log(`\n${'═'.repeat(60)}`);
    for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'}  ${r.file}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(failed ? '\n❌ Suite failed.\n' : `\n✅ All ${results.length} suites passed.\n`);
    process.exitCode = failed ? 1 : 0;
  }
} finally {
  server.kill();
}
