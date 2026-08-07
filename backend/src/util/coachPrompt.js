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
average stress, and TSB (form = fitness minus fatigue) from intervals.icu.`;

const RUN_STYLE = `Write like a coach who knows him, not a dashboard. Be specific and short.
Reference his actual numbers rather than describing them in the abstract. Do not pad,
do not restate the data back at him, and do not hedge every sentence. If the data does
not support a confident call, say which number you would want and give your best read
anyway. If any feed in data_freshness is more than 48 hours stale, say so plainly in
data_caveats and lower your confidence rather than pretending the numbers are current.`;

const CHAT_STYLE = `You are answering a question in a chat box on his phone, mid-day,
probably between other things. Answer the question that was asked, in two or three
sentences, in his actual numbers. No preamble, no restating the question, no bulleted
summary of data he can already see on the same screen.

You share a thread with the scheduled morning and weekly calls, which appear in the
context. Stay consistent with them: if you are contradicting a call you made this
morning, say so and say why. If he pushes back on your reasoning and he is right,
change your answer — do not defend a bad call.

If the honest answer is "the data doesn't say", say that in one sentence and tell him
what would.`;

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

Weigh Body Battery at wake against its recent average, sleep score and stage split,
resting-HR direction, stress, and TSB. Then reconcile that with what is actually
scheduled next and what he has done in the last week. Where your own past calls appear
in adherence_14d, take account of whether he followed them.

One call, defensible, in his numbers.`;

const WEEKLY_ASK = `Review the week and plan the next one.

Cover: what he actually did versus what you told him, whether load is building,
holding or decaying and whether that is right this far out from a 70.3, and whether
the gym program is progressing or stalling on set volume and load. Then lay out next
week day by day, fitting the strength program's sequence around the endurance work.

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

function chatSystemPrompt(context) {
  return `${ATHLETE}

${CHAT_STYLE}

<data>
${JSON.stringify(context, null, 1)}
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
  CHAT_STYLE,
  DAILY_SCHEMA,
  WEEKLY_SCHEMA,
  buildRunPrompt,
  chatSystemPrompt,
  renderDaily,
  renderWeekly,
};
