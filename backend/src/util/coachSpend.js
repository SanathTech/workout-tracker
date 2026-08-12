const db = require('../db');

// USD per million tokens. Sonnet 5's introductory pricing expires 2026-08-31 and
// reverts — encoded with the date rather than hardcoding today's number.
const PRICING = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-sonnet-5': { in: 2.0, out: 10.0, after: { date: '2026-08-31', in: 3.0, out: 15.0 } },
};

// One monthly pocket for everything the coach spends. The in-app chat was retired
// 2026-08-12 (Claude conversations replaced it), but monthlySpend still sums
// coach_messages so any historical chat spend in the current month stays counted.
const MONTHLY_BUDGET_USD = 5.0;

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

module.exports = { PRICING, MONTHLY_BUDGET_USD, costUsd, monthlySpend };
