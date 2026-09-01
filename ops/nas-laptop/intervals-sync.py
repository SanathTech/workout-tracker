#!/usr/bin/env python3
"""Sync intervals.icu activities + daily training load into the fitness hub (Neon).

Incremental by default: re-fetches a trailing window, because intervals.icu revises
the CTL/ATL model for past days when a late activity lands. --backfill pulls the lot.

Config comes from /srv/fitness/fitness.env (DATABASE_URL, INTERVALS_API_KEY).
"""
import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

import requests
import psycopg2
from psycopg2.extras import execute_batch

BASE = "https://intervals.icu/api/v1/athlete/0"
ENV_FILE = "/srv/fitness/fitness.env"
NTFY_FILE = "/srv/fitness/ntfy.url"
# Garmin history in intervals.icu starts 2025-12-03 (wellness) / 2025-12-27 (activities).
BACKFILL_START = date(2025, 11, 1)
INCREMENTAL_DAYS = 45


def load_env():
    with open(ENV_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v.strip().strip('"'))


def notify(title, message, priority="default", tags="warning"):
    try:
        with open(NTFY_FILE) as fh:
            url = fh.read().strip()
    except OSError:
        return
    try:
        requests.post(
            url,
            data=message.encode(),
            headers={"Title": title, "Priority": priority, "Tags": tags},
            timeout=15,
        )
    except requests.RequestException:
        pass


def connect():
    """Neon idles its compute; the first connection after a quiet spell can time out."""
    last = None
    for attempt in range(3):
        try:
            return psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=20)
        except psycopg2.OperationalError as err:
            last = err
            time.sleep(3 * (attempt + 1))
    raise last


def fetch(path, oldest, newest, key):
    resp = requests.get(
        f"{BASE}/{path}",
        params={"oldest": oldest.isoformat(), "newest": newest.isoformat()},
        auth=("API_KEY", key),
        timeout=90,
    )
    resp.raise_for_status()
    return resp.json()


ACTIVITY_SQL = """
INSERT INTO activities (
  id, start_date_local, date, type, name, moving_time, elapsed_time, distance,
  average_hr, max_hr, calories, pace, training_load, hr_load, trimp, intensity,
  ctl, atl, hr_zone_times, pool_length, lap_count, average_stride, raw, synced_at
) VALUES (
  %(id)s, %(start)s, %(date)s, %(type)s, %(name)s, %(moving_time)s, %(elapsed_time)s,
  %(distance)s, %(average_hr)s, %(max_hr)s, %(calories)s, %(pace)s, %(training_load)s,
  %(hr_load)s, %(trimp)s, %(intensity)s, %(ctl)s, %(atl)s, %(hr_zone_times)s,
  %(pool_length)s, %(lap_count)s, %(average_stride)s, %(raw)s, NOW()
)
ON CONFLICT (id) DO UPDATE SET
  start_date_local = EXCLUDED.start_date_local, date = EXCLUDED.date,
  type = EXCLUDED.type, name = EXCLUDED.name, moving_time = EXCLUDED.moving_time,
  elapsed_time = EXCLUDED.elapsed_time, distance = EXCLUDED.distance,
  average_hr = EXCLUDED.average_hr, max_hr = EXCLUDED.max_hr,
  calories = EXCLUDED.calories, pace = EXCLUDED.pace,
  training_load = EXCLUDED.training_load, hr_load = EXCLUDED.hr_load,
  trimp = EXCLUDED.trimp, intensity = EXCLUDED.intensity,
  ctl = EXCLUDED.ctl, atl = EXCLUDED.atl, hr_zone_times = EXCLUDED.hr_zone_times,
  pool_length = EXCLUDED.pool_length, lap_count = EXCLUDED.lap_count,
  average_stride = EXCLUDED.average_stride, raw = EXCLUDED.raw, synced_at = NOW()
"""

WELLNESS_SQL = """
INSERT INTO training_load (
  date, ctl, atl, ctl_load, atl_load, ramp_rate, resting_hr, sleep_secs,
  spo2, steps, weight_kg, raw, synced_at
) VALUES (
  %(date)s, %(ctl)s, %(atl)s, %(ctl_load)s, %(atl_load)s, %(ramp_rate)s,
  %(resting_hr)s, %(sleep_secs)s, %(spo2)s, %(steps)s, %(weight_kg)s, %(raw)s, NOW()
)
ON CONFLICT (date) DO UPDATE SET
  ctl = EXCLUDED.ctl, atl = EXCLUDED.atl, ctl_load = EXCLUDED.ctl_load,
  atl_load = EXCLUDED.atl_load, ramp_rate = EXCLUDED.ramp_rate,
  resting_hr = EXCLUDED.resting_hr, sleep_secs = EXCLUDED.sleep_secs,
  spo2 = EXCLUDED.spo2, steps = EXCLUDED.steps, weight_kg = EXCLUDED.weight_kg,
  raw = EXCLUDED.raw, synced_at = NOW()
"""


def as_int(value):
    return None if value is None else int(round(float(value)))


def activity_row(a):
    start = a.get("start_date_local")
    return {
        "id": str(a["id"]),
        "start": start,
        "date": start[:10] if start else None,
        "type": a.get("type") or "Unknown",
        "name": a.get("name"),
        "moving_time": a.get("moving_time"),
        "elapsed_time": a.get("elapsed_time"),
        "distance": a.get("distance"),
        "average_hr": as_int(a.get("average_heartrate")),
        "max_hr": as_int(a.get("max_heartrate")),
        "calories": as_int(a.get("calories")),
        "pace": a.get("pace"),
        "training_load": a.get("icu_training_load"),
        "hr_load": a.get("hr_load"),
        "trimp": a.get("trimp"),
        "intensity": a.get("icu_intensity"),
        "ctl": a.get("icu_ctl"),
        "atl": a.get("icu_atl"),
        "hr_zone_times": a.get("icu_hr_zone_times"),
        "pool_length": a.get("pool_length"),
        "lap_count": a.get("icu_lap_count"),
        "average_stride": a.get("average_stride"),
        "raw": json.dumps(a),
    }


def wellness_row(w):
    return {
        "date": w["id"],
        "ctl": w.get("ctl"),
        "atl": w.get("atl"),
        "ctl_load": w.get("ctlLoad"),
        "atl_load": w.get("atlLoad"),
        "ramp_rate": w.get("rampRate"),
        "resting_hr": as_int(w.get("restingHR")),
        "sleep_secs": as_int(w.get("sleepSecs")),
        "spo2": w.get("spO2"),
        "steps": as_int(w.get("steps")),
        "weight_kg": w.get("weight"),
        "raw": json.dumps(w),
    }


def record_sync(cur, source, ok, rows, error, detail):
    cur.execute(
        """
        INSERT INTO sync_state (source, last_success, last_attempt, last_error, rows_written, detail)
        VALUES (%s, CASE WHEN %s THEN NOW() END, NOW(), %s, %s, %s)
        ON CONFLICT (source) DO UPDATE SET
          last_success = COALESCE(EXCLUDED.last_success, sync_state.last_success),
          last_attempt = EXCLUDED.last_attempt,
          last_error   = EXCLUDED.last_error,
          rows_written = EXCLUDED.rows_written,
          detail       = EXCLUDED.detail
        """,
        (source, ok, error, rows, json.dumps(detail)),
    )


def stream_pass(conn, key, limit=12):
    """Fill stream_summary for runs/swims that lack it, newest first.

    Capped per invocation: the 3-hourly timer backfills history a slice at a time
    without hammering the API; steady state is one or two new activities a day.
    Activities whose streams yield nothing usable are stamped {"kind": "none"} so
    they are not refetched forever.
    """
    import streams as stream_mod

    session = requests.Session()
    done = failed = 0
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, type FROM activities
                WHERE type IN ('Run', 'VirtualRun', 'Swim') AND stream_summary IS NULL
                ORDER BY date DESC LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall()
    for act_id, act_type in rows:
        try:
            data = stream_mod.fetch_streams(session, act_id, key)
            summary = stream_mod.summarize(act_type, data)
        except requests.RequestException:
            failed += 1
            continue
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE activities SET stream_summary = %s WHERE id = %s",
                (json.dumps(summary if summary is not None else {"kind": "none"}), act_id),
            )
        done += 1
        time.sleep(1)  # politeness between stream fetches
    return done, failed, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="pull all history")
    ap.add_argument("--since", help="YYYY-MM-DD window start")
    ap.add_argument("--quiet", action="store_true", help="no ntfy on success or failure")
    args = ap.parse_args()

    load_env()
    key = os.environ["INTERVALS_API_KEY"]

    newest = date.today() + timedelta(days=1)
    if args.backfill:
        oldest = BACKFILL_START
    elif args.since:
        oldest = datetime.strptime(args.since, "%Y-%m-%d").date()
    else:
        oldest = date.today() - timedelta(days=INCREMENTAL_DAYS)

    print(f"window {oldest} → {newest}")

    try:
        activities = fetch("activities", oldest, newest, key)
        wellness = fetch("wellness", oldest, newest, key)
    except requests.RequestException as err:
        print(f"intervals.icu fetch failed: {err}", file=sys.stderr)
        if not args.quiet:
            notify("Fitness sync FAILED", f"intervals.icu unreachable: {err}", "high")
        return 1

    conn = connect()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            execute_batch(cur, ACTIVITY_SQL, [activity_row(a) for a in activities], page_size=100)
            execute_batch(cur, WELLNESS_SQL, [wellness_row(w) for w in wellness], page_size=200)
            detail = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
            record_sync(cur, "intervals_activities", True, len(activities), None, detail)
            record_sync(cur, "intervals_wellness", True, len(wellness), None, detail)
        conn.commit()
    except Exception as err:  # noqa: BLE001 — any failure must land in sync_state + ntfy
        conn.rollback()
        print(f"write failed: {err}", file=sys.stderr)
        try:
            with conn.cursor() as cur:
                record_sync(cur, "intervals_activities", False, 0, str(err)[:500], {})
            conn.commit()
        except Exception:
            pass
        if not args.quiet:
            notify("Fitness sync FAILED", f"DB write: {err}", "high")
        return 1
    finally:
        conn.close()

    # Streams ride behind the main sync on their own connection: a stream failure
    # must never mark the activity/wellness sync failed, and vice versa.
    try:
        sconn = connect()
        sconn.autocommit = True
        s_done, s_failed, s_seen = stream_pass(sconn, key)
        with sconn.cursor() as cur:
            record_sync(cur, "intervals_streams", s_failed == 0, s_done,
                        f"{s_failed} fetches failed" if s_failed else None,
                        {"candidates": s_seen})
        sconn.close()
        print(f"stream summaries: {s_done} written, {s_failed} failed, {s_seen} candidates")
    except Exception as err:  # noqa: BLE001 — never let streams sink the sync
        print(f"stream pass failed: {err}", file=sys.stderr)

    print(f"activities upserted: {len(activities)}")
    print(f"wellness days upserted: {len(wellness)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001
        # A crash before the handled paths (missing env, bad key) would otherwise be
        # silent — the timer's only observer is ntfy.
        notify("Fitness sync CRASHED", f"{type(err).__name__}: {err}", "high")
        raise
