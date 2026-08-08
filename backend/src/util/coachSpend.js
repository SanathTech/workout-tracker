const db = require('../db');

// USD per million tokens. Sonnet 5's introductory pricing expires 2026-08-31 and
// reverts — encoded with the date rather than hardcoding today's number.
const PRICING = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-5': { in: 2.0, out: 10.0, after: { date: '2026-08-31', in: 3.0, out: 15.0 } },
};

// One monthly pocket for everything the coach spends — scheduled runs and chat.
// Summing only one of the two tables would enforce half a budget.
const MONTHLY_BUDGET_USD = 5.0;

// Chat stops before the pocket is empty. The scheduled calls are the product — the
// thing that reliably arrives at 06:30 — and a chatty fortnight must not be able to
// silence them. The reserve covers a full month of scheduled runs (~$0.20 daily +
// ~$0.25 weekly) with margin.
const CHAT_BUDGET_USD = 3.5;

function costUsd(model, usage) {
  let { in: rateIn, out: rateOut, after } = PRICING[model];
  if (after && new Date() > new Date(`${after.date}T23:59:59Z`)) {
    rateIn = after.in;
    rateOut = after.out;
  }
  const cached = usage.cache_read_input_tokens || 0;
  const written = usage.cache_creation_input_tokens || 0;
  return (
    (usage.input_tokens * rateIn +
      cached * rateIn * 0.1 +
      written * rateIn * 1.25 +
      usage.output_tokens * rateOut) /
    1_000_000
  );
}

async function monthlySpend() {
  const { rows } = await db.query(
    `SELECT COALESCE(
              (SELECT SUM(cost_usd) FROM coach_advice
                WHERE created_at >= date_trunc('month', NOW())), 0)
          + COALESCE(
              (SELECT SUM(cost_usd) FROM coach_messages
                WHERE created_at >= date_trunc('month', NOW())), 0) AS usd`
  );
  return Number(rows[0].usd);
}

module.exports = { PRICING, MONTHLY_BUDGET_USD, CHAT_BUDGET_USD, costUsd, monthlySpend };
