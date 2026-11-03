const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const ctx = require('../util/coachContext');

const router = express.Router({ mergeParams: true });

// Remote MCP server for claude.ai: a Claude conversation pulls LIVE training data
// itself. The only coaching surface left after the 2026-11-03 strip-back removed the
// scheduled coach, its notes and the check-ins.
//
// Read-only on purpose. Nothing here writes.
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

// Who he is and what the data can say. Kept short and factual: anything about plans or
// targets goes stale, and Claude can read the current state from the tools.
const ATHLETE = `Sanath trains for an Ironman 70.3 (swim/bike/run) alongside a gym program of
three full-body routines done in rotation, on whatever days his schedule allows — there
are no fixed gym days, and the app suggests the routine done longest ago. He logs
strength in his own app and endurance via a Garmin vívosmart 5.

His watch does NOT measure HRV, so Garmin's Training Readiness is unavailable. Never ask
for HRV or hedge around its absence. Readiness = Body Battery at wake, sleep score and
stages, resting-HR trend, average stress, and TSB (form) from intervals.icu.

Garmin's gym recordings are approximate (he sometimes forgets to start or stop them); the
app's logged sets are the ground truth for what happened in the gym. He stopped logging
daily check-ins and post-session RPE in October 2026, and the app no longer asks for them,
so their absence says nothing.`;

function buildServer() {
  const server = new McpServer(
    { name: 'fitness-coach', version: '1.0.0' },
    {
      instructions:
        'Live training data for Sanath. Call get_briefing first: it returns who the ' +
        'athlete is, what the data can and cannot say (no HRV — hardware limit), the ' +
        'next routine in his rotation, and how fresh each data feed is.',
    }
  );

  server.registerTool('get_briefing', {
    description:
      'Athlete profile, data caveats, the next routine in his gym rotation, and feed ' +
      'freshness. Call this first in any training conversation.',
    inputSchema: {},
  }, async () => {
    const [next, fresh] = await Promise.all([ctx.nextSession(), ctx.dataFreshness()]);
    return jsonResult({ athlete: ATHLETE, next_session: next, data_freshness: fresh });
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
      'post-session RPE where logged (only before Nov 2026).',
    inputSchema: { days: DAYS(365, 42) },
  }, async ({ days }) => jsonResult(await ctx.strengthSessions(days)));

  server.registerTool('get_bodyweight', {
    description:
      'Bodyweight trend. Manual app entries win over the Garmin scale figure, which ' +
      'carries forward between real weigh-ins; each row is tagged with its source.',
    inputSchema: { days: DAYS(365, 90) },
  }, async ({ days }) => jsonResult(await ctx.bodyweight(days)));

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
