import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getStats, getVolumeProgress, getExerciseProgress, getPersonalBests, getExercises, getSuggestions, getCoachNotes } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import ExercisePickerSheet from '../components/ExercisePickerSheet';
import AimLine from '../components/AimLine';
import AimEditSheet from '../components/AimEditSheet';
import { Page, Section, Disclosure } from '../components/ui';
import { ChevronIcon } from '../components/icons';
import { formatDay, formatKg } from '../util/format';
import MuscleVolume from '../components/MuscleVolume';

// Lifts (2026-09-08, PR 4): one exercise at a time. The picker is the first thing on the
// page because "how is my RDL going" is the question this tab answers — the old layout
// buried the exercise chart under two volume cards and a stat grid, and the picker forgot
// its choice on every visit. Range chips replace the dropdown (one tap, not two), the
// bests sit under the chart, and the aim line is the same component the session shows,
// with edit — this is where a coach call gets written from the phone. Everything about
// training as a whole (muscle sets, totals, weekly volume, all PBs) comes after.
// Bodyweight lives on Health (PR 5) and nowhere else: it's a body number, not a lift.

// Chart ink for the one (dark) theme: neutral-200 line, neutral-400 text, neutral-800 grid.
const CHART = { accent: '#e5e5e5', accentAlt: '#a3a3a3', grid: '#262626', text: '#a3a3a3' };
const TOOLTIP = { background: 'rgba(0,0,0,0.85)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12 };
const RANGES = [4, 12, 24, 52];
const REMEMBER_KEY = 'lifts.exercise';

const readRemembered = () => {
  try { return Number(localStorage.getItem(REMEMBER_KEY)) || null; } catch { return null; }
};

const formatDate = (dateStr) => formatDay(dateStr, { month: 'short', day: 'numeric' });

function StatCard({ label, value, unit, loading }) {
  return (
    <div>
      <p className="section-label">{label}</p>
      {loading ? (
        <Skeleton className="h-7 w-16 mt-2" />
      ) : (
        <p className="text-2xl font-semibold mt-0.5 tabular-nums">
          {value}
          {unit && <span className="text-sm font-normal text-neutral-400 ml-1">{unit}</span>}
        </p>
      )}
    </div>
  );
}

function Best({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <p className="section-label">{label}</p>
      <p className="font-semibold tabular-nums mt-0.5 truncate">{value}</p>
      {sub && <p className="text-xs text-neutral-400 truncate">{sub}</p>}
    </div>
  );
}

function ExerciseCard({ exercise, weeks, pb, onPick }) {
  const [editing, setEditing] = useState(false);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['exercise-progress', exercise?.id, weeks],
    queryFn: () => getExerciseProgress(exercise.id, { weeks }),
    enabled: !!exercise,
  });
  // Unscoped: Lifts isn't inside a routine, so the server picks the prescription. Same
  // key prefix as the session's scoped query so a saved call invalidates both.
  const { data: suggestions = [] } = useQuery({ queryKey: ['suggestions', null], queryFn: () => getSuggestions(), staleTime: 5 * 60_000, enabled: !!exercise });
  const { data: notes = [] } = useQuery({ queryKey: ['coach-notes'], queryFn: getCoachNotes, staleTime: 5 * 60_000, enabled: !!exercise });

  const sug = exercise ? suggestions.find((s) => s.exercise_id === exercise.id) : null;
  const aim = sug?.aim ?? null;
  const note = aim?.note_id ? notes.find((n) => n.id === aim.note_id) : null;

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={onPick}
        className="flex items-center gap-2 w-full text-left min-h-11"
        aria-label={exercise ? `Exercise: ${exercise.name} — change` : 'Pick an exercise'}
      >
        <span className={`flex-1 min-w-0 truncate text-xl font-semibold tracking-tight ${exercise ? 'text-neutral-200' : 'text-neutral-400'}`}>
          {exercise ? exercise.name : 'Pick an exercise'}
        </span>
        <span className="text-xs text-neutral-400 shrink-0 inline-flex items-center gap-0.5">change <ChevronIcon /></span>
      </button>

      {!exercise ? (
        <p className="text-sm text-neutral-400 py-8 text-center">Pick an exercise to see how it’s going.</p>
      ) : isLoading ? (
        <Skeleton className="h-[240px] w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400 py-8 text-center">Nothing logged for this lift in the last {weeks} weeks.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: CHART.text }} stroke={CHART.grid} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: CHART.text }} stroke={CHART.grid} />
            <YAxis yAxisId="rir" orientation="right" width={28} domain={[0, (max) => Math.max(4, Math.ceil(Number.isFinite(max) ? max : 0))]} allowDecimals={false} tick={{ fontSize: 11, fill: CHART.text }} stroke={CHART.grid} />
            <Tooltip labelFormatter={formatDate} contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="max_weight" stroke={CHART.accent} strokeWidth={1.5} dot={{ r: 3 }} name="Max weight (kg)" />
            <Line yAxisId="left" type="monotone" dataKey="total_reps" stroke={CHART.accentAlt} strokeWidth={1.5} dot={{ r: 3 }} name="Total reps" />
            <Line yAxisId="rir" type="monotone" dataKey="avg_rir" stroke={CHART.accentAlt} strokeDasharray="4 2" strokeWidth={1.5} dot={{ r: 2 }} name="Avg RIR" connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}

      {exercise && (
        <div className="grid grid-cols-3 gap-3">
          <Best
            label="Best set"
            value={pb ? `${pb.best_weight != null ? formatKg(pb.best_weight) : 'BW'} × ${pb.reps}` : '—'}
            sub={pb ? formatDay(pb.date, { month: 'short', day: 'numeric', year: 'numeric' }) : 'no working sets'}
          />
          {/* Epley on an assisted lift (negative load) is a negative number — say nothing. */}
          <Best label="e1RM" value={pb?.est_1rm > 0 ? formatKg(pb.est_1rm) : '—'} sub={pb && pb.est_1rm == null ? 'over 12 reps' : pb?.est_1rm <= 0 ? 'assisted' : null} />
          <Best label="Sessions" value={rows.length} sub={`last ${weeks} wk`} />
        </div>
      )}

      {exercise && (
        aim ? (
          // A coach aim edits its note, so no edit until that note has loaded — otherwise
          // a fast tap would go down the create path and leave two calls in the ledger.
          <AimLine aim={aim} cues={sug?.cues ?? []} onEdit={aim.source !== 'coach' || note ? () => setEditing(true) : undefined} />
        ) : (
          <div className="flex items-center gap-2 text-sm min-h-11">
            <span className="text-neutral-400">No aim yet</span>
            <button type="button" onClick={() => setEditing(true)} className="ml-auto h-11 pl-3 pr-2 -mr-2 text-xs text-neutral-400 hover:text-neutral-200">
              set one ›
            </button>
          </div>
        )
      )}

      {editing && exercise && (
        <AimEditSheet exercise={exercise} aim={aim} note={note} onClose={() => setEditing(false)} />
      )}
    </section>
  );
}

function WeeklyVolume({ weeks }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['volume-progress', weeks],
    queryFn: () => getVolumeProgress({ weeks }),
  });
  if (isLoading) return <Skeleton className="h-[200px] w-full" />;
  if (data.length === 0) return <p className="text-center text-neutral-400 py-8 text-sm">Log workouts to see volume trends.</p>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
        <XAxis dataKey="week_start" tickFormatter={formatDate} tick={{ fontSize: 11, fill: CHART.text }} stroke={CHART.grid} />
        <YAxis tick={{ fontSize: 11, fill: CHART.text }} stroke={CHART.grid} />
        <Tooltip labelFormatter={formatDate} formatter={(v) => [`${Math.round(v).toLocaleString()} kg`, 'Volume']} contentStyle={TOOLTIP} />
        <Bar dataKey="total_volume" fill={CHART.accent} radius={[2, 2, 0, 0]} name="Volume (kg)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AllBests({ pbs, loading, onPick }) {
  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    );
  }
  if (pbs.length === 0) return <p className="text-center text-neutral-400 py-8 text-sm">Log workouts to see your personal bests.</p>;
  // Tapping a row selects that lift up top — the list doubles as a second picker.
  return (
    <ul className="divide-y divide-neutral-800">
      {pbs.map((pb) => (
        <li key={pb.exercise_id}>
          <button type="button" onClick={() => onPick(pb.exercise_id)} className="w-full text-left py-2.5 min-h-11">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium truncate">{pb.exercise_name}</span>
              <span className="font-semibold tabular-nums shrink-0">
                {pb.best_weight != null ? formatKg(pb.best_weight) : 'BW'} × {pb.reps}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {pb.muscle_group}
              {pb.est_1rm != null && ` · ${formatKg(pb.est_1rm)} e1RM`}
              {' · '}
              {formatDay(pb.date, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Progress() {
  const [weeks, setWeeks] = useState(12);
  const [exerciseId, setExerciseId] = useState(readRemembered);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showBests, setShowBests] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery({ queryKey: ['stats'], queryFn: getStats, staleTime: 10 * 60_000 });
  const { data: allExercises = [] } = useQuery({ queryKey: ['exercises'], queryFn: getExercises });
  const { data: pbs = [], isLoading: pbsLoading } = useQuery({ queryKey: ['personal-bests'], queryFn: getPersonalBests });

  // First visit: the lift with the most recent best, so the page opens on something
  // he's actually training (the list is ranked on load, so [0] was a one-off from May).
  useEffect(() => {
    if (exerciseId != null || !pbs.length) return;
    setExerciseId(pbs.reduce((a, b) => (b.date > a.date ? b : a)).exercise_id);
  }, [exerciseId, pbs]);

  const pick = (id) => {
    setExerciseId(id);
    try { localStorage.setItem(REMEMBER_KEY, String(id)); } catch { /* private mode */ }
  };

  const exercise = useMemo(() => allExercises.find((e) => e.id === exerciseId) ?? null, [allExercises, exerciseId]);
  const pb = useMemo(() => pbs.find((p) => p.exercise_id === exerciseId) ?? null, [pbs, exerciseId]);

  const volume = stats ? (stats.total_volume_kg < 1000
    ? Math.round(stats.total_volume_kg).toLocaleString()
    : (stats.total_volume_kg / 1000).toLocaleString(undefined, stats.total_volume_kg < 10000
        ? { minimumFractionDigits: 1, maximumFractionDigits: 1 }
        : { maximumFractionDigits: 0 })) : '—';

  return (
    <Page>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Lifts</h1>
        <div className="flex gap-1.5" role="group" aria-label="Time range — drives every chart on this page">
          {RANGES.map((w) => (
            <button key={w} type="button" onClick={() => setWeeks(w)} aria-pressed={weeks === w} className={weeks === w ? 'chip-solid' : 'chip'}>
              {w}w
            </button>
          ))}
        </div>
      </div>

      <ExerciseCard exercise={exercise} weeks={weeks} pb={pb} onPick={() => setPickerOpen(true)} />

      <Section><MuscleVolume weeks={weeks} /></Section>

      <Section label="All time">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Workouts" value={stats?.total_workouts} loading={statsLoading} />
          <StatCard label="This week" value={stats?.workouts_this_week} loading={statsLoading} />
          <StatCard label="Sets" value={stats?.total_sets} loading={statsLoading} />
          <StatCard label="Volume" value={volume} unit={stats ? (stats.total_volume_kg < 1000 ? 'kg' : 't') : ''} loading={statsLoading} />
        </div>
      </Section>

      <Section label="Weekly volume" action={<Disclosure open={showVolume} label={showVolume ? 'Hide' : 'Show'} onClick={() => setShowVolume((v) => !v)} />}>
        {showVolume && <WeeklyVolume weeks={weeks} />}
      </Section>

      <Section label="Personal bests" action={<Disclosure open={showBests} label={showBests ? 'Hide' : pbsLoading ? 'Loading…' : `${pbs.length} lifts`} onClick={() => setShowBests((v) => !v)} />}>
        {showBests && <AllBests pbs={pbs} loading={pbsLoading} onPick={(id) => { pick(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
      </Section>

      <ExercisePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(picked) => pick(picked.id)}
        title="Pick an exercise"
        currentExerciseId={exerciseId}
      />
    </Page>
  );
}
