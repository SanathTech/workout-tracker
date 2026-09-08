import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getActiveProgram, getInProgressWorkout, getWorkout, getSuggestions, getCheckin,
  startWorkout, skipUpcomingWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page } from '../components/ui';
import { ChevronIcon } from '../components/icons';
import CheckinCard, { ratingsComplete, rampComplete, RAMP_FIELDS } from '../components/CheckinCard';
import WeekStrip, { useWeek } from '../components/WeekPlan';
import TodayTiles from '../components/TodayTiles';
import CoachCard from '../components/CoachCard';
import { track } from '../util/telemetry';

// Today (2026-09-08 redesign, PR 3). Two things happen on this screen and only two:
// a session gets started, a check-in gets done. Both blocks are always here, one open
// and one folded to a single line, and the open one follows the clock — the session
// until 19:00, the check-in after — because that's when each of them actually happens.
// Either line can be tapped to swap. Everything else on the page is a glance (the
// week, four numbers, the coach's line) and a tap away from its full reading.
const EVENING_HOUR = 19;

// ---------- session block ----------

function isBlank(v) { return v == null || v === ''; }

function InProgressBlock({ workout }) {
  // The session page owns this key; reading it here means "Continue" already has the
  // workout cached when it lands.
  const { data } = useQuery({ queryKey: ['workout', workout.id], queryFn: () => getWorkout(workout.id), staleTime: 0 });
  const { logged, planned } = countSets(data);
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{workout.routine_name || 'Workout'}</h2>
        <p className="text-sm text-neutral-400 mt-1 tabular-nums">
          {planned > 0 && <>{logged}/{planned} sets · </>}
          started {new Date(workout.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
      <Link to={`/session/${workout.id}`} className="btn-primary w-full justify-center py-3">Continue</Link>
    </div>
  );
}

function countSets(workout) {
  let logged = 0;
  let planned = 0;
  for (const ex of workout?.exercises || []) {
    for (const s of ex.sets || []) {
      planned += 1;
      if (!isBlank(s.reps)) logged += 1;
    }
  }
  return { logged, planned };
}

// The main lifts with their aim, as the session will show them — so "what am I lifting
// today" is answered before the bag is packed. Same source as the session's aim line:
// the server has already decided whose call it is.
function LiftPreview({ routine }) {
  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['suggestions', routine.id],
    queryFn: () => getSuggestions(routine.id),
    staleTime: 60_000,
  });
  const byId = new Map((suggestions || []).map((s) => [s.exercise_id, s]));
  const mains = routine.exercises.filter((e) => e.is_main);
  const shown = (mains.length ? mains : routine.exercises).slice(0, 4);
  return (
    <ul className="divide-y divide-neutral-800">
      {shown.map((e) => {
        const aim = byId.get(e.exercise_id)?.aim;
        const up = aim?.source === 'engine' && aim.action === 'increase';
        const bodyweight = aim?.weight_kg != null && Number(aim.weight_kg) === 0;
        const load = aim == null ? null
          : bodyweight ? (aim.reps != null ? `${aim.reps} reps` : 'bodyweight')
          : aim.weight_kg != null ? `${Math.round(aim.weight_kg * 100) / 100} kg`
          : aim.reps != null ? `${aim.reps} reps` : null;
        return (
          <li key={e.exercise_id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
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
      {routine.exercises.length > shown.length && (
        <li className="py-1.5 text-xs text-neutral-400">+ {routine.exercises.length - shown.length} more</li>
      )}
    </ul>
  );
}

function NextWorkoutBlock({ program }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
        <Link to="/program" className="btn-primary mt-4 inline-flex">New program</Link>
      </div>
    );
  }

  const next = progress.next_routine;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{next.name}</h2>
        <p className="text-sm text-neutral-400 mt-1">{next.exercises.length} exercises</p>
      </div>

      <LiftPreview routine={next} />

      <div className="space-y-2 pt-1">
        <button
          onClick={() => start.mutate(next.id)}
          disabled={start.isPending || skip.isPending}
          className="btn-primary w-full justify-center py-3"
        >
          {start.isPending ? 'Starting…' : `Start ${next.name.split(' — ')[0]}`}
        </button>
        <button
          onClick={() => { if (confirm(confirmSkip(program, progress))) skip.mutate(next.id); }}
          disabled={start.isPending || skip.isPending}
          className="btn-ghost w-full justify-center"
        >
          {skip.isPending ? 'Skipping…' : 'Skip this workout'}
        </button>
      </div>
      {skip.isError && (
        <p className="text-xs text-red-400">Could not skip this workout. Try again.</p>
      )}
    </div>
  );
}

function confirmSkip(program, progress) {
  const after = program.routines[progress.position_in_cycle % program.routines.length];
  return `Skip ${progress.next_routine.name}? Nothing gets logged${after ? `, and ${after.name} moves up next` : ''}.`;
}

function NoProgramBlock() {
  return (
    <div>
      <p className="font-semibold">No active program</p>
      <p className="text-sm text-neutral-400 mt-1">
        Set up a program (e.g. 12-week split with Upper/Lower routines), then start it to track workouts.
      </p>
      <Link to="/program" className="btn-primary mt-4 inline-flex">Set up a program</Link>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

// ---------- the two-block hero ----------

// One block open, one folded. The folded one is a single tappable line; the open one's
// heading is the same control, so tapping either swaps them.
function HeroBlock({ label, labelClass = '', line, open, onToggle, status, children }) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="w-full flex items-center justify-between gap-3 text-left min-h-11 py-1"
      >
        <span className="text-sm text-neutral-300 truncate">
          <span className={`section-label inline mr-2 ${labelClass}`}>{label}</span>
          {line}
        </span>
        <ChevronIcon />
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="w-full flex items-baseline justify-between gap-3 text-left min-h-11 md:min-h-0"
      >
        <span className={`section-label ${labelClass}`}>{label}</span>
        <span className="text-xs text-neutral-400 inline-flex items-center gap-1">
          {status}
          <ChevronIcon open />
        </span>
      </button>
      {children}
    </div>
  );
}

function checkinLine(checkin) {
  if (!ratingsComplete(checkin)) return null;
  const parts = [`Mood ${checkin.mood}`, `Energy ${checkin.energy}`, `Soreness ${checkin.soreness}`];
  if (rampComplete(checkin)) parts.push(`${RAMP_FIELDS.map((f) => (checkin[f] ? '✓' : '✗')).join('')}`);
  return parts.join(' · ');
}

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
      .catch(() => { /* stay on the dashboard; the Start button is right there */ });
  }, [params, resolved, inProgress, active, navigate, qc, setParams]);
}

export default function Dashboard() {
  const { data: active, isLoading: activeLoading } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: inProgress, isLoading: inProgressLoading } = useQuery({
    queryKey: ['in-progress-workout'],
    queryFn: getInProgressWorkout,
    staleTime: 0,
  });
  const { data: checkin } = useQuery({ queryKey: ['checkin'], queryFn: getCheckin, staleTime: 60_000 });
  const { data: week } = useWeek();

  const resolved = !activeLoading && !inProgressLoading;
  useStartNextShortcut({ active, inProgress, resolved });

  // Which block is open: his choice if he's made one this visit, else the clock — and an
  // unfinished session always opens first, whatever the hour. The choice remembers which
  // session (if any) it was made under, so folding the session to check in mid-workout
  // sticks, but a session that starts afterwards still comes up open.
  const evening = new Date().getHours() >= EVENING_HOUR;
  const sessionId = inProgress?.id ?? null;
  const [chosen, setChosen] = useState(null);
  const choice = chosen && chosen.sessionId === sessionId ? chosen.to : null;
  const openBlock = choice ?? (inProgress ? 'session' : evening ? 'checkin' : 'session');
  const swap = (to) => { track('ui', 'today-hero-swap', { to, evening }); setChosen({ to, sessionId }); };

  const todayRow = week?.days?.find((d) => d.state === 'today');
  const todayGymDone = todayRow?.planned?.kind === 'gym' && todayRow.done ? todayRow : null;
  const next = active?.progress?.next_routine;

  const sessionLabel = !resolved ? 'Session' : inProgress ? 'In progress' : todayGymDone ? 'Done today' : 'Up next';
  const sessionLine = !resolved
    ? <Skeleton className="inline-block h-3.5 w-40 align-middle" />
    : inProgress
    ? inProgress.routine_name || 'Workout'
    : todayGymDone
      ? [todayGymDone.planned.title, todayGymDone.actual?.[0]?.meta].filter(Boolean).join(' · ')
      : !active ? 'No active program'
      : next ? next.name : 'Program complete';
  const checkinSummary = checkinLine(checkin);

  return (
    <Page>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-neutral-400 mt-1">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {active?.progress?.week && ` · Week ${active.progress.week}${active.total_weeks ? ` of ${active.total_weeks}` : ''}`}
        </p>
      </div>

      <WeekStrip />

      <section className="border-t border-neutral-800 pt-3">
        <HeroBlock
          label={sessionLabel}
          labelClass={inProgress ? 'text-emerald-400' : ''}
          line={sessionLine}
          open={openBlock === 'session'}
          onToggle={() => swap(openBlock === 'session' ? 'checkin' : 'session')}
        >
          {!resolved ? <SessionSkeleton />
            : inProgress ? <InProgressBlock workout={inProgress} />
            : !active ? <NoProgramBlock />
            : <NextWorkoutBlock program={active} />}
        </HeroBlock>
      </section>

      <section className="border-t border-neutral-800 pt-3">
        <HeroBlock
          label={checkinSummary ? 'Check-in' : evening ? 'Tonight’s check-in' : 'Today’s check-in'}
          line={checkinSummary || (evening ? 'ratings and the evening ramp' : 'mood · energy · soreness')}
          status={checkinSummary ? 'Saved' : null}
          open={openBlock === 'checkin'}
          onToggle={() => swap(openBlock === 'checkin' ? 'session' : 'checkin')}
        >
          <CheckinCard compact />
        </HeroBlock>
      </section>

      <TodayTiles />

      <CoachCard />
    </Page>
  );
}
