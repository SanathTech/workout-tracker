"""Per-effort summaries from intervals.icu per-second streams.

Why this exists: every summary average over a mixed session describes the blend, not
the work. A run/walk session's whole-file cadence produced a false overstriding alarm
(139spm was the walking, not the running); its stride length under-read the strides by
a third; its average HR flattered the discipline question. The fix is per-effort
numbers, computed once at sync time and stored compactly — the streams themselves
(couple of thousand points per activity) are fetched, summarised and discarded.

Samples are NOT uniform 1Hz — smart recording gaps them up to ~10s — so every average
here is time-weighted by the gap since the previous sample (capped, so a GPS dropout
cannot dominate a mean).
"""
import requests

# Faster than any walk, slower than his slowest easy running (walking tops out ~1.7m/s,
# easy running starts ~2.2). Samples below it are "not running".
RUN_MS = 2.0
# An effort: clearly faster than easy running (2.7 m/s = 6:10/km), sustained. The
# thresholds were tuned against the 25 Aug strides file until the count matched the six
# visible peaks in the raw chart — GPS smoothing eats short efforts at stricter values.
EFFORT_MS = 2.7
EFFORT_MIN_S = 6
EFFORT_MERGE_GAP_S = 3
# A swim pause: effectively stationary for a few seconds is a wall rest, not a turn.
SWIM_REST_MS = 0.2
SWIM_REST_MIN_S = 5
MAX_DT_S = 10


def fetch_streams(session, activity_id, key):
    resp = session.get(
        f"https://intervals.icu/api/v1/activity/{activity_id}/streams",
        params={"types": "time,velocity_smooth,cadence,heartrate"},
        auth=("API_KEY", key),
        headers={"User-Agent": "fitness-hub/1.0"},
        timeout=60,
    )
    if resp.status_code == 404:
        return None  # no recording (manual entry, some pool files)
    resp.raise_for_status()
    return {s["type"]: s["data"] for s in resp.json()}


def _series(streams):
    t = streams.get("time") or []
    v = streams.get("velocity_smooth") or []
    cad = streams.get("cadence") or []
    hr = streams.get("heartrate") or []
    pad = lambda arr: arr + [None] * (len(t) - len(arr))
    return t, pad(v), pad(cad), pad(hr)


def _dt(t, i):
    return min(t[i] - t[i - 1], MAX_DT_S) if i else 1


def _wavg(pairs):
    num = sum(val * w for val, w in pairs)
    den = sum(w for _, w in pairs)
    return num / den if den else None


def _pace_s_per_km(ms):
    return round(1000 / ms) if ms and ms > 0.3 else None


def summarize_run(streams):
    t, v, cad, hr = _series(streams)
    if len(t) < 30:
        return None

    run_v, run_c, run_h, total_w, run_w = [], [], [], 0, 0
    for i in range(len(t)):
        w = _dt(t, i)
        total_w += w
        vi = v[i] or 0
        if vi >= RUN_MS:
            run_w += w
            run_v.append((vi, w))
            if cad[i]:
                run_c.append((cad[i] * 2, w))  # per-leg → steps per minute
            if hr[i]:
                run_h.append((hr[i], w))

    out = {"kind": "run"}
    v_avg = _wavg(run_v)
    c_avg = _wavg(run_c)
    if v_avg:
        out["run_only"] = {
            "pace_s_per_km": _pace_s_per_km(v_avg),
            "cadence_spm": round(c_avg) if c_avg else None,
            "avg_hr": round(_wavg(run_h)) if run_h else None,
            # metres per step, from running samples only
            "stride_m": round(v_avg / (c_avg / 60), 2) if c_avg else None,
            "share": round(run_w / total_w, 2) if total_w else None,
        }

    # Efforts: sustained clearly-faster-than-easy segments (strides, surges).
    segs, cur = [], None
    for i in range(len(t)):
        if (v[i] or 0) > EFFORT_MS:
            cur = [i, i] if cur is None else [cur[0], i]
        elif cur and t[i] - t[cur[1]] > EFFORT_MERGE_GAP_S:
            segs.append(cur)
            cur = None
    if cur:
        segs.append(cur)

    efforts = []
    for a, b in segs:
        # Duration bridges the sampling gaps at the edges: smart recording can leave a
        # 10-15s hole exactly where a stride launches, and counting only the above-
        # threshold samples clipped a genuine full-length rep to "14s" (2026-09-01,
        # rep 6 — he called it, the raw tail proved it). Midpoint to the neighbouring
        # below-threshold sample is the honest estimate of where the effort really
        # started and ended.
        start = (t[a] + t[a - 1]) / 2 if a > 0 else t[a]
        end = (t[b] + t[b + 1]) / 2 if b + 1 < len(t) else t[b]
        dur = round(end - start)
        if dur < EFFORT_MIN_S:
            continue
        idx = range(a, b + 1)
        vs = [(v[i], _dt(t, i)) for i in idx if v[i]]
        cs = [(cad[i] * 2, _dt(t, i)) for i in idx if cad[i]]
        hs = [hr[i] for i in idx if hr[i]]
        ev, ec = _wavg(vs), _wavg(cs)
        efforts.append({
            "dur_s": dur,
            "peak_pace_s": _pace_s_per_km(max(val for val, _ in vs)) if vs else None,
            "avg_pace_s": _pace_s_per_km(ev),
            "cad_avg": round(ec) if ec else None,
            "cad_max": round(max(val for val, _ in cs)) if cs else None,
            "stride_m": round(ev / (ec / 60), 2) if ev and ec else None,
            "hr_max": max(hs) if hs else None,
        })
    if efforts:
        out["efforts"] = efforts

    # Aerobic decoupling (Pa:HR): how much more heart the second half of the run cost
    # per metre than the first. Efficiency = speed/HR over RUNNING samples only, with
    # detected effort (stride/surge) windows excluded — a stride set at the end of a
    # Tuesday run would otherwise read as the aerobic system failing. First half vs
    # second half by running time; positive = faded. ~8-10% is normal early base,
    # <5% is a built base — this is the number that shrinks as the engine grows.
    # Needs ≥25min of running and HR on both halves, else it is noise.
    in_effort = [False] * len(t)
    for a, b in segs:
        for i in range(a, min(b + 1, len(t))):
            in_effort[i] = True
    aero = [(v[i], hr[i], _dt(t, i)) for i in range(len(t))
            if (v[i] or 0) >= RUN_MS and hr[i] and not in_effort[i]]
    aero_time = sum(w for _, _, w in aero)
    if aero_time >= 25 * 60:
        halves, acc = [[], []], 0
        for vi, hi, w in aero:
            halves[0 if acc < aero_time / 2 else 1].append((vi / hi, w))
            acc += w
        ef1, ef2 = _wavg(halves[0]), _wavg(halves[1])
        if ef1 and ef2:
            out["decoupling_pct"] = round((ef1 / ef2 - 1) * 100, 1)

    # HRR: bpm shed in the minute after the session's HR peak. Only meaningful when the
    # recording continues ≥60s past the peak — a file that ends on the peak says nothing.
    hr_points = [(i, hr[i]) for i in range(len(t)) if hr[i]]
    if hr_points:
        peak_i, peak = max(hr_points, key=lambda p: p[1])
        window = [hr[i] for i in range(peak_i, len(t)) if hr[i] and 55 <= t[i] - t[peak_i] <= 75]
        if window:
            out["hrr_60"] = peak - min(window)

    return out if len(out) > 1 else None


def summarize_swim(streams):
    t, v, _cad, _hr = _series(streams)
    if len(t) < 30:
        return None

    move_v, rest_total, rest_count = [], 0, 0
    cur = None  # open rest [start_i, last_i]
    for i in range(len(t)):
        w = _dt(t, i)
        vi = v[i] or 0
        if vi <= SWIM_REST_MS:
            cur = [i, i] if cur is None else [cur[0], i]
        else:
            if cur:
                dur = t[cur[1]] - t[cur[0]]
                if dur >= SWIM_REST_MIN_S:
                    rest_total += dur
                    rest_count += 1
                cur = None
            move_v.append((vi, w))
    if cur:
        dur = t[cur[1]] - t[cur[0]]
        if dur >= SWIM_REST_MIN_S:
            rest_total += dur
            rest_count += 1

    v_avg = _wavg(move_v)
    if not v_avg:
        return None
    return {
        "kind": "swim",
        "moving": {
            "pace_s_per_100m": round(100 / v_avg),
            "share": round(sum(w for _, w in move_v) / (t[-1] - t[0]), 2) if t[-1] > t[0] else None,
        },
        "rest": {"total_s": int(rest_total), "count": rest_count},
    }


def summarize(activity_type, streams):
    if streams is None:
        return None
    if activity_type in ("Run", "VirtualRun"):
        return summarize_run(streams)
    if activity_type == "Swim":
        return summarize_swim(streams)
    return None
