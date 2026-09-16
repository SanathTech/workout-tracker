import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getActiveProgram, getInProgressWorkout, getWorkout, getSuggestions, getReadiness, getTrends,
  startWorkout, skipUpcomingWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import { useCheckin, Ratings, Ramp, NoteField, SaveError, ratingsComplete, rampComplete } from '../components/Checkin';
import WeekStrip, { useWeek } from '../components/WeekPlan';
import TodayTiles from '../components/TodayTiles';
import ProgressGlance from '../components/ProgressGlance';
import { formatDay, localDate } from '../util/format';

// Today, day-first (2026-09-15 rethink, from his walkthrough of the old screen). Top to
// bottom, in the same order all day so it is learned rather than read:
//
//   week strip · Now (only when something is due) · today's card · last night · progress
//   · tomorrow, one line
//
// Two things move with the day and nothing else does. The Now slot holds the check-in
// half that can actually be answered — the ratings until evening, the ramp from 21:00 —
// and is simply absent otherwise, because a block that can't be finished yet left "a
// dissatisfying feeling of not completing a section". Today's card goes from plan to
// result as the day's session lands. Tomorrow comes off the weekday map, never "next in
// the rotation": that label with no day attached is how Thursday's Day A read as
// Wednesday's session.

// ---------- helpers ----------

function isBlank(v) { return v == null || v === ''; }

// Rounded to whole seconds first, so 359.6 reads 6:00 and never 5:60.
function duration(raw) {
  const s = Math.round(raw);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const pace = duration;

// Once a check-in half has been seen unanswered in this visit it stays on screen after
// it's completed, as its own confirmation — the slot doesn't vanish under the thumb that
// answered it. Next visit, a complete half isn't shown at all.
//
// It takes the ANSWERS, not a loading flag: "no data yet" is not "unanswered", and
// treating it as such opened an already-answered check-in whenever the fetch lagged
// (caught in QA, 2026-09-16). `null` is a real answer — it means no row — so the test is
// specifically for a value having arrived.
//
// `date` resets it: the ramp's date rolls at 04:00 and the catch-up's at midnight, and a
// flag left over from yesterday would open today's slot while today's answers were still
// in flight.
function useShownWhileIncomplete(date, checkin, complete) {
  const seen = useRef({ date, value: false });
  if (seen.current.date !== date) seen.current = { date, value: false };
  if (checkin !== undefined && !complete) seen.current.value = true;
  return seen.current.value;
}

// ---------- today's card: gym ----------

function InProgressBlock({ workout }) {
  const { data } = useQuery({ queryKey: ['workout', workout.id], queryFn: () => getWorkout(workout.id), staleTime: 0 });
  let logged = 0;
  let planned = 0;
  for (const ex of data?.exercises || []) {
    for (const s of ex.sets || []) {
      planned += 1;
      if (!isBlank(s.reps)) logged += 1;
    }
  }
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{workout.routine_name || 'Workout'}</h2>
        <p className="text-sm text-neutral-400 mt-0.5 tabular-nums">
          {planned > 0 && <>{logged}/{planned} sets · </>}
          started {new Date(workout.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
      <Link to={`/session/${workout.id}`} className="btn-primary w-full justify-center py-3">Continue</Link>
    </div>
  );
}

// The lifts with their aim, as the session will show them — "what am I lifting today"
// answered before the bag is packed. Same source as the session's aim line.
function LiftPreview({ routine }) {
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['suggestions', routine.id],
    queryFn: () => getSuggestions(routine.id),
    staleTime: 60_000,
  });
  const byId = new Map((suggestions || []).map((s) => [s.exercise_id, s]));
  return (
    <ul className="divide-y divide-neutral-800">
      {routine.exercises.map((e) => {
        const aim = byId.get(e.exercise_id)?.aim;
        const up = aim?.source === 'engine' && aim.action === 'increase';
        const bodyweight = aim?.weight_kg != null && Number(aim.weight_kg) === 0;
        const load = aim == null ? null
          : bodyweight ? (aim.reps != null ? `${aim.reps} reps` : 'bodyweight')
          : aim.weight_kg != null ? `${Math.round(aim.weight_kg * 100) / 100} kg${aim.reps != null ? ` × ${aim.reps}` : ''}`
          : aim.reps != null ? `${aim.reps} reps` : null;
        return (
          <li key={e.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="text-neutral-200 truncate">{e.exercise_name}</span>
            {isLoading ? (
              <Skeleton className="h-3.5 w-14" />
            ) : (
              <span className="shrink-0 tabular-nums text-neutral-300">
                {up && <span className="text-emerald-400 mr-1" aria-label="increase">↑</span>}
                {load ?? <span className="text-neutral-600">—</span>}
                {aim?.source === 'coach' && <span className="text-amber-400 text-xs ml-1.5">coach</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GymCard({ program }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // One reading of the calendar day per render: two calls can straddle midnight and then
  // the query and the slot logic disagree about which day they mean.
  const today = localDate();
  const { checkin, save } = useCheckin(today);
  const askRatings = useShownWhileIncomplete(today, checkin, ratingsComplete(checkin));

  const start = useMutation({
    mutationFn: (routineId) => startWorkout({ routine_id: routineId }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      navigate(`/session/${w.id}`);
    },
  });
  const skip = useMutation({
    mutationFn: (routineId) => skipUpcomingWorkout({ routine_id: routineId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['program', program.id] });
      qc.invalidateQueries({ queryKey: ['week'] });
      qc.invalidateQueries({ queryKey: ['workouts-history'] });
    },
  });

  const progress = program.progress;
  if (!progress?.next_routine) {
    return (
      <div>
        <p className="text-lg font-semibold">
          {progress?.completed_workouts}{progress?.total_workouts ? `/${progress.total_workouts}` : ''} workouts done
          {progress?.skipped_workouts ? ` · ${progress.skipped_workouts} skipped` : ''}
        </p>
        <p className="text-sm text-neutral-400 mt-1">Program complete. Start a new one when you're ready.</p>
        <Link to="/program/new" className="btn-primary mt-4 inline-flex">New program</Link>
      </div>
    );
  }

  const next = progress.next_routine;
  const after = program.routines[progress.position_in_cycle % program.routines.length];
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold tracking-tight">
        {next.name}
        <span className="text-sm font-normal text-neutral-400 ml-2">{next.exercises.length} lifts</span>
      </h2>
      <LiftPreview routine={next} />

      {/* On a gym day the morning questions sit on the way to Start, so starting the
          session is what gets them answered — including a Saturday that slides to the
          evening. Already answered this morning: not shown. */}
      {askRatings && (
        <div className="border-t border-neutral-800 pt-2">
          <p className="section-label">Before you start</p>
          <Ratings checkin={checkin} save={save} />
          <SaveError save={save} />
        </div>
      )}

      <div className="space-y-1 pt-1">
        <button
          onClick={() => start.mutate(next.id)}
          disabled={start.isPending || skip.isPending}
          className="btn-primary w-full justify-center py-3"
        >
          {start.isPending ? 'Starting…' : `Start ${next.name.split(' — ')[0]}`}
        </button>
        <button
          onClick={() => {
            if (confirm(`Skip ${next.name}? Nothing gets logged${after ? `, and ${after.name} moves up next` : ''}.`)) skip.mutate(next.id);
          }}
          disabled={start.isPending || skip.isPending}
          className="btn-ghost w-full justify-center"
        >
          {skip.isPending ? 'Skipping…' : 'Skip this workout'}
        </button>
      </div>
      {skip.isError && <p className="text-xs text-red-400">Could not skip this workout. Try again.</p>}
    </div>
  );
}

function GymDoneCard({ entry }) {
  return (
    <Link to={`/workouts/${entry.workout_id}`} className="flex items-center justify-between gap-3 py-1 min-h-11">
      <span className="min-w-0">
        <span className="block text-xl font-semibold tracking-tight truncate">{entry.label}</span>
        {entry.meta && <span className="block text-sm text-neutral-400 tabular-nums">Done · {entry.meta}</span>}
      </span>
      <span className="text-neutral-400 shrink-0" aria-hidden="true">›</span>
    </Link>
  );
}

function NoProgramBlock() {
  return (
    <div>
      <p className="font-semibold">No active program</p>
      <p className="text-sm text-neutral-400 mt-1">
        Set up a program (e.g. 12-week split with Upper/Lower routines), then start it to track workouts.
      </p>
      <Link to="/program/new" className="btn-primary mt-4 inline-flex">Set up a program</Link>
    </div>
  );
}

// ---------- today's card: run / swim / walk ----------

// The figures that matter per discipline. Swims leave out HR on purpose: wrist HR in the
// pool read 103 and 141 on two near-identical kilometres.
function activityFacts(a) {
  const s = a.stats || {};
  const facts = [];
  if (a.kind === 'swim') {
    if (s.distance_m) facts.push(<><b>{Math.round(s.distance_m)}</b> m</>);
    if (s.moving_s) facts.push(<b>{duration(s.moving_s)}</b>);
    if (s.swim_pace_s) facts.push(<><b>{pace(s.swim_pace_s)}</b> /100 m</>);
    return facts;
  }
  if (s.distance_m) facts.push(<><b>{(s.distance_m / 1000).toFixed(2)}</b> km</>);
  if (s.moving_s) facts.push(<b>{duration(s.moving_s)}</b>);
  if (s.run_pace_s) facts.push(<><b>{pace(s.run_pace_s)}</b> /km running</>);
  else if (s.distance_m && s.moving_s) facts.push(<><b>{pace(s.moving_s / (s.distance_m / 1000))}</b> /km</>);
  if (s.average_hr) facts.push(<>HR <b>{s.average_hr}</b></>);
  return facts;
}

function FactLine({ facts, className = '' }) {
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-neutral-400 tabular-nums [&_b]:text-neutral-200 [&_b]:font-semibold ${className}`}>
      {facts.map((f, i) => <span key={i}>{f}</span>)}
    </p>
  );
}

function ActivityResult({ entry, title, ceiling }) {
  const s = entry.stats || {};
  const body = (
    <>
      <h2 className="text-xl font-semibold tracking-tight flex items-baseline justify-between gap-3">
        {title}
        {s.activity_id && <span className="text-neutral-400 text-base font-normal" aria-hidden="true">›</span>}
      </h2>
      <FactLine facts={activityFacts(entry)} />
      {entry.kind === 'run' && (s.over_ceiling_min != null || s.strides) && (
        <p className="text-xs text-neutral-400 tabular-nums">
          {s.over_ceiling_min != null && (
            <span className={s.over_ceiling_min > 0 ? 'text-amber-400' : 'text-emerald-400'}>
              {s.over_ceiling_min > 0 ? `${s.over_ceiling_min} min over ${ceiling}` : `nothing over ${ceiling}`}
            </span>
          )}
          {s.strides && <span> · {s.strides} strides{s.over_ceiling_min > 0 ? ' (~2–3 min of it)' : ''}</span>}
        </p>
      )}
    </>
  );
  // Linked only when there is an activity to open — a card without one stays a card.
  return s.activity_id ? (
    <Link to={`/activity/${s.activity_id}`} className="block space-y-1 rounded-lg -mx-2 px-2 py-1 hover:bg-neutral-900 transition-colors">{body}</Link>
  ) : (
    <div className="space-y-1">{body}</div>
  );
}

function PlanCard({ day, previous }) {
  const kind = day.planned.kind;
  const last = kind === 'run' || kind === 'swim' ? previous?.[kind] : null;
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{day.planned.title}</h2>
      {last && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">
            Last {kind} · {formatDay(last.date, { weekday: 'short', day: 'numeric', month: 'short' })}
          </p>
          <FactLine facts={activityFacts({ kind, stats: last.stats })} />
        </>
      )}
    </div>
  );
}

function TodayCard({ week, weekLoading, active, activeLoading, inProgress, inProgressLoading }) {
  if (weekLoading || activeLoading || inProgressLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (inProgress) return <InProgressBlock workout={inProgress} />;

  const today = week?.days?.find((d) => d.state === 'today');
  // Without the week there is no slot to read; the gym card keeps Start reachable.
  if (!today || today.planned.kind === 'gym') {
    const done = today?.actual.find((a) => a.kind === 'gym' && !a.skipped);
    if (done) return <GymDoneCard entry={done} />;
    return active ? <GymCard program={active} /> : <NoProgramBlock />;
  }

  const results = today.actual.filter((a) => a.kind !== 'gym' && !a.skipped);
  if (!results.length) return <PlanCard day={today} previous={week.previous} />;
  return (
    <div className="space-y-4">
      {results.map((a) => (
        <ActivityResult
          key={a.stats?.activity_id || a.label}
          entry={a}
          title={a.kind === today.planned.kind ? today.planned.title : a.label}
          ceiling={153}
        />
      ))}
    </div>
  );
}

// ---------- Now: the check-in half that can be answered ----------

// A skipped catch-up stays skipped for the day, and only for this device — it is a "not
// now", not an answer, so nothing is written to the check-in.
const skipKey = (date) => `ramp-catchup-skipped:${date}`;

function NowSlot({ gymDay, readiness }) {
  const [params] = useSearchParams();
  // A tap on the push opens the question it asked about, whatever the clock says. The
  // param is left in the URL on purpose: stripping it raced the double-mount and the
  // decision was gone by the second one (QA, 2026-09-16 — ?checkin=evening rendered the
  // morning question). Reopening the slot on a refresh costs nothing, since it is only
  // ever shown while the answer is missing.
  const askedParam = params.get('checkin');
  const asked = askedParam === 'morning' || askedParam === 'evening' ? askedParam : null;

  const hour = new Date().getHours();
  const evening = asked === 'evening' || (asked !== 'morning' && (hour >= 21 || hour < 4));
  // One reading of the calendar day per render, for the same reason as the gym card.
  const today = localDate();
  const yesterday = localDate(-1);
  // After midnight the ramp is still about the evening that just ended.
  const rampDate = hour < 4 ? yesterday : today;
  const morning = useCheckin(today);
  const night = useCheckin(rampDate);
  const showRatings = useShownWhileIncomplete(today, morning.checkin, ratingsComplete(morning.checkin));
  const showRamp = useShownWhileIncomplete(rampDate, night.checkin, rampComplete(night.checkin));

  // Last night's wind-down, asked once the next morning if it never got answered. Missed
  // is missed: it is offered, it can be waved away, and it does not pile up.
  const catchUp = useCheckin(yesterday);
  const readSkip = (date) => {
    try { return localStorage.getItem(skipKey(date)) === '1'; } catch { return false; }
  };
  const [skipped, setSkipped] = useState(() => readSkip(yesterday));
  // Re-read when the date rolls: an app left open overnight would otherwise carry
  // yesterday's "not now" into a new day's question.
  useEffect(() => { setSkipped(readSkip(yesterday)); }, [yesterday]);
  const showCatchUp = useShownWhileIncomplete(yesterday, catchUp.checkin, rampComplete(catchUp.checkin));

  const slept = readiness?.is_last_night ? readiness.last_night : null;

  if (evening && showRamp) {
    const answered = rampComplete(night.checkin);
    return (
      <div className="rounded-xl bg-neutral-900 p-3 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold text-neutral-200">{answered ? 'Wind-down · saved' : 'Wind-down'}</p>
          <p className="text-xs text-neutral-400">bed 22:30</p>
        </div>
        <Ramp checkin={night.checkin} save={night.save} />
        <SaveError save={night.save} />
      </div>
    );
  }
  if (!evening && !gymDay && showRatings) {
    const answered = ratingsComplete(morning.checkin);
    return (
      <div className="rounded-xl bg-neutral-900 p-3 space-y-1">
        <p className="font-semibold text-neutral-200">{answered ? 'Morning check-in · saved' : 'How did you wake up?'}</p>
        {slept && (
          <p className="text-xs text-neutral-400 tabular-nums">
            {[
              slept.sleep_secs != null ? `Slept ${Math.floor(slept.sleep_secs / 3600)} h ${Math.floor((slept.sleep_secs % 3600) / 60)} m` : null,
              slept.sleep_score != null ? `score ${slept.sleep_score}` : null,
              slept.body_battery_at_wake != null ? `battery ${slept.body_battery_at_wake}` : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
        <Ratings checkin={morning.checkin} save={morning.save} />
        <NoteField checkin={morning.checkin} save={morning.save} />
        <SaveError save={morning.save} />
      </div>
    );
  }
  if (!evening && hour < 12 && showCatchUp && !skipped) {
    return (
      <div className="rounded-xl bg-neutral-900 p-3 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold text-neutral-200">Last night’s wind-down</p>
          <button
            type="button"
            onClick={() => {
              setSkipped(true);
              try { localStorage.setItem(skipKey(yesterday), '1'); } catch { /* private window */ }
            }}
            className="text-xs text-neutral-400 hover:text-neutral-200 min-h-11 md:min-h-0 px-1"
          >
            Skip
          </button>
        </div>
        <Ramp checkin={catchUp.checkin} save={catchUp.save} />
        <SaveError save={catchUp.save} />
      </div>
    );
  }
  return null;
}

// ---------- tomorrow ----------

function Tomorrow({ day }) {
  if (!day) return null;
  const gym = day.planned.kind === 'gym';
  const [name, focus] = gym ? day.planned.title.split(' — ') : [day.planned.title, null];
  return (
    <Link to="/train" className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-3 min-h-11 text-sm">
      <span className="text-neutral-400">Tomorrow</span>
      <span className="min-w-0 truncate">
        <span className="font-medium text-neutral-200">{name}</span>
        {focus && <span className="text-neutral-400"> · {focus}</span>}
        <span className="text-neutral-400 ml-2" aria-hidden="true">›</span>
      </span>
    </Link>
  );
}

// ---------- page ----------

// The manifest's "Start next workout" shortcut lands here with ?start=next. An unfinished
// session wins over starting a new one, and the param is stripped either way so a refresh
// (or the back button) can't start a second workout.
function useStartNextShortcut({ active, inProgress, resolved }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const firedRef = useRef(false);

  useEffect(() => {
    if (params.get('start') !== 'next' || !resolved || firedRef.current) return;
    firedRef.current = true;
    setParams({}, { replace: true });

    if (inProgress) { navigate(`/session/${inProgress.id}`); return; }
    const routineId = active?.progress?.next_routine?.id;
    if (!routineId) return;
    startWorkout({ routine_id: routineId })
      .then((w) => {
        qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
        navigate(`/session/${w.id}`);
      })
      .catch(() => { /* stay on Today; the Start button is right there */ });
  }, [params, resolved, inProgress, active, navigate, qc, setParams]);
}

export default function Dashboard() {
  const { data: active, isLoading: activeLoading } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: inProgress, isLoading: inProgressLoading } = useQuery({
    queryKey: ['in-progress-workout'],
    queryFn: getInProgressWorkout,
    staleTime: 0,
  });
  const { data: week, isLoading: weekLoading, isError: weekError } = useWeek();
  const { data: readiness, isLoading: rLoading } = useQuery({ queryKey: ['readiness'], queryFn: getReadiness, staleTime: 5 * 60_000 });
  const { data: trends, isLoading: tLoading } = useQuery({
    queryKey: ['trends', 90],
    queryFn: () => getTrends({ days: 90 }),
    staleTime: 5 * 60_000,
  });

  useStartNextShortcut({ active, inProgress, resolved: !activeLoading && !inProgressLoading });

  const today = week?.days?.find((d) => d.state === 'today');
  const gymDay = !!today && today.planned.kind === 'gym' && !inProgress
    && !today.actual.some((a) => a.kind === 'gym' && !a.skipped) && !!active?.progress?.next_routine;

  return (
    <Page dense>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-neutral-400">
          {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
      </div>

      <WeekStrip week={week} isLoading={weekLoading} isError={weekError} />

      {/* Not before the week is known: on a gym day the ratings belong on the Start card,
          and guessing "not a gym day" while loading flashed them here first. */}
      {!weekLoading && <NowSlot gymDay={gymDay} readiness={readiness} />}

      <TodayCard
        week={week} weekLoading={weekLoading}
        active={active} activeLoading={activeLoading}
        inProgress={inProgress} inProgressLoading={inProgressLoading}
      />

      <Section label="Last night" className="pt-3">
        <TodayTiles readiness={readiness} trends={trends} isLoading={rLoading || tLoading} />
      </Section>

      <Section label="Progress" className="pt-3">
        <ProgressGlance trends={trends} week={week} />
      </Section>

      <Tomorrow day={week?.tomorrow} />
    </Page>
  );
}
