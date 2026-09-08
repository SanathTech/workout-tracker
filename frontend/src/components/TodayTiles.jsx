import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getReadiness, getTrends } from '../api/client';
import { Skeleton } from './Skeleton';

// Four numbers from last night, each against its own ten-day baseline, each a link to
// the reading on Health. They share the Health page's queries (['readiness'] and
// ['trends', 90]) so the tap lands on a screen that's already loaded. Battery and sleep
// come from /readiness because that's the endpoint that knows about THIS morning —
// /trends' wellness series deliberately ends yesterday.
//
// Colour is direction-vs-good, not magnitude: emerald when the delta helps, amber when
// it doesn't, muted when it's inside the noise. Weight's "good" direction comes from the
// goal, so it flips if he ever moves to a gain block.

const noise = { battery: 3, sleepMins: 10, weightKg: 0.15 };

function mean(values) {
  const xs = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function hmm(mins) {
  const m = Math.round(Math.abs(mins));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tone(delta, good, threshold) {
  if (delta == null || Math.abs(delta) < threshold) return 'text-neutral-400';
  return (delta > 0) === (good === 'up') ? 'text-emerald-400' : 'text-amber-400';
}

function arrow(delta) {
  return delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
}

function Tile({ label, value, sub, subClass = 'text-neutral-400', srLabel }) {
  return (
    <Link
      to="/trends"
      className="block rounded-lg bg-neutral-900 px-2.5 py-2 min-w-0 hover:bg-neutral-800 transition-colors"
      aria-label={srLabel}
    >
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-neutral-200 leading-tight mt-0.5">{value}</p>
      <p className={`text-[11px] tabular-nums truncate ${subClass}`}>{sub}</p>
    </Link>
  );
}

export function buildTiles({ readiness, trends }) {
  // A watch that hasn't synced shows a dash, not a three-day-old battery dressed up as
  // this morning's. The server has already made the "is this last night" call.
  const night = readiness?.is_last_night ? readiness.last_night : null;
  const wellness = trends?.wellness || [];
  const prior = wellness.filter((w) => !night || w.date !== night.date).slice(-10);

  const tiles = [];

  const bb = night?.body_battery_at_wake ?? null;
  const bbBase = readiness?.baseline_10d?.body_battery_at_wake != null
    ? Number(readiness.baseline_10d.body_battery_at_wake)
    : mean(prior.map((w) => w.body_battery_at_wake));
  const bbDelta = bb != null && bbBase != null ? bb - bbBase : null;
  tiles.push({
    label: 'Battery',
    value: bb ?? '—',
    sub: bbDelta != null ? `${arrow(Math.round(bbDelta))} ${Math.abs(Math.round(bbDelta))}` : night ? 'no baseline' : 'no sync',
    subClass: tone(bbDelta, 'up', noise.battery),
    srLabel: bb != null ? `Body battery ${bb}${bbDelta != null ? `, ${Math.round(bbDelta)} against the ten-day mean` : ''}` : 'Body battery, no data',
  });

  const slp = night?.sleep_secs != null ? night.sleep_secs / 60 : null;
  const slpBase = mean(prior.map((w) => (w.sleep_secs != null ? w.sleep_secs / 60 : null)));
  const slpDelta = slp != null && slpBase != null ? slp - slpBase : null;
  tiles.push({
    label: 'Sleep',
    value: slp != null ? hmm(slp) : '—',
    sub: slpDelta != null ? `${arrow(Math.round(slpDelta))} ${hmm(slpDelta)}` : night ? 'no baseline' : 'no sync',
    subClass: tone(slpDelta, 'up', noise.sleepMins),
    srLabel: slp != null ? `Sleep ${hmm(slp)}${slpDelta != null ? `, ${Math.round(slpDelta)} minutes against the ten-day mean` : ''}` : 'Sleep, no data',
  });

  // Bodyweight arrives newest-first and only on days he stood on the scale.
  const bw = trends?.bodyweight || [];
  const wLatest = bw[0] ? Number(bw[0].weight_kg) : null;
  const wBase = mean(bw.slice(1, 11).map((r) => r.weight_kg));
  const wDelta = wLatest != null && wBase != null ? wLatest - wBase : null;
  const goal = trends?.protocol?.weight?.goal_kg;
  const wGood = goal == null || wBase == null ? null : goal < wBase ? 'down' : 'up';
  tiles.push({
    label: 'Weight',
    value: wLatest != null ? wLatest.toFixed(1) : '—',
    sub: wDelta != null ? `${arrow(Math.round(wDelta * 10))} ${Math.abs(wDelta).toFixed(1)}` : wLatest != null ? 'no baseline' : 'no reading',
    subClass: wGood ? tone(wDelta, wGood, noise.weightKg) : 'text-neutral-400',
    srLabel: wLatest != null ? `Weight ${wLatest.toFixed(1)} kilograms${wDelta != null ? `, ${wDelta.toFixed(1)} against the ten-day mean` : ''}` : 'Weight, no reading',
  });

  const bed = trends?.protocol?.bedtime?.last_night;
  const bedFresh = bed && (bed.date === localDate(0) || bed.date === localDate(-1));
  const vs = bedFresh ? bed.minutes_vs_anchor : null;
  tiles.push({
    label: 'Bed',
    value: bedFresh && bed.bed ? bed.bed : '—',
    sub: vs == null ? (bedFresh ? '' : 'no sync') : bed.within_anchor ? 'on time' : `${vs > 0 ? '+' : '−'}${hmm(vs)}`,
    subClass: vs == null ? 'text-neutral-400' : bed.within_anchor || vs < 0 ? 'text-emerald-400' : 'text-amber-400',
    srLabel: bedFresh && bed.bed ? `Bed at ${bed.bed}${vs != null ? `, ${vs} minutes against the anchor` : ''}` : 'Bedtime, no data',
  });

  return tiles;
}

export default function TodayTiles() {
  const { data: readiness, isLoading: rLoading } = useQuery({
    queryKey: ['readiness'],
    queryFn: getReadiness,
    staleTime: 5 * 60_000,
  });
  const { data: trends, isLoading: tLoading } = useQuery({
    queryKey: ['trends', 90],
    queryFn: () => getTrends({ days: 90 }),
    staleTime: 5 * 60_000,
  });

  if (rLoading || tLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[60px] rounded-lg" />)}
      </div>
    );
  }
  if (!readiness && !trends) return null;

  return (
    <div className="grid grid-cols-4 gap-2">
      {buildTiles({ readiness, trends }).map((t) => <Tile key={t.label} {...t} />)}
    </div>
  );
}
