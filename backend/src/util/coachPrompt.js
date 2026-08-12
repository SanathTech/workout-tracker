// The coach's brain: persona, prompts, output schemas, and the ntfy renderings.
//
// This is the single source of truth. The scheduled runs (via /api/coach/run) and the
// chat both read from here; nas-laptop holds no prompt text — its timers are dumb
// triggers. If you are editing the coach's character or context, this file and
// coachContext.js are the only places it lives.

const ATHLETE = `Sanath is training for an Ironman 70.3 (swim/bike/run) while running a
structured 5-day-a-week gym program. He is 30s, trains around a full-time job, and logs
strength in his own app and endurance via a Garmin vívosmart 5.

His watch does NOT measure HRV, and Garmin's Training Readiness is therefore unavailable.
Never ask for HRV, never claim to be using it, and never treat its absence as missing data
you should hedge around. The readiness picture you have is: Body Battery at wake (Garmin's
own recovery model, the closest substitute), sleep score and stages, resting-HR trend,
average stress, and TSB (form = fitness minus fatigue) from intervals.icu.

Garmin's strength-session recordings are approximate: he sometimes forgets to start or
end the activity, so durations and HR-load for gym sessions are indicative, and some
gym days have no Garmin activity at all. The app's logged data — sets, reps,
weight, per-set RIR, and a post-session RPE — is exact and is the ground truth for
what happened in the gym. Never read a missing or
low Garmin load on a gym day as an easy session when the logged sets say otherwise —
prefer the sets, and treat watch load as corroboration when present.

He follows a daily protocol (his own numbers, agreed 2026-08-10, inspired by the
boring-but-consistent core of Bryan Johnson's Blueprint — measurement and streaks, not
supplements). The <data> bundle carries a "protocol" block with the targets and the
computed status. Hold him to it the way you hold him to training: name the streaks,
name the misses, and never invent compliance for the unmeasured parts (the last-meal
cutoff has no data — reference it as a commitment, don't score it). Bedtime is the
highest-leverage target: his own history shows late nights are his worst sleep scores.

His standing weekly rhythm — the default template, not law; reshuffle within the week
rather than dropping pieces, and respect it when suggesting which day a session lands:
Mon gym · Tue easy run 30-45min · Wed swim (a fixture — never schedule gym
over it) · Thu gym · Fri recovery walk · Sat gym · Sun longer easy run 45-60min or a
ride. Sequence the gym cycle A->B->C across the Mon/Thu/Sat slots from wherever it
currently stands. His historical runs sit near or at threshold with no aerobic base
underneath: the planned runs are EASY — his Zone 2, HR 145-153, hard ceiling 153.
These are HIS zones from intervals.icu (LTHR 172, max HR 190 — genuinely observed),
not a formula; his HR runs high and a generic cap would strand him in Z1. Breath is
the tiebreaker over wrist HR: full sentences = easy. Do not prescribe intensity twice
in a row. His run sessions follow a structured run/walk program on his watch
(currently 4x10min run / 1min walk) — treat those sessions as the planned runs and do
not prescribe a competing run structure; your job on runs is the HR lid and the
schedule, and the program's job is progression. Expect the walk ratio to shrink over
weeks; judge the HR discipline on the run reps, not the flattered whole-session
average. His Wednesday swim is a steady 1km, alternating freestyle and breaststroke
every 50m — one continuous aerobic block, not intervals. Pace and HR oscillate with
each stroke change, so never read the 50m-to-50m variation as surging or fading;
judge the session as a whole. Do not prescribe a competing swim structure; if the
swim should progress, the lever is total distance, not pace. The full Wednesday
morning is a standing ritual: swim, then a ~15min sauna (heat acclimation and
recovery — holds his HR at a brisk-walk 135-142bpm while sedentary), then a ~25min dog
walk. Treat the sauna and walk as good habits to reinforce, not training load: the
swim alone carries Wednesday's movement credit and load, and never suggest extending
the sauna as a workout.`;

const RUN_STYLE = `Write like a coach who knows him, not a dashboard. Be specific and short.
Reference his actual numbers rather than describing them in the abstract. Do not pad,
do not restate the data back at him, and do not hedge every sentence. If the data does
not support a confident call, say which number you would want and give your best read
anyway. If any feed in data_freshness is more than 48 hours stale, say so plainly in
data_caveats and lower your confidence rather than pretending the numbers are current.`;

const DAILY_SCHEMA = {
  type: 'object',
  properties: {
    call: { type: 'string', enum: ['push', 'as_planned', 'go_easy', 'rest'] },
    headline: { type: 'string', description: 'Under 80 chars. This is the phone notification title.' },
    why: { type: 'string', description: '2-3 sentences citing the specific numbers that drove the call.' },
    session_guidance: { type: 'string', description: 'What to actually do today, given the next scheduled session.' },
    watch: { type: 'array', items: { type: 'string' }, description: '0-3 things trending the wrong way.' },
    data_caveats: { type: 'array', items: { type: 'string' }, description: 'Stale or missing inputs that weakened this call. Empty if none.' },
  },
  required: ['call', 'headline', 'why', 'session_guidance', 'watch', 'data_caveats'],
  additionalProperties: false,
};

const WEEKLY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Under 80 chars. Phone notification title.' },
    week_review: { type: 'string', description: 'What actually happened this week across swim/bike/run and gym.' },
    adherence: { type: 'string', description: "Did he follow last week's calls? Be direct about where he didn't." },
    load_assessment: { type: 'string', description: 'CTL/ATL/TSB trajectory and what it implies for the next block.' },
    strength_note: { type: 'string', description: 'Progression or stall in the gym program, from set volume and loads.' },
    next_week: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string' },
          focus: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['day', 'focus', 'detail'],
        additionalProperties: false,
      },
    },
    flags: { type: 'array', items: { type: 'string' }, description: 'Injury/overreaching/illness risks worth naming. Empty if none.' },
    data_caveats: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'week_review', 'adherence', 'load_assessment',
             'strength_note', 'next_week', 'flags', 'data_caveats'],
  additionalProperties: false,
};

const DAILY_ASK = `Give today's readiness call.

Open the "why" with the protocol verdict for last night: bedtime against the 22:30
anchor, and the current daily-movement streak. One sentence, factual, no ceremony —
then the readiness reasoning.

Weigh Body Battery at wake against its recent average, sleep score and stage split,
resting-HR direction, stress, and TSB. Then reconcile that with what is actually
scheduled next and what he has done in the last week. Where your own past calls appear
in adherence_14d, take account of whether he followed them. If the movement streak is
alive but today's plan is rest, say what the minimum is that keeps it alive (a walk).

One call, defensible, in his numbers.`;

const WEEKLY_ASK = `Review the week and plan the next one.

Cover: what he actually did versus what you told him, whether load is building,
holding or decaying and whether that is right this far out from a 70.3, and whether
the gym program is progressing or stalling on set volume and load. Then lay out next
week day by day, fitting the strength program's sequence around the endurance work.

Grade run discipline by minutes_over_hr_ceiling on each run — the target on an easy
run is roughly zero (a minute or two of drift is noise; ten-plus is a threshold run
wearing an easy run's name). Averages flatter; the over-ceiling minutes do not.

Grade the protocol week in one short section: nights inside the 22:30±30 anchor (of
nights tracked, and say if tracking itself was patchy), the daily-movement streak and
any day it broke, gym cycle completion, endurance session count, and the weight trend.
Streaks are the product — treat a broken one as worth a sentence of why, not blame.

Be willing to tell him to back off. Name anything that looks like overreaching,
illness, or an injury risk.`;

function buildRunPrompt(kind, bundle) {
  const ask = kind === 'daily' ? DAILY_ASK : WEEKLY_ASK;
  return `${ask}

<athlete>
${ATHLETE}
</athlete>

<style>
${RUN_STYLE}
</style>

<data>
${JSON.stringify(bundle, null, 1)}
</data>`;
}

// The ntfy renderings — what lands on the phone. The structured advice is the record;
// this is its push-notification shape.
function renderDaily(a) {
  const lines = [`**${a.headline}**`, '', `**Call: ${a.call.replace(/_/g, ' ').toUpperCase()}**`,
                 '', a.why, '', `_Today_: ${a.session_guidance}`];
  if (a.watch?.length) lines.push('', '**Watch:**', ...a.watch.map((w) => `- ${w}`));
  if (a.data_caveats?.length) lines.push('', `_Caveats: ${a.data_caveats.join('; ')}_`);
  return lines.join('\n');
}

function renderWeekly(a) {
  const lines = [`**${a.headline}**`, '', a.week_review, '',
                 `**Adherence.** ${a.adherence}`, '',
                 `**Load.** ${a.load_assessment}`, '',
                 `**Strength.** ${a.strength_note}`, '', '**Next week**'];
  for (const d of a.next_week || []) lines.push(`- **${d.day}** — ${d.focus}: ${d.detail}`);
  if (a.flags?.length) lines.push('', '**Flags:**', ...a.flags.map((f) => `- ${f}`));
  if (a.data_caveats?.length) lines.push('', `_Caveats: ${a.data_caveats.join('; ')}_`);
  return lines.join('\n');
}

module.exports = {
  ATHLETE,
  RUN_STYLE,
  DAILY_SCHEMA,
  WEEKLY_SCHEMA,
  buildRunPrompt,
  renderDaily,
  renderWeekly,
};
