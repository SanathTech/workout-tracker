import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getActiveProgram, getInProgressWorkout, getWorkout, getWorkouts,
  startWorkout, updateWorkout, completeWorkout,
} from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import { readDraft, clearDraft } from '../util/draft';
import { formatDay, localDate, parseDay } from '../util/format';

// Home (2026-11-03 redesign): pick a workout. Next up is the routine done longest ago
// (backend util/rotation.js); the others sit under it, any of them one tap. Nothing here
// knows about weekdays, weeks or missed days, by design: his week stopped having fixed
// gym days, and the schedule that assumed it was marking him absent.

const isBlank = (v) => v === '' || v == null;

function sinceLabel(day) {
  if (!day) return 'Not done yet';
  const days = Math.round((parseDay(localDate()) - parseDay(day)) / 86_400_000);
  if (days <= 0) return 'Done today';
  if (days === 1) return 'Done yesterday';
  return `Last done ${days} days ago`;
}

function useStart() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (routineId) => startWorkout({ routine_id: routineId }),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      qc.invalidateQueries({ queryKey: ['active-program'] });
      navigate(`/session/${w.id}`);
    },
  });
}

// Resume, or Finish without opening the session. Finishing from here first pushes any
// edits this device never got to save — the session's draft is the only copy of them —
// so the workout completes with everything that was typed.
function OpenSession({ workout }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['workout', workout.id], queryFn: () => getWorkout(workout.id), staleTime: 0 });
  let logged = 0;
  let planned = 0;
  for (const ex of data?.exercises || []) {
    for (const s of ex.sets || []) {
      planned += 1;
      if (!isBlank(s.reps)) logged += 1;
    }
  }

  // Two taps: Finish sits next to Resume, and a stray tap would end a session mid-gym.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const finish = useMutation({
    mutationFn: async () => {
      const draft = readDraft(workout.id);
      if (draft?.payload) await updateWorkout(workout.id, JSON.parse(draft.payload));
      return completeWorkout(workout.id);
    },
    onSuccess: () => {
      clearDraft(workout.id);
      qc.invalidateQueries({ queryKey: ['workout', workout.id] });
      qc.invalidateQueries({ queryKey: ['in-progress-workout'] });
      qc.invalidateQueries({ queryKey: ['active-program'] });
      qc.invalidateQueries({ queryKey: ['workouts-history'] });
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      navigate(`/workouts/${workout.id}`);
    },
  });

  return (
    <div className="space-y-3">
      <div>
        <p className="section-label text-emerald-400">In progress</p>
        <h2 className="text-xl font-semibold tracking-tight mt-0.5">{workout.routine_name || 'Workout'}</h2>
        <p className="text-sm text-neutral-400 mt-0.5 tabular-nums">
          {planned > 0 && <>{logged}/{planned} sets · </>}
          {workout.resumed_at ? 'resumed' : 'started'} {new Date(workout.resumed_at || workout.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
      <div className="flex gap-2">
        <Link to={`/session/${workout.id}`} className="btn-primary flex-1 justify-center py-3">Resume</Link>
        <button
          type="button"
          onClick={() => (confirming ? finish.mutate() : setConfirming(true))}
          disabled={finish.isPending}
          className={`flex-1 justify-center py-3 ${confirming ? 'btn-primary' : 'btn-secondary'}`}
        >
          {finish.isPending ? 'Finishing…' : confirming ? 'Finish — sure?' : 'Finish'}
        </button>
      </div>
      {finish.isError && (
        <p className="text-sm text-red-400" role="alert">Couldn’t finish it — check your connection and try again.</p>
      )}
    </div>
  );
}

function Pick({ program }) {
  const start = useStart();
  const next = program.progress?.next_routine;
  const others = program.routines.filter((r) => r.id !== next?.id);

  if (!program.routines.length) {
    return (
      <div>
        <p className="font-semibold">No routines yet</p>
        <Link to={`/program/${program.id}/edit`} className="btn-primary mt-4 inline-flex">Add routines</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {next && (
        <div className="space-y-3">
          <div>
            <p className="section-label">Next up</p>
            <h2 className="text-xl font-semibold tracking-tight mt-0.5">{next.name}</h2>
            <p className="text-sm text-neutral-400 mt-0.5">{sinceLabel(program.routines.find((r) => r.id === next.id)?.last_done)}</p>
          </div>
          <button
            type="button"
            onClick={() => start.mutate(next.id)}
            disabled={start.isPending}
            className="btn-primary w-full justify-center py-3"
          >
            Start
          </button>
        </div>
      )}
      {others.length > 0 && (
        <Section label="Or pick another">
          <div className="divide-y divide-neutral-800">
            {others.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => start.mutate(r.id)}
                disabled={start.isPending}
                className="w-full flex items-center justify-between gap-3 py-3 min-h-11 text-left group"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-neutral-200 truncate group-hover:underline">{r.name}</span>
                  <span className="block text-sm text-neutral-400">{sinceLabel(r.last_done)}</span>
                </span>
                <span className="text-sm text-emerald-400 shrink-0">Start ›</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {start.isError && (
        <p className="text-sm text-red-400" role="alert">Couldn’t start it — check your connection and try again.</p>
      )}
    </div>
  );
}

function LastSession() {
  const { data } = useQuery({
    queryKey: ['workouts-history', 'last'],
    queryFn: () => getWorkouts({ status: 'completed', limit: 1 }),
    staleTime: 60_000,
  });
  const w = data?.[0];
  if (!w) return null;
  return (
    <Link to={`/workouts/${w.id}`} className="block text-sm text-neutral-400 hover:text-neutral-200 min-h-11 py-2">
      Last: <span className="text-neutral-300">{w.routine_name || 'Workout'}</span>
      {' · '}{formatDay(w.date, { weekday: 'short', month: 'short', day: 'numeric' })}
      {w.duration_minutes ? ` · ${w.duration_minutes} min` : ''} ›
    </Link>
  );
}

// The manifest's "Start next workout" shortcut lands on /?start=next. An open session
// wins: the shortcut must never start a second one.
function useStartNextShortcut({ program, inProgress, resolved }) {
  const navigate = useNavigate();
  const start = useStart();
  const [params, setParams] = useSearchParams();
  const firedRef = useRef(false);

  useEffect(() => {
    if (params.get('start') !== 'next' || !resolved || firedRef.current) return;
    firedRef.current = true;
    setParams({}, { replace: true });
    if (inProgress) { navigate(`/session/${inProgress.id}`); return; }
    const routineId = program?.progress?.next_routine?.id;
    if (routineId) start.mutate(routineId);
  }, [params, resolved, inProgress, program, navigate, start, setParams]);
}

export default function Home() {
  const { data: program, isLoading: programLoading } = useQuery({ queryKey: ['active-program'], queryFn: getActiveProgram });
  const { data: inProgress, isLoading: inProgressLoading } = useQuery({
    queryKey: ['in-progress-workout'],
    queryFn: getInProgressWorkout,
    staleTime: 0,
  });
  const resolved = !programLoading && !inProgressLoading;
  useStartNextShortcut({ program, inProgress, resolved });

  return (
    <Page>
      {!resolved ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : inProgress ? (
        <OpenSession workout={inProgress} />
      ) : program ? (
        <Pick program={program} />
      ) : (
        <div>
          <p className="font-semibold">No routines yet</p>
          <Link to="/program/new" className="btn-primary mt-4 inline-flex">Set up routines</Link>
        </div>
      )}

      <LastSession />

      <div className="flex gap-4 text-sm">
        {program && (
          <Link to={`/program/${program.id}/edit`} className="text-neutral-400 hover:text-neutral-200 min-h-11 inline-flex items-center">
            Edit routines ›
          </Link>
        )}
        <Link to="/exercises" className="text-neutral-400 hover:text-neutral-200 min-h-11 inline-flex items-center">
          Exercises ›
        </Link>
      </div>
    </Page>
  );
}
