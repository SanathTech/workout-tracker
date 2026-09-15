import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getActivity } from '../api/client';
import { Skeleton } from '../components/Skeleton';
import { Page, Section } from '../components/ui';
import { useSmartBack } from '../hooks/useSmartBack';
import { formatDay } from '../util/format';

// One run or swim, analysed (2026-09-15 rethink, PR 2). The walkthrough that asked for it:
// "clicking on the run stats does nothing — I want to see a breakdown. I want to analyse
// my run." Everything on the old surfaces was a one-line summary; this is where a single
// session gets read properly.
//
// Stored figures (distance, zones, strides, drift, HRR) render from the activity row, so
// the page is useful even when the second-by-second streams can't be fetched. The streams
// add the HR trace, the walk breaks and the splits. Swims never show wrist HR: it read
// 103 and 141 on two near-identical kilometres.

function clock(raw) {
  if (raw == null) return '—';
  const s = Math.round(raw);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function Stat({ label, value, unit }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400 truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-neutral-200 leading-tight">
        {value}{unit && value !== '—' && <span className="text-xs font-normal text-neutral-400 ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

// ---------- HR over the session ----------

function HrChart({ series, walks, ceiling, duration }) {
  const id = useId().replace(/:/g, '');
  const pts = series.filter((r) => r[1] != null);
  if (pts.length < 4) return null;
  const W = 320;
  const H = 160;
  const pad = { l: 28, r: 6, t: 8, b: 20 };
  const hrs = pts.map((r) => r[1]);
  // Floor from the 5th percentile, not the minimum: the first minute's warm-up HR (90s)
  // squashed the 140-160 band that the whole chart is about. Anything lower pins to the
  // floor rather than stretching the axis.
  const p5 = [...hrs].sort((m, n) => m - n)[Math.floor(hrs.length * 0.05)];
  const lo = Math.min(Math.floor((p5 - 5) / 10) * 10, ceiling - 20);
  const hi = Math.max(Math.ceil((Math.max(...hrs) + 3) / 10) * 10, ceiling + 10);
  const end = Math.max(duration || 0, pts[pts.length - 1][0]);
  const x = (t) => pad.l + (t / end) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((hi - Math.min(hi, Math.max(lo, v))) / (hi - lo)) * (H - pad.t - pad.b);
  const line = pts.map(([t, h]) => `${x(t).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  const stepMin = end > 5400 ? 30 : end > 2400 ? 20 : 10;
  const ticks = [];
  for (let m = 0; m * 60 <= end; m += stepMin) ticks.push(m);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Heart rate over the session against the ${ceiling} ceiling`}>
      <defs>
        <clipPath id={`${id}-below`}><rect x="0" y={y(ceiling)} width={W} height={H} /></clipPath>
        <clipPath id={`${id}-above`}><rect x="0" y="0" width={W} height={y(ceiling)} /></clipPath>
      </defs>
      <rect x={pad.l} y={y(ceiling)} width={W - pad.l - pad.r} height={y(ceiling - 8) - y(ceiling)} fill="rgba(52,211,153,0.12)" />
      {[lo + 10, ceiling, hi - 10].filter((v, i, a) => a.indexOf(v) === i && v > lo && v < hi).map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === ceiling ? '#fbbf24' : '#262626'} strokeDasharray={v === ceiling ? '3 3' : undefined} strokeWidth="1" />
          <text x={pad.l - 5} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill={v === ceiling ? '#fbbf24' : '#737373'}>{v}</text>
        </g>
      ))}
      {walks.map(([a, b]) => (
        <rect key={a} x={x(a)} y={H - pad.b - 5} width={Math.max(1.5, x(b) - x(a))} height="4" fill="#525252" />
      ))}
      <polyline points={line} fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinejoin="round" clipPath={`url(#${id}-below)`} />
      <polyline points={line} fill="none" stroke="#fbbf24" strokeWidth="1.6" strokeLinejoin="round" clipPath={`url(#${id}-above)`} />
      {ticks.map((m) => (
        <text key={m} x={x(m * 60)} y={H - 5} textAnchor={m === 0 ? 'start' : 'middle'} fontSize="9.5" fill="#737373">{m}′</text>
      ))}
    </svg>
  );
}

function Legend({ walks }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
      <span><i aria-hidden="true" className="inline-block w-2.5 h-[3px] rounded bg-emerald-400 align-middle mr-1" />HR</span>
      <span><i aria-hidden="true" className="inline-block w-2.5 h-[3px] rounded bg-amber-400 align-middle mr-1" />over the ceiling</span>
      <span><i aria-hidden="true" className="inline-block w-2.5 h-2 rounded-sm bg-emerald-400/20 align-middle mr-1" />easy zone</span>
      {walks > 0 && <span><i aria-hidden="true" className="inline-block w-2.5 h-[3px] rounded bg-neutral-600 align-middle mr-1" />walking</span>}
    </p>
  );
}

// ---------- zones, splits, strides ----------

const ZONE_COLOURS = ['bg-neutral-600', 'bg-emerald-400', 'bg-amber-400', 'bg-orange-400', 'bg-red-400', 'bg-red-500', 'bg-red-600'];

function Zones({ times }) {
  const zones = (times || []).map((s, i) => ({ i, s: Number(s) || 0 })).filter((z) => z.s > 0);
  const total = zones.reduce((a, z) => a + z.s, 0);
  if (!total) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
        {zones.map((z) => <span key={z.i} className={ZONE_COLOURS[z.i]} style={{ flex: z.s }} />)}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-400 tabular-nums">
        {zones.map((z) => <span key={z.i}>Z{z.i + 1} {clock(z.s)}</span>)}
      </p>
    </div>
  );
}

function RunSplits({ splits, ceiling, walked }) {
  const his = splits.map((s) => s.avg_hr).filter(Boolean);
  const lo = Math.min(...his, ceiling - 20);
  const hi = Math.max(...his, ceiling + 5);
  return (
    <Section label="Splits" action={walked && <span className="text-[11px] text-neutral-400">pace includes walk breaks</span>}>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-neutral-400 text-left">
            <th className="font-normal pb-1 w-12">km</th>
            <th className="font-normal pb-1">Pace</th>
            <th className="font-normal pb-1 text-right pr-3">HR</th>
            <th className="font-normal pb-1 w-2/5"><span className="sr-only">HR bar</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-900">
          {splits.map((s) => (
            <tr key={s.at_m} className="text-neutral-200">
              <td className="py-1.5 text-neutral-400">{s.partial ? (s.at_m / 1000).toFixed(2) : Math.round(s.at_m / 1000)}</td>
              <td className="py-1.5">{clock(s.pace_s)}</td>
              <td className="py-1.5 text-right pr-3">{s.avg_hr ?? '—'}</td>
              <td className="py-1.5">
                {s.avg_hr && (
                  <span
                    className={`block h-1.5 rounded-full ${s.avg_hr > ceiling ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    style={{ width: `${Math.max(6, ((s.avg_hr - lo) / (hi - lo)) * 100)}%` }}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function SwimSplits({ splits }) {
  const paces = splits.map((s) => s.pace_s).filter(Boolean);
  if (!paces.length) return null;
  const slow = Math.max(...paces);
  const fast = Math.min(...paces);
  return (
    <Section label="Per 100 m" action={<span className="text-[11px] text-neutral-400">includes wall rest</span>}>
      <div className="divide-y divide-neutral-900">
        {splits.map((s) => (
          <div key={s.at_m} className="grid grid-cols-[3.5rem_3.5rem_1fr] items-center gap-2 py-1.5 text-sm tabular-nums">
            <span className="text-neutral-400">{s.at_m} m</span>
            <span className="text-neutral-200">{clock(s.pace_s)}</span>
            <span
              className="block h-1.5 rounded-full bg-cyan-400"
              style={{ width: `${slow === fast ? 60 : 30 + ((slow - s.pace_s) / (slow - fast)) * 70}%` }}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Strides({ efforts }) {
  if (!Array.isArray(efforts) || efforts.length < 3) return null;
  return (
    <Section label="Strides" action={<span className="text-[11px] text-neutral-400">avg pace · seconds</span>}>
      <div className="grid grid-cols-6 gap-1.5 text-center">
        {efforts.map((e, i) => (
          <div key={i} className="rounded-md bg-neutral-900 py-1.5">
            <p className="text-sm font-semibold text-neutral-200 tabular-nums">{e.avg_pace_s ? clock(e.avg_pace_s) : '—'}</p>
            <p className="text-[10px] text-neutral-400 tabular-nums">{e.dur_s}s</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Aerobic({ summary, activity, firstSplitHr }) {
  const s = summary || {};
  const run = s.run_only || {};
  // A fast first km inflates drift; so does one that opened well UNDER the average,
  // because HR then climbs for reasons that have nothing to do with the engine.
  const openedEasy = firstSplitHr != null && activity.average_hr && firstSplitHr < activity.average_hr - 8;
  const cells = [
    s.decoupling_pct != null && {
      label: 'Drift', value: `${s.decoupling_pct}%`,
      note: openedEasy
        ? `km 1 opened at HR ${firstSplitHr}, well under the ${activity.average_hr} average, so read this as pacing, not fitness`
        : 'extra heart per metre in the second half',
    },
    s.hrr_60 != null && { label: 'HR recovery', value: `${s.hrr_60} bpm`, note: 'dropped in the minute after the peak' },
    run.cadence_spm != null && { label: 'Cadence', value: `${run.cadence_spm} spm`, note: 'running only' },
    run.share != null && { label: 'Running', value: `${Math.round(run.share * 100)}%`, note: 'of the session' },
  ].filter(Boolean);
  if (!cells.length) return null;
  return (
    <Section label="Aerobic">
      <div className="grid grid-cols-2 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg bg-neutral-900 p-2.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">{c.label}</p>
            <p className="text-base font-semibold text-neutral-200 tabular-nums">{c.value}</p>
            <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{c.note}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STREAM_MESSAGES = {
  not_configured: 'Second-by-second data isn’t connected yet, so the chart and splits are missing.',
  unavailable: 'Couldn’t reach intervals.icu just now. The stored figures are below; try again shortly.',
  no_streams: 'This activity has no recording to chart.',
};

// ---------- page ----------

export default function ActivityDetail() {
  const { id } = useParams();
  const goBack = useSmartBack();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => getActivity(id),
    staleTime: 10 * 60_000,
  });

  if (isLoading) {
    return (
      <Page>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </Page>
    );
  }
  if (isError || !data) {
    return (
      <Page>
        <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1 self-start">← Back</button>
        <p className="text-center text-neutral-400 py-16">Activity not found.</p>
      </Page>
    );
  }

  const { activity: a, streams, streams_error: streamsError, hr_ceiling: ceiling } = data;
  const summary = a.stream_summary || {};
  const swim = a.type === 'Swim';
  const running = a.type === 'Run' || a.type === 'VirtualRun';
  const km = a.distance_m ? Number(a.distance_m) / 1000 : null;
  const efforts = summary.efforts;
  const strides = Array.isArray(efforts) && efforts.length >= 3 ? efforts.length : 0;
  const title = swim ? 'Swim' : running ? (strides ? 'Run + strides' : 'Run') : a.type;

  return (
    <Page>
      <div>
        <button type="button" onClick={goBack} className="text-sm text-neutral-400 hover:text-neutral-200 inline-flex items-center min-h-11 md:min-h-0 -ml-1 pl-1">← Back</button>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-neutral-400">
          {formatDay(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}
          {a.start_time && ` · ${a.start_time}`}
        </p>
      </div>

      {swim ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Distance" value={a.distance_m ? Math.round(a.distance_m) : '—'} unit="m" />
          <Stat label="Moving" value={clock(a.moving_time)} />
          <Stat label="Pace" value={summary.moving?.pace_s_per_100m ? clock(summary.moving.pace_s_per_100m) : '—'} unit="/100m" />
          <Stat label="Wall rest" value={summary.rest ? clock(summary.rest.total_s) : '—'} unit={summary.rest ? `×${summary.rest.count}` : ''} />
          <Stat label="Elapsed" value={clock(a.elapsed_time)} />
          <Stat label="Load" value={a.training_load != null ? Math.round(a.training_load) : '—'} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Distance" value={km != null ? km.toFixed(2) : '—'} unit="km" />
          <Stat label="Time" value={clock(a.moving_time)} />
          <Stat label="Avg HR" value={a.average_hr ?? '—'} />
          {running && <Stat label="Running pace" value={summary.run_only?.pace_s_per_km ? clock(summary.run_only.pace_s_per_km) : '—'} unit="/km" />}
          <Stat label="Overall" value={km && a.moving_time ? clock(a.moving_time / km) : '—'} unit="/km" />
          <Stat label="Max HR" value={a.max_hr ?? '—'} />
        </div>
      )}

      {streamsError && <p className="text-xs text-neutral-400">{STREAM_MESSAGES[streamsError]}</p>}

      {!swim && (
        <Section label="Heart rate">
          {streams?.series && (
            <>
              <HrChart series={streams.series} walks={streams.walks || []} ceiling={ceiling} duration={streams.duration_s} />
              <Legend walks={(streams.walks || []).length} />
            </>
          )}
          {a.over_ceiling_min != null && (
            <p className="text-xs tabular-nums mt-1.5">
              <span className={a.over_ceiling_min > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                {a.over_ceiling_min > 0 ? `${a.over_ceiling_min} min over ${ceiling}` : `Nothing over ${ceiling}`}
              </span>
              {strides > 0 && a.over_ceiling_min > 0 && (
                <span className="text-neutral-400"> · the {strides} strides account for ~2–3 min of it</span>
              )}
            </p>
          )}
          <div className="mt-3">
            <Zones times={a.hr_zone_times} />
          </div>
        </Section>
      )}

      {!swim && streams?.splits?.length > 0 && (
        <RunSplits splits={streams.splits} ceiling={ceiling} walked={(streams.walks || []).length > 0} />
      )}
      {swim && streams?.splits?.length > 0 && <SwimSplits splits={streams.splits} />}

      {running && <Strides efforts={efforts} />}
      {running && <Aerobic summary={summary} activity={a} firstSplitHr={streams?.splits?.[0]?.avg_hr ?? null} />}
    </Page>
  );
}
