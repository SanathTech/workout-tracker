// Second-by-second streams for the activity page, fetched from intervals.icu when a run or
// swim is opened (2026-09-15 rethink, PR 2) rather than stored at sync time. intervals.icu
// already holds the corrected streams — the GPS distance recalibration and the phantom-
// length swim fix both write there — so fetching on demand shows every activity since
// June without a backfill, and a correction made later is picked up the next time the
// activity syncs (the cache is keyed to activities.synced_at).
//
// The shaping here is presentation only. The per-effort figures the coach reasons from
// (efforts, run_only, decoupling, hrr_60) stay in activities.stream_summary, computed once
// by streams.py on nas-laptop; this file must not grow a second, drifting copy of them.

// Same cuts as streams.py on nas-laptop. Faster than any walk, slower than his slowest
// easy running on the GPS-true scale; a swim sample this slow is a wall rest.
const RUN_MS = 1.75;
const WALK_MIN_S = 20;
const BUCKET_S = 15;
const TYPES = 'time,heartrate,velocity_smooth,distance,cadence';
const ID = /^[A-Za-z0-9_-]{1,32}$/;

async function fetchStreams(activityId, apiKey, fetchImpl = fetch) {
  if (!ID.test(activityId)) throw new Error('bad activity id');
  const auth = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
  const res = await fetchImpl(
    `https://intervals.icu/api/v1/activity/${activityId}/streams?types=${TYPES}`,
    { headers: { Authorization: `Basic ${auth}`, 'User-Agent': 'workout-tracker/1.0' }, signal: AbortSignal.timeout(15_000) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`intervals.icu ${res.status}`);
  const out = {};
  for (const s of await res.json()) out[s.type] = s.data;
  return out;
}

const avg = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Averaged into fixed buckets: a phone chart 300px wide has no use for 4,000 points, and
// the payload stays a few kB.
function buckets(t, hr, v) {
  const out = [];
  let start = 0;
  for (let b = 0; start < t.length; b += BUCKET_S) {
    const hs = [];
    const vs = [];
    while (start < t.length && t[start] < b + BUCKET_S) {
      hs.push(hr?.[start]);
      vs.push(v?.[start]);
      start += 1;
    }
    if (hs.length) {
      const h = avg(hs);
      const s = avg(vs);
      out.push([b, h == null ? null : Math.round(h), s == null ? null : Math.round(s * 100) / 100]);
    }
  }
  return out;
}

// Stretches under the running cut for at least WALK_MIN_S — the run/walk program's walk
// breaks and the recoveries between strides. Shorter dips are traffic lights and turns.
function walkSegments(t, v) {
  const segs = [];
  let from = null;
  for (let i = 0; i < t.length; i += 1) {
    const slow = (v[i] ?? 0) < RUN_MS;
    if (slow && from == null) from = t[i];
    if ((!slow || i === t.length - 1) && from != null) {
      const to = slow ? t[i] : t[i - 1];
      if (to - from >= WALK_MIN_S) segs.push([from, to]);
      from = null;
    }
  }
  return segs;
}

// Splits by distance crossing, so each row is a real kilometre (or 100 m in the pool).
// The tail is kept when it's at least a fifth of a split; below that its pace is noise.
function splitsBy(t, dist, hr, every) {
  const rows = [];
  let i0 = 0;
  let next = every;
  const push = (i1, partial) => {
    const m = dist[i1] - dist[i0];
    const dur = t[i1] - t[i0];
    const hs = hr ? hr.slice(i0, i1 + 1).filter((x) => x) : [];
    rows.push({
      at_m: Math.round(dist[i1]),
      dist_m: Math.round(m),
      dur_s: dur,
      pace_s: m > 0 ? Math.round(dur / (m / every)) : null,
      avg_hr: hs.length ? Math.round(avg(hs)) : null,
      max_hr: hs.length ? Math.max(...hs) : null,
      partial,
    });
    i0 = i1;
  };
  for (let i = 0; i < t.length; i += 1) {
    if (dist[i] == null) continue;
    if (dist[i] >= next) {
      push(i, false);
      next += every;
    }
  }
  const last = t.length - 1;
  if (last > i0 && dist[last] - dist[i0] >= every / 5) push(last, true);
  return rows;
}

function shape(type, s) {
  const t = s?.time;
  if (!t || t.length < 30) return null;
  const hr = s.heartrate || null;
  const v = s.velocity_smooth || [];
  const dist = s.distance || null;

  // Wall rest totals already live in stream_summary; the page only needs the splits. HR is
  // left out on purpose — wrist HR in the pool read 103 and 141 on two identical kms.
  if (type === 'Swim') {
    return {
      kind: 'swim',
      duration_s: t[t.length - 1],
      splits: dist ? splitsBy(t, dist, null, 100) : [],
      series: buckets(t, null, v).map(([b, , sp]) => [b, null, sp]),
    };
  }

  const running = type === 'Run' || type === 'VirtualRun';
  return {
    kind: running ? 'run' : 'other',
    duration_s: t[t.length - 1],
    series: buckets(t, hr, v),
    walks: running ? walkSegments(t, v) : [],
    splits: dist ? splitsBy(t, dist, hr, 1000) : [],
  };
}

module.exports = { fetchStreams, shape, RUN_MS };
