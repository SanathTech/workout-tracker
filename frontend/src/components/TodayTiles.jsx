import { Link } from 'react-router-dom';
import Sparkline from './Sparkline';
import { Skeleton } from './Skeleton';

// Last night's four numbers, each against the ten nights before it, each with its own
// week drawn underneath — and each a link to THAT metric on /health, opened. Since the
// 2026-09-15 rethink they sit right under today's card rather than at the bottom: "why is
// it at the bottom" was the walkthrough's question, and it had no good answer.
//
// Colour is direction-vs-good, not magnitude: emerald when the delta helps, amber when it
// doesn't, muted inside the noise. Battery, sleep score and RHR come from /readiness,
// which knows about THIS morning; the `/coach/trends` wellness series ends yesterday, so
// it supplies the six nights before and the line ends on last night's reading.

const METRICS = [
  { field: 'sleep_score', label: 'Sleep', stroke: '#60a5fa', good: 'up', noise: 3 },
  { field: 'body_battery_at_wake', label: 'Battery', stroke: '#34d399', good: 'up', noise: 3 },
  { field: 'resting_hr', label: 'RHR', stroke: '#f472b6', good: 'down', noise: 1 },
];

function tone(delta, good, noise) {
  if (delta == null || Math.abs(delta) < noise) return 'text-neutral-400';
  return (delta > 0) === (good === 'up') ? 'text-emerald-400' : 'text-amber-400';
}

function signed(n, digits = 0) {
  const v = Number(n.toFixed(digits));
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;
}

function TileLink({ to, label, value, sub, subClass, series, field, stroke, srLabel }) {
  return (
    <Link
      to={to}
      aria-label={srLabel}
      className="block rounded-lg bg-neutral-900 px-2.5 pt-2 pb-1.5 min-w-0 hover:bg-neutral-800 transition-colors"
    >
      <p className="text-[11px] uppercase tracking-wide text-neutral-400 truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-neutral-200 leading-tight mt-0.5">{value}</p>
      <p className={`text-[11px] tabular-nums truncate ${subClass}`}>{sub || ' '}</p>
      <Sparkline data={series} field={field} stroke={stroke} width={60} height={18} className="w-full h-[18px] mt-1" />
    </Link>
  );
}

export function buildTiles({ readiness, trends }) {
  // A watch that hasn't synced shows a dash, not a three-day-old number dressed up as
  // this morning's. The server has already made the "is this last night" call.
  const night = readiness?.is_last_night ? readiness.last_night : null;
  const prior = (trends?.wellness || []).filter((w) => !night || w.date !== night.date).slice(-6);

  const tiles = METRICS.map((m) => {
    const value = night?.[m.field] ?? null;
    const base = readiness?.baseline_10d?.[m.field];
    const delta = value != null && base != null ? Number(value) - Number(base) : null;
    return {
      to: `/metric/${m.field}`,
      label: m.label,
      value: value ?? '—',
      sub: delta != null ? `${signed(delta)} vs usual` : night ? '' : 'no sync',
      subClass: tone(delta, m.good, m.noise),
      series: night ? [...prior, { [m.field]: value }] : prior,
      field: m.field,
      stroke: m.stroke,
      srLabel: value != null ? `${m.label} ${value}${delta != null ? `, ${Math.round(delta)} against your usual` : ''}` : `${m.label}, not synced`,
    };
  });

  // Bodyweight arrives newest-first and only on days he stood on the scale. Its "usual"
  // is the goal, not the last ten readings — the goal is what he is working toward.
  const bw = (trends?.bodyweight || []).filter((r) => r.weight_kg != null);
  const latest = bw[0] ? Number(bw[0].weight_kg) : null;
  const goal = trends?.protocol?.weight?.goal_kg != null ? Number(trends.protocol.weight.goal_kg) : null;
  const toGoal = latest != null && goal != null ? latest - goal : null;
  tiles.push({
    to: '/metric/weight_kg',
    label: 'Weight',
    value: latest != null ? latest.toFixed(1) : '—',
    sub: toGoal != null ? `${signed(toGoal, 1)} to goal` : latest != null ? '' : 'no reading',
    subClass: 'text-neutral-400',
    series: bw.slice(0, 7).reverse(),
    field: 'weight_kg',
    stroke: '#fb923c',
    srLabel: latest != null ? `Weight ${latest.toFixed(1)} kilograms${toGoal != null ? `, ${toGoal.toFixed(1)} from the goal` : ''}` : 'Weight, no reading',
  });

  return tiles;
}

export default function TodayTiles({ readiness, trends, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)}
      </div>
    );
  }
  if (!readiness && !trends) return null;
  return (
    <div className="grid grid-cols-4 gap-2">
      {buildTiles({ readiness, trends }).map((t) => <TileLink key={t.label} {...t} />)}
    </div>
  );
}
