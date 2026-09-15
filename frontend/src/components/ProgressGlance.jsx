import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getLastSession, getLoadHistory, getVolumeProgress } from '../api/client';
import Sparkline from './Sparkline';
import { formatDay } from '../util/format';

// The four things he was flicking through every tab to find (2026-09-14): are the lifts
// going up, where is the weight, is the engine growing, is the protocol holding. One line
// each with its trend, and a tap to where that answer lives in full.

function pace(s) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

function Row({ to, label, title, sub, series, field, stroke }) {
  return (
    <Link to={to} className="grid grid-cols-[4.5rem_1fr_4rem] items-center gap-2 py-1.5 min-h-11 hover:bg-neutral-900/50 rounded-md transition-colors">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-200 truncate tabular-nums">{title}</span>
        {sub && <span className="block text-[11px] text-neutral-400 truncate tabular-nums">{sub}</span>}
      </span>
      <Sparkline data={series || []} field={field} stroke={stroke} width={64} height={22} className="w-16 h-[22px]" />
    </Link>
  );
}

export default function ProgressGlance({ trends, week }) {
  const { data: last } = useQuery({ queryKey: ['last-session'], queryFn: getLastSession, staleTime: 5 * 60_000 });
  const { data: volume } = useQuery({ queryKey: ['volume', 8], queryFn: () => getVolumeProgress({ weeks: 8 }), staleTime: 5 * 60_000 });
  const { data: load } = useQuery({ queryKey: ['load-history', 14], queryFn: () => getLoadHistory({ days: 14 }), staleTime: 5 * 60_000 });

  const rows = [];

  if (last) {
    const routine = (last.routine_name || '').split(' — ')[0];
    rows.push({
      key: 'lifts', to: '/progress', label: 'Lifts',
      title: last.compared ? `${last.up} of ${last.compared} lifts up` : `${last.lifts.length} lifts logged`,
      sub: `${routine} · ${formatDay(last.date, { weekday: 'short', day: 'numeric', month: 'short' })}`,
      series: (volume || []).map((v) => ({ v: Number(v.total_volume) })), field: 'v', stroke: '#e5e5e5',
    });
  }

  const bw = (trends?.bodyweight || []).filter((r) => r.weight_kg != null);
  if (bw.length) {
    const recent = bw.slice(0, 7).map((r) => Number(r.weight_kg));
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const goal = trends?.protocol?.weight?.goal_kg;
    rows.push({
      key: 'weight', to: '/health?metric=weight_kg', label: 'Weight',
      title: `${avg.toFixed(1)} kg`,
      sub: `${recent.length}-reading avg${goal != null ? ` · goal ${Number(goal)}` : ''}`,
      series: bw.slice(0, 14).reverse(), field: 'weight_kg', stroke: '#fb923c',
    });
  }

  const ctl = (load || []).filter((d) => d.ctl != null);
  if (ctl.length) {
    const run = [...(week?.days || []).flatMap((d) => d.actual)].reverse()
      .find((a) => a.kind === 'run' && a.stats?.run_pace_s)?.stats || week?.previous?.run?.stats;
    rows.push({
      key: 'engine', to: '/health', label: 'Engine',
      title: `Fitness ${Number(ctl[ctl.length - 1].ctl).toFixed(1)}`,
      sub: run?.run_pace_s ? `running ${pace(run.run_pace_s)} /km at HR ${run.average_hr}` : null,
      series: ctl.map((d) => ({ ctl: Number(d.ctl) })), field: 'ctl', stroke: '#2dd4bf',
    });
  }

  // The last seven tracked nights, newest first from the server. Counted here rather than
  // taken from nights_*_last7, whose window is eight dates wide.
  const recentNights = (trends?.protocol?.bedtime?.last_14_nights || []).slice(0, 7);
  if (recentNights.length) {
    // Oldest → newest so the line reads left to right; 1 = in the window, 0 = not.
    const nights = [...recentNights].reverse().map((n) => ({ in: n.within_anchor ? 1 : 0 }));
    const moved = trends.protocol.movement?.today_met_so_far;
    rows.push({
      key: 'protocol', to: '/health', label: 'Protocol',
      title: `Bed on time ${recentNights.filter((n) => n.within_anchor).length} of ${recentNights.length}`,
      sub: moved ? 'movement ✓ today' : 'movement not yet today',
      series: nights, field: 'in', stroke: '#fbbf24',
    });
  }

  if (!rows.length) return null;
  return (
    <div className="divide-y divide-neutral-900">
      {rows.map(({ key, ...r }) => <Row key={key} {...r} />)}
    </div>
  );
}
