const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { serverError } = require('../util/errors');
const { todayInAppTimezone } = require('../util/dates');
const { buildDailyBundle, buildWeeklyBundle } = require('../util/coachContext');
const { DAILY_SCHEMA, WEEKLY_SCHEMA, buildRunPrompt, renderDaily, renderWeekly } = require('../util/coachPrompt');
const { MONTHLY_BUDGET_USD, costUsd, monthlySpend } = require('../util/coachSpend');
const { notify } = require('../util/ntfy');

const DAILY_MODEL = 'claude-haiku-4-5';
const WEEKLY_MODEL = 'claude-sonnet-5';

// Machine auth, not session auth: this is called by the nas-laptop timers, which have
// no browser session. Mounted in index.js BEFORE requireAuth; the secret is the gate.
// Constant-time compare so the secret can't be probed byte by byte.
function authorized(req) {
  const secret = process.env.COACH_RUN_SECRET;
  if (!secret) return false;
  const given = req.get('x-coach-secret') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/coach/run?kind=daily|weekly — generate a scheduled call.
//
// This endpoint IS the coach: the nas-laptop timers that used to run coach.py now just
// pull Garmin and curl here. Everything that thinks — prompts, context, budget, cost,
// the ntfy push — lives in this repo, once.
router.post('/', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const kind = req.query.kind === 'weekly' ? 'weekly' : req.query.kind === 'daily' ? 'daily' : null;
  if (!kind) return res.status(400).json({ error: 'kind must be daily or weekly' });

  if (!process.env.ANTHROPIC_API_KEY) {
    await notify('Coach not configured', 'ANTHROPIC_API_KEY is not set on the backend', {
      priority: 'high', tags: 'warning',
    });
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }

  try {
    // Idempotent per (kind, day): the 30 Aug weekly hit the function's maxDuration and
    // 502'd after the work was mostly done, and the only safe recovery is "run it
    // again". That has to be re-runnable without ever producing two Sunday reviews —
    // so a retry (manual or a future timer retry) becomes a no-op once a row exists.
    const existing = await db.query(
      'SELECT id FROM coach_advice WHERE kind = $1 AND for_date = $2 LIMIT 1',
      [kind, todayInAppTimezone()]
    );
    if (existing.rows.length) {
      return res.json({ skipped: true, reason: `${kind} advice for today already exists` });
    }

    const spent = await monthlySpend();
    if (spent >= MONTHLY_BUDGET_USD) {
      const msg = `$${spent.toFixed(2)} spent this month, cap is $${MONTHLY_BUDGET_USD.toFixed(2)}. Coach paused until next month.`;
      await notify('Coach budget reached', msg, { priority: 'high', tags: 'warning' });
      return res.status(429).json({ error: msg });
    }

    const model = kind === 'daily' ? DAILY_MODEL : WEEKLY_MODEL;
    const bundle = kind === 'daily' ? await buildDailyBundle() : await buildWeeklyBundle();
    const prompt = buildRunPrompt(kind, bundle);

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const params = {
      model,
      // max_tokens covers the thinking too, and thinking scales with the bundle: when
      // the per-effort stream fields landed (2026-08-30), the weekly's thinking grew
      // until it exhausted 8000 before the JSON was done — stop_reason max_tokens,
      // twice, ~100s each, indistinguishable from a timeout until the 502 body was
      // read. 16000 leaves the answer room even on a fat week; unused budget costs
      // nothing (billing is per token generated, not per token allowed).
      max_tokens: kind === 'daily' ? 2000 : 16000,
      messages: [{ role: 'user', content: prompt }],
      output_config: {
        format: { type: 'json_schema', schema: kind === 'daily' ? DAILY_SCHEMA : WEEKLY_SCHEMA },
      },
    };
    // Sonnet 5 thinks adaptively by default; medium effort is the cost/quality balance
    // for a once-a-week call.
    if (kind === 'weekly') params.output_config.effort = 'medium';

    const response = await client.messages.create(params);

    if (response.stop_reason === 'refusal') {
      await notify('Coach refused', `stop_details: ${JSON.stringify(response.stop_details)}`, {
        priority: 'high', tags: 'warning',
      });
      return res.status(502).json({ error: 'model refused' });
    }
    if (response.stop_reason === 'max_tokens') {
      await notify('Coach truncated', `${model} hit max_tokens — advice incomplete`, {
        priority: 'high', tags: 'warning',
      });
      return res.status(502).json({ error: 'response truncated' });
    }

    const advice = JSON.parse(
      response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    );
    const markdown = kind === 'daily' ? renderDaily(advice) : renderWeekly(advice);
    const cost = costUsd(model, response.usage);

    const { rows } = await db.query(
      `INSERT INTO coach_advice (kind, for_date, advice, markdown, model,
                                 input_tokens, output_tokens, cost_usd)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, for_date`,
      [kind, todayInAppTimezone(), JSON.stringify(advice), markdown, model,
       response.usage.input_tokens, response.usage.output_tokens, cost.toFixed(5)]
    );

    await notify(advice.headline.slice(0, 90), markdown, {
      priority: kind === 'daily' ? 'high' : 'default',
      tags: kind === 'daily' ? 'muscle' : 'calendar',
    });

    const total = spent + cost;
    if (total >= MONTHLY_BUDGET_USD * 0.8) {
      await notify('Coach budget 80%',
        `$${total.toFixed(2)} of $${MONTHLY_BUDGET_USD.toFixed(2)} used this month`,
        { priority: 'default', tags: 'warning' });
    }

    res.json({
      id: rows[0].id,
      kind,
      for_date: rows[0].for_date,
      call: advice.call || null,
      headline: advice.headline,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      cost_usd: Number(cost.toFixed(5)),
      spent_this_month: Number(total.toFixed(4)),
    });
  } catch (err) {
    // The timers' only observer is ntfy — a silent 500 would just be a missing
    // morning call, which is the failure shape we least want.
    await notify('Coach run FAILED', `${kind}: ${err.message}`.slice(0, 400), {
      priority: 'high', tags: 'warning',
    });
    serverError(res, err);
  }
});

module.exports = router;
