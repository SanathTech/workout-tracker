const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const ctx = require('../util/coachContext');
const { ATHLETE } = require('../util/coachPrompt');
const { MONTHLY_BUDGET_USD, monthlySpend } = require('../util/coachSpend');

const router = express.Router({ mergeParams: true });

// Remote MCP server for claude.ai — the "deep discussion" escape hatch.
//
// The in-app chat is Haiku on a compact bundle: right for "swim or lift tonight?",
// wrong for restructuring a training block. This server lets a claude.ai conversation
// (Max allowance, stronger models, real multi-turn reasoning) pull LIVE hub data
// itself. Every tool calls the same coachContext helpers the scheduled runs and the
// in-app chat use, so claude.ai sees exactly what the coach sees — by construction,
// not by discipline.
//
// Read-only on purpose. Nothing here writes: a claude.ai session can analyse and
// advise, but advice rows, check-ins and messages are only written by the surfaces
// that own them.
//
// Auth is a capability URL: /api/mcp/<token>, constant-time compared against
// MCP_TOKEN. claude.ai custom connectors support OAuth or unauthenticated servers;
// full OAuth for one user is disproportionate, and a bearer header can't be
// configured on the connector — the token-in-path is the pragmatic middle. The data
// behind it is read-only training data, accepted as hosted 2026-08-06.

function tokenOk(req) {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const given = req.params.token || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// One tool result shape: pretty JSON in a text block. Dates arrive as YYYY-MM-DD
// strings already (the pg DATE parser), so no serialisation surprises.
function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

const DAYS = (max, fallback) =>
  z.number().int().min(1).max(max).default(fallback).describe(`Window in days (max ${max})`);

function buildServer() {
  const server = new McpServer(
    { name: 'fitness-coach', version: '1.0.0' },
    {
      instructions:
        'Live training data for Sanath. Call get_briefing first: it returns who the ' +
        'athlete is, what the data can and cannot say (no HRV — hardware limit), and ' +
        'what the scheduled coach has already told him, so your advice stays ' +
        'consistent with the calls he has received.',
    }
  );

  server.registerTool('get_briefing', {
    description:
      'The coach briefing: athlete profile, data caveats, current program position, ' +
      'recent scheduled-coach calls, and feed freshness. Call this first in any ' +
      'coaching conversation.',
    inputSchema: {},
  }, async () => {
    const [next, advice, fresh, spent] = await Promise.all([
      ctx.nextSession(), ctx.pastAdvice('daily', 3), ctx.dataFreshness(), monthlySpend(),
    ]);
    const weekly = await ctx.pastAdvice('weekly', 1);
    return jsonResult({
      athlete: ATHLETE,
      next_session: next,
      recent_daily_calls: advice,
      last_weekly_review: weekly[0] || null,
      data_freshness: fresh,
      coach_api_spend_this_month: { usd: spent, cap: MONTHLY_BUDGET_USD },
    });
  });

  server.registerTool('get_readiness', {
    description:
      'Last measured night (Body Battery at wake, sleep score and stages, resting HR, ' +
      'stress) with the trailing baseline it must be read against, plus current ' +
      'CTL/ATL/TSB.',
    inputSchema: { baseline_days: DAYS(60, 10) },
  }, async ({ baseline_days }) => {
    const [ready, load] = await Promise.all([ctx.readiness(baseline_days), ctx.loadBlock(1)]);
    return jsonResult({ ...ready, training_load_today: load[0] || null });
  });

  server.registerTool('get_training_load', {
    description: 'Daily CTL (fitness), ATL (fatigue), TSB (form) and ramp rate over a window.',
    inputSchema: { days: DAYS(180, 42) },
  }, async ({ days }) => jsonResult(await ctx.loadBlock(days)));

  server.registerTool('get_activities', {
    description:
      'Endurance activities from Garmin via intervals.icu: swims, runs, rides, walks — ' +
      'duration, distance, HR, training load.',
    inputSchema: { days: DAYS(365, 28) },
  }, async ({ days }) => jsonResult(await ctx.recentActivities(days)));

  server.registerTool('get_strength_sessions', {
    description:
      'Gym sessions: working sets, tonnage, Garmin HR load for the same day, and ' +
      'post-session RPE where logged.',
    inputSchema: { days: DAYS(365, 42) },
  }, async ({ days }) => jsonResult(await ctx.strengthSessions(days)));

  server.registerTool('get_checkins', {
    description: 'Daily subjective check-ins: mood, energy, soreness (1–5) and notes.',
    inputSchema: { days: DAYS(120, 28) },
  }, async ({ days }) => jsonResult(await ctx.checkins(days)));

  server.registerTool('get_bodyweight', {
    description:
      'Bodyweight trend. Manual app entries win over the Garmin scale figure, which ' +
      'carries forward between real weigh-ins; each row is tagged with its source.',
    inputSchema: { days: DAYS(365, 90) },
  }, async ({ days }) => jsonResult(await ctx.bodyweight(days)));

  server.registerTool('get_coach_advice', {
    description:
      'What the scheduled coach has already said: daily readiness calls and weekly ' +
      'reviews, as structured advice.',
    inputSchema: {
      kind: z.enum(['daily', 'weekly']).default('daily'),
      limit: z.number().int().min(1).max(30).default(7),
    },
  }, async ({ kind, limit }) => jsonResult(await ctx.pastAdvice(kind, limit)));

  server.registerTool('get_adherence', {
    description:
      'Each past daily call paired with what he actually did that day — activities, ' +
      'gym session, RPE. The honesty check on the coaching.',
    inputSchema: { days: DAYS(120, 28) },
  }, async ({ days }) => jsonResult(await ctx.buildAdherence(days)));

  return server;
}

// Stateless Streamable HTTP: every POST builds a fresh server + transport pair.
// Vercel gives no instance affinity, so per-session state can't survive anyway —
// enableJsonResponse keeps replies plain JSON instead of an SSE stream a lambda
// would have to hold open.
router.post('/', async (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless servers have no stream to resume and no session to delete.
router.get('/', (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: stateless server' },
    id: null,
  });
});
router.delete('/', (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: stateless server' },
    id: null,
  });
});

module.exports = router;
