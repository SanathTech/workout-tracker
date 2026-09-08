import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getActiveProgram, getInProgressWorkout, getWorkout, getSuggestions, getCheckin,
  startWorkout, skipUpcomingWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import CheckinCard, { checkinStarted } from '../components/CheckinCard';
import WeekStrip, { useWeek } from '../components/WeekPlan';
import TodayTiles from '../components/TodayTiles';
import CoachCard from '../components/CoachCard';

// Today (2026-09-08 redesign, PR 3; density pass PR 6 the same day). Two things happen
// on this screen and only two: a session gets started, a check-in gets done. Both
// blocks are open, always. PR 3 shipped them as a pair that swapped on the clock — the
// session until 19:00, the check-in after — and the first evening on a phone it read
// as two folded one-liners over a screen of nothing: the lift preview and the Start
// button were behind a chevron on the one day a week they matter. Nothing on this page
// is folded now; the page is short because the rhythm is, not because it hides things.

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
        <Link to="/program/new" className="btn-primary mt-4 inline-flex">New program</Link>
      </div>
    );
  }

  const next = progress.next_routine;
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold tracking-tight">
        {next.name}
        <span className="text-sm font-normal text-neutral-400 ml-2">{next.exercises.length} exercises</span>
      </h2>

      <LiftPreview routine={next} />

      <div className="space-y-1 pt-1">
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
      <Link to="/program/new" className="btn-primary mt-4 inline-flex">Set up a program</Link>
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

  const todayRow = week?.days?.find((d) => d.state === 'today');
  const todayGymDone = todayRow?.planned?.kind === 'gym' && todayRow.done ? todayRow : null;
  const sessionLabel = !resolved ? 'Session' : inProgress ? 'In progress' : todayGymDone ? 'Done today' : 'Up next';

  return (
    <Page dense>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {active?.progress?.week && ` · Week ${active.progress.week}${active.total_weeks ? ` of ${active.total_weeks}` : ''}`}
        </p>
      </div>

      <WeekStrip />

      <Section
        label={<span className={inProgress ? 'text-emerald-400' : ''}>{sessionLabel}</span>}
        className="pt-3"
      >
        {/* A finished gym day still shows the next routine underneath: "Done today" is
            the label, the Start below it is for the day he trains twice or wants to look
            ahead — it was never hidden before and it isn't now. */}
        {todayGymDone && (
          <p className="text-sm text-neutral-300 mb-2">
            {[todayGymDone.planned.title, todayGymDone.actual?.[0]?.meta].filter(Boolean).join(' · ')}
          </p>
        )}
        {!resolved ? <SessionSkeleton />
          : inProgress ? <InProgressBlock workout={inProgress} />
          : !active ? <NoProgramBlock />
          : <NextWorkoutBlock program={active} />}
      </Section>

      <Section
        label="Check-in"
        action={checkinStarted(checkin) && <span className="text-[11px] text-emerald-400">Saved</span>}
        className="pt-3"
      >
        <CheckinCard compact />
      </Section>

      <TodayTiles />

      <CoachCard />
    </Page>
  );
}
