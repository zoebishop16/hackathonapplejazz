"""Read every dataset in data/ and write the JSON the dashboard reads.

Run from the repo root:  python3 app/build.py
Writes app/site/data/<scenario>__<seed>.json and app/site/data/index.json.
All statistics come from app/qc.py; this file only reads, groups and calls.
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import qc  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "app", "site", "data")
FMT = "%Y-%m-%d %H:%M"
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
STALE_MIN = 15          # a feed older than this is stale
EARTH_KM = 6371.0
SNAPSHOTS = [           # "now" for the live pages: week 3
    ("Wed 08:15 (morning rush)", "2026-09-23 08:15"),
    ("Wed 12:00 (midday)", "2026-09-23 12:00"),
    ("Wed 17:30 (evening rush)", "2026-09-23 17:30"),
    ("Sat 13:00 (weekend)", "2026-09-26 13:00"),
]
OOS = ("offline", "broken_kiosk", "blocked", "maintenance")
FAILURE_FAULTS = ("dock_fault", "offline", "broken_kiosk", "silent_feed")  # unplanned
HORIZONS = (30, 60, 90, 120)  # forecast horizons, minutes ahead


def t(s):
    return datetime.strptime(s, FMT)


def r(x, nd=2):
    return None if x is None else round(x, nd)


def read(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def load(folder):
    stations = read(os.path.join(folder, "stations.csv"))
    for s in stations:
        s["total_docks"] = int(s["total_docks"])
        s["lat"], s["lon"] = float(s["lat"]), float(s["lon"])
    polls = defaultdict(list)
    for row in read(os.path.join(folder, "status.csv")):
        p = {"time": t(row["timestamp"]), "ba": int(row["num_bikes_available"]),
             "bd": int(row["num_bikes_disabled"]), "da": int(row["num_docks_available"]),
             "dd": int(row["num_docks_disabled"]), "status": row["status"],
             "last": t(row["last_reported"])}
        p["eff"] = p["ba"] + p["bd"] + p["da"]
        p["age"] = (p["time"] - p["last"]).total_seconds() / 60
        p["active"] = p["status"] == "active"
        polls[row["station_id"]].append(p)
    faults = read(os.path.join(folder, "dock_faults.csv"))
    for f in faults:
        f["start"], f["end"] = t(f["start"]), t(f["end"])
    orders = read(os.path.join(folder, "work_orders.csv"))
    for o in orders:
        for k in ("opened_at", "assigned_at", "arrived_at", "resolved_at"):
            o[k] = t(o[k])
        o["response_min"] = float(o["response_min"])
        o["repair_min"] = float(o["repair_min"])
        o["bikes_moved"] = int(o["bikes_moved"])
    vans = read(os.path.join(folder, "vans.csv"))
    return stations, polls, faults, orders, vans


def scheduled(o):
    """Planned overnight rebalancing runs (not a response to a call)."""
    return o["fault"].startswith("overnight")


def fill_frac(p):
    """Fill as a fraction (0-1) for history; None when not usable."""
    pct = qc.fill_pct(p["ba"] + p["bd"], p["eff"]) if p["active"] else None
    return None if pct is None else pct / 100


def problems(p):
    out = []
    if not p["active"]:
        out.append(p["status"])
    if p["age"] > STALE_MIN:
        out.append("stale_feed")
    if p["active"] and p["ba"] == 0:
        out.append("no_bikes")
    if p["active"] and p["da"] == 0:
        out.append("no_docks")
    if p["dd"] > 0:
        out.append("broken_docks")
    if p["bd"] > 0:
        out.append("broken_bikes")
    return out


def dist(a, b):
    """Great-circle (haversine) distance in km between two points with lat/lon."""
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def order_json(o):
    return {"id": o["order_id"], "station": o["station_id"], "type": o["order_type"],
            "fault": o["fault"], "opened": o["opened_at"].strftime(FMT),
            "assigned": o["assigned_at"].strftime(FMT), "arrived": o["arrived_at"].strftime(FMT),
            "resolved": o["resolved_at"].strftime(FMT), "response_min": o["response_min"],
            "repair_min": o["repair_min"], "van": o["van_id"], "bikes_moved": o["bikes_moved"],
            "restore_min": r((o["resolved_at"] - o["opened_at"]).total_seconds() / 60, 1)}


def hist_fill(polls, now, minutes_ahead, window=2):
    """Average fill at the same weekday and time of day (+/- window polls) in earlier weeks."""
    vals = []
    for weeks_back in (1, 2, 3):
        centre = now + timedelta(minutes=minutes_ahead) - timedelta(weeks=weeks_back)
        for k in range(-window, window + 1):
            ts = centre + timedelta(minutes=5 * k)
            idx = int((ts - polls[0]["time"]).total_seconds() // 300)
            if 0 <= idx < len(polls) and polls[idx]["time"] < now:
                f = fill_frac(polls[idx])
                if f is not None:
                    vals.append(f)
    return qc.mean(vals) if vals else None


STATUS_TEXT = {"offline": "Offline", "broken_kiosk": "Broken kiosk", "blocked": "Blocked",
               "maintenance": "Under maintenance"}


def hist_unusable(polls, now, minutes_ahead=120):
    """Unusable flags for every poll in the next `minutes_ahead` minutes at the same
    weekday and time in earlier weeks (only polls before `now`)."""
    flags = []
    for weeks_back in (1, 2, 3):
        start = now - timedelta(weeks=weeks_back)
        for k in range(1, minutes_ahead // 5 + 1):
            ts = start + timedelta(minutes=5 * k)
            j = int((ts - polls[0]["time"]).total_seconds() // 300)
            if 0 <= j < len(polls) and polls[j]["time"] < now:
                q = polls[j]
                flags.append((not q["active"]) or q["ba"] == 0 or q["da"] == 0)
    return flags


def snapshot(now, stations, polls, faults, orders, vans):
    byid = {s["station_id"]: s for s in stations}
    t0 = polls[stations[0]["station_id"]][0]["time"]
    idx = int((now - t0).total_seconds() // 300)
    rows, docks, fc = [], {}, []
    for s in stations:
        sid = s["station_id"]
        p = polls[sid][idx]
        bikes = p["ba"] + p["bd"]
        cat = qc.fill_category(bikes, p["eff"]) if p["active"] else None
        rows.append({"id": sid, "bikes_available": p["ba"], "bikes_disabled": p["bd"],
                     "docks_available": p["da"], "docks_disabled": p["dd"], "status": p["status"],
                     "eff": p["eff"], "fill_pct": r(qc.fill_pct(bikes, p["eff"]), 1),
                     "category": cat if p["active"] else "out_of_service",
                     "last_reported": p["last"].strftime(FMT), "feed_age_min": p["age"],
                     "misleading": qc.misleading_flag(p["ba"], p["bd"], p["da"], p["dd"]),
                     "problems": problems(p)})
        # per-dock grid: broken docks from the fault log, bikes fill working docks in order
        broken = {}
        for f in faults:
            if f["station_id"] == sid and f["start"] <= now < f["end"]:
                broken[int(f["dock_id"].split("-D")[1])] = f["state"]
        grid, placed_b, placed_d = [], 0, 0
        for d in range(1, s["total_docks"] + 1):
            if d in broken:
                grid.append(broken[d])
            elif placed_d < p["bd"]:
                grid.append("bike_disabled"); placed_d += 1
            elif placed_b < p["ba"]:
                grid.append("bike"); placed_b += 1
            else:
                grid.append("open")
        docks[sid] = {"grid": grid, "fault_log_broken": len(broken),
                      "feed_broken": p["dd"], "mismatch": len(broken) != p["dd"]}
        # forecast from historical averages at this weekday and time
        if p["active"] and p["eff"] > 0:
            h0 = hist_fill(polls[sid], now, 0)
            item = {"id": sid, "bikes": bikes, "eff": p["eff"], "hist_now": r(h0, 3)}
            for m in HORIZONS:
                hm = hist_fill(polls[sid], now, m)
                proj, risk = qc.forecast_bikes(bikes, p["eff"], h0, hm) if h0 is not None and hm is not None else (None, None)
                later = polls[sid][idx + m // 5] if idx + m // 5 < len(polls[sid]) else None
                actual = None
                if later is not None:
                    actual = ("empty" if later["active"] and later["ba"] == 0 else
                              "full" if later["active"] and later["da"] == 0 else "ok")
                item.update({f"p{m}": r(proj, 1), f"risk{m}": risk, f"hist{m}": r(hm, 3),
                             f"actual{m}": actual})
            now_risk = "empty" if p["ba"] == 0 else "full" if p["da"] == 0 else None
            item["risk_now"] = now_risk
            # urgency: 5 = empty/full now, 4 = within 30 min, 3 = 1 h, 2 = 1.5 h, 1 = 2 h, 0 = no risk
            first = next((m for m in HORIZONS if item[f"risk{m}"]), None)
            if now_risk:
                item["urgency"], item["minutes_to_hit"] = 5, 0
            elif first is not None:
                item["urgency"], item["minutes_to_hit"] = len(HORIZONS) - HORIZONS.index(first), first
            else:
                item["urgency"], item["minutes_to_hit"] = 0, None
            item["priority"] = ("high" if item["urgency"] >= 4 else "medium" if item["urgency"] >= 2
                                else "low" if item["urgency"] == 1 else "none")
            # expected impact: bikes the average flow moves in or out by the time it hits (or in 2 h)
            hh = item[f"hist{first or HORIZONS[-1]}"]
            item["impact_bikes"] = r(abs((hh - h0) * p["eff"]), 1) if h0 is not None and hh is not None else 0
            item["risk"] = now_risk or (item[f"risk{first}"] if first else None)
            fc.append(item)
    # stations at risk: the forecast list plus out-of-service stations, each with
    # its issues and a risk %, ranked once (qc.rank_at_risk) for Overview and Dispatch
    rows_by_id = {row["id"]: row for row in rows}
    have = {i["id"] for i in fc}
    for st in stations:
        sid = st["station_id"]
        if sid not in have:  # out of service (or every dock broken): unusable now
            p = polls[sid][idx]
            item = {"id": sid, "bikes": p["ba"] + p["bd"], "eff": p["eff"], "hist_now": None,
                    "risk_now": "out_of_service", "risk": "out_of_service", "urgency": 5, "minutes_to_hit": 0,
                    "impact_bikes": float(st["total_docks"])}
            for m in HORIZONS:
                item.update({f"p{m}": None, f"risk{m}": None, f"hist{m}": None, f"actual{m}": None})
            fc.append(item)
    for i in fc:
        row, st = rows_by_id[i["id"]], byid[i["id"]]
        i["status"], i["docks_disabled"], i["total_docks"] = row["status"], row["docks_disabled"], st["total_docks"]
        issues = []
        if row["status"] != "active":
            issues.append(STATUS_TEXT[row["status"]])
        elif i["risk_now"]:
            issues.append(f"{i['risk_now'].capitalize()} now")
        elif i["risk"]:
            issues.append(f"Will be {i['risk']}")
        if row["docks_disabled"]:
            issues.append(f"{row['docks_disabled']} broken dock{'s' if row['docks_disabled'] > 1 else ''}")
            if i["urgency"] == 0:  # usable, but broken docks need a repair: medium if a quarter or more are broken
                i["urgency"] = 3 if row["docks_disabled"] >= 0.25 * st["total_docks"] else 1
                i["minutes_to_hit"] = 0
        i["issues"] = issues
        i["priority"] = ("high" if i["urgency"] >= 4 else "medium" if i["urgency"] >= 2
                         else "low" if i["urgency"] == 1 else "none")
        unusable_now = row["status"] != "active" or i["risk_now"] is not None
        i["risk_pct"] = 100.0 if unusable_now else r(qc.risk_pct(hist_unusable(polls[i["id"]], now)), 1)
    qc.rank_at_risk(fc)

    # recommended moves: surplus (projected +60 min) to nearest deficit
    surplus, deficit = {}, {}
    for i in fc:
        if i["status"] != "active":
            continue
        target = round(0.5 * i["eff"])
        ahead = i["p60"] if i["p60"] is not None else i["bikes"]
        if i["risk"] == "full" or ahead > 0.8 * i["eff"]:
            surplus[i["id"]] = max(0, min(i["bikes"], round(ahead)) - target)
        if i["risk"] == "empty" or ahead < 0.2 * i["eff"]:
            deficit[i["id"]] = max(0, target - round(ahead))
    moves = []
    for i in fc:
        need = deficit.get(i["id"], 0)
        while need > 0:
            donors = [d for d, v in surplus.items() if v > 0]
            if not donors:
                break
            d = min(donors, key=lambda k: dist(byid[k], byid[i["id"]]))
            q = min(need, surplus[d], 16)
            moves.append({"from": d, "to": i["id"], "bikes": q,
                          "km": r(dist(byid[d], byid[i["id"]]), 2),
                          "reason": f"{d} projected full/high, {i['id']} projected {i['risk'] or 'low'}"})
            surplus[d] -= q
            need -= q

    active = [o for o in orders if o["opened_at"] <= now < o["resolved_at"]]
    done = [o for o in orders if o["resolved_at"] <= now]
    van_rows = []
    for v in vans:
        mine = sorted((o for o in active if o["van_id"] == v["van_id"]), key=lambda o: o["assigned_at"])
        cur = next((o for o in mine if o["assigned_at"] <= now), None)
        if cur is None:
            st, where, load = "idle", "depot", 0
        else:
            st = "en route" if now < cur["arrived_at"] else "on site"
            where = cur["station_id"]
            load = cur["bikes_moved"] if (cur["fault"] == "stockout") == (st == "en route") and cur["order_type"] == "rebalance" else 0
        van_rows.append({"van": v["van_id"], "name": v["name"], "capacity": int(v["capacity"]),
                         "status": st, "station": where, "load": load,
                         "lat": byid[where]["lat"] if where in byid else float(v["depot_lat"]),
                         "lon": byid[where]["lon"] if where in byid else float(v["depot_lon"]),
                         "queue": [o["order_id"] for o in mine]})

    def resolution(kind):
        xs = [(o["resolved_at"] - o["opened_at"]).total_seconds() / 60 for o in done
              if o["order_type"] == kind and not scheduled(o)]
        return {"n": len(xs), "mean_min": r(qc.mean(xs), 1) if xs else None,
                "median_min": r(sorted(xs)[len(xs) // 2], 1) if xs else None}

    repairs_done = [o for o in done if o["order_type"] == "repair" and o["fault"] in FAILURE_FAULTS]
    restore = [(o["resolved_at"] - o["opened_at"]).total_seconds() / 60 for o in repairs_done]
    counts = defaultdict(int)
    for o in orders:
        if o["order_type"] == "repair" and o["opened_at"] <= now and o["fault"] in FAILURE_FAULTS:
            counts[o["station_id"]] += 1
    all_counts = {st["station_id"]: counts.get(st["station_id"], 0) for st in stations}
    threshold = qc.repeat_offender_threshold(all_counts.values())
    offenders = sorted(({"station": k, "repairs": v} for k, v in all_counts.items() if v >= threshold),
                       key=lambda d: -d["repairs"])
    backlog = [o for o in active if o["order_type"] == "repair"]
    summary = qc.network_summary([{**row, "total_docks": byid[row["id"]]["total_docks"]} for row in rows])
    summary["docks_available_pct"] = r(summary["docks_available_pct"], 1)
    return {"time": now.strftime(FMT), "summary": summary, "stations": rows, "docks": docks, "forecast": fc,
            "moves": moves,
            "tasks": {"repair": [o["order_id"] for o in active if o["order_type"] == "repair"],
                      "rebalance": [o["order_id"] for o in active if o["order_type"] == "rebalance"]},
            "vans": van_rows,
            "resolution": {"repair": resolution("repair"), "rebalance": resolution("rebalance")},
            "maintenance": {"mttr_min": r(qc.mean(restore), 1) if restore else None,
                            "mttr_n": len(restore), "backlog": len(backlog),
                            "backlog_unassigned": sum(1 for o in backlog if o["assigned_at"] > now),
                            "repeat_offenders": offenders, "repeat_threshold": threshold,
                            "repair_counts": all_counts}}


def heatmap(stations, polls):
    """Per station, per hour of week (Mon 00 .. Sun 23): poll counts for the heatmap."""
    out = {}
    for s in stations:
        cells = [[0, 0.0, 0, 0, 0, 0] for _ in range(168)]  # n, fill_sum, empty, full, unusable, active_n
        for p in polls[s["station_id"]]:
            c = cells[p["time"].weekday() * 24 + p["time"].hour]
            c[0] += 1
            f = fill_frac(p)
            if f is not None:
                c[1] += f
                c[2] += p["ba"] == 0
                c[3] += p["da"] == 0
                c[5] += 1
            c[4] += (not p["active"]) or p["ba"] == 0 or p["da"] == 0
        out[s["station_id"]] = {"n": [c[0] for c in cells], "fill_sum": [r(c[1], 3) for c in cells],
                                "empty": [c[2] for c in cells], "full": [c[3] for c in cells],
                                "unusable": [c[4] for c in cells], "active_n": [c[5] for c in cells]}
    return out


BLOCK_HOURS = 1  # control-chart subgroup: hourly blocks 00:01-01:00, 01:01-02:00, ... 23:01-24:00 (24 per day)


def block_open_pct(polls):
    """{(day, block): [% open docks at each active poll]} for one station.

    Block b of a day covers the polls after b:00 up to and including
    (b+1):00, so 01:00 belongs to 00:01-01:00, 08:00 to 07:01-08:00, and
    midnight closes the previous day's 23:01-24:00 block.
    """
    acc = defaultdict(list)
    t0 = polls[0]["time"]
    for p in polls:
        if p["active"] and p["eff"] > 0:
            t = p["time"] - timedelta(minutes=1)
            day = (t - t0).days
            if day < 0:  # 00:00 on the first day closes a block before the data starts
                continue
            acc[(day, t.hour // BLOCK_HOURS)].append(100 * p["da"] / p["eff"])
    return acc


def xbar_series(stations, polls):
    """X-bar chart of % docks open, one subgroup per hourly block (24 a day, 504 in all).

    Each observation is one station's % open docks at one 5-minute poll in that
    block, so a block holds up to 12 x (stations in scope) values. Limits use
    the most common subgroup size for every point (flat limits).
    """
    per = {s["station_id"]: block_open_pct(polls[s["station_id"]]) for s in stations}
    t0 = polls[stations[0]["station_id"]][0]["time"]
    days = len(polls[stations[0]["station_id"]]) * 5 // 1440
    blocks = 24 // BLOCK_HOURS
    scopes = {"network": [s["station_id"] for s in stations]}
    for d in sorted({s["district"] for s in stations}):
        scopes[f"district:{d}"] = [s["station_id"] for s in stations if s["district"] == d]
    for s in stations:
        scopes[s["station_id"]] = [s["station_id"]]
    out = {}
    for name, ids in scopes.items():
        groups = []
        for day in range(days):
            date = t0 + timedelta(days=day)
            for b in range(blocks):
                vals = [v for i in ids for v in per[i].get((day, b), [])]
                h0, h1 = b * BLOCK_HOURS, (b + 1) * BLOCK_HOURS
                groups.append((f"{DOW[date.weekday()]} {date.strftime('%m-%d')} {h0:02d}:01-{h1:02d}:00", vals))
        res = qc.xbar_chart(groups, constant_limits=True)
        out[name] = {"grand_mean": r(res["grand_mean"]), "sigma_short": r(res["sigma_short"]),
                     "n_limits": res["n_limits"], "message": res["message"], "subgroup": "hourly block",
                     "points": [{"label": p["label"], "n": p["n"], "mean": r(p["mean"]),
                                 "ucl": r(p["ucl"]), "lcl": r(p["lcl"]), "out": p["out"]}
                                for p in res["points"]]}
    return out


def pchart(stations, polls):
    n_polls = len(polls[stations[0]["station_id"]])
    per_poll = []
    for i in range(n_polls):
        ps = [polls[s["station_id"]][i] for s in stations]
        bad = sum(1 for p in ps if (not p["active"]) or p["ba"] == 0 or p["da"] == 0)
        per_poll.append((ps[0]["time"], bad, len(ps)))
    out = {}
    for name, keep in (("all_day", lambda tm: True), ("off_peak", lambda tm: 10 <= tm.hour < 15)):
        base = [(x, n) for tm, x, n in per_poll if tm.weekday() == 1 and keep(tm)]
        mon = [(x, n) for tm, x, n in per_poll if tm.weekday() == 3 and keep(tm)]
        times = [tm.strftime(FMT) for tm, x, n in per_poll if tm.weekday() == 1 and keep(tm)] + \
                [tm.strftime(FMT) for tm, x, n in per_poll if tm.weekday() == 3 and keep(tm)]
        res = qc.p_chart(base, mon, constant_limits=True)
        out[name] = {"pbar": r(res["pbar"], 4), "message": res["message"], "n": len(stations), "n_limits": res["n_limits"],
                     "np_bar": r(res["pbar"] * len(stations), 2),
                     "points": [{"t": tm, "p": r(p["p"], 4), "ucl": r(p["ucl"], 4), "lcl": r(p["lcl"], 4),
                                 "phase": p["phase"], "out": p["out"]} for tm, p in zip(times, res["points"])],
                     "out_baseline": sum(p["out"] for p in res["points"] if p["phase"] == "baseline"),
                     "out_monitor": sum(p["out"] for p in res["points"] if p["phase"] == "monitor")}
    return out


def fmea(stations, polls, orders):
    allp = [p for s in stations for p in polls[s["station_id"]]]
    act = [p for p in allp if p["active"]]
    called = [o for o in orders if not scheduled(o)]  # dispatch calls, not planned overnight runs
    slow = sum(1 for o in called if o["response_min"] > 30)
    modes = [
        ("Station empty", "0 rentable bikes", 7, 3, sum(p["ba"] == 0 for p in act), len(act), "active polls with 0 bikes"),
        ("Station full", "0 open docks", 7, 3, sum(p["da"] == 0 for p in act), len(act), "active polls with 0 open docks"),
        ("Docks disabled", "num_docks_disabled > 0", 5, 4, sum(p["dd"] > 0 for p in allp), len(allp), "polls with a broken dock"),
        ("Silent feed", "stale reading looks healthy", 6, 9, sum(p["age"] > STALE_MIN for p in allp), len(allp), f"polls with feed older than {STALE_MIN} min"),
        ("Kiosk offline", "offline or broken kiosk", 8, 2, sum(p["status"] in ("offline", "broken_kiosk") for p in allp), len(allp), "polls offline or broken kiosk"),
        ("Slow van response", "response over 30 min", 6, 5, slow, len(called), "dispatched work orders with response_min > 30"),
    ]
    rows = []
    for name, effect, s, d, count, opp, desc in modes:
        rate = count / opp if opp else 0
        o = qc.occurrence_score(rate)
        rows.append({"mode": name, "effect": effect, "S": s, "O": o, "D": d, "rpn": qc.rpn(s, o, d),
                     "count": count, "opportunities": opp, "rate": r(rate, 5), "evidence": desc})
    par = qc.pareto([(m["mode"], m["rpn"]) for m in rows])
    return {"rows": rows, "pareto": [{k: (r(v, 1) if isinstance(v, float) else v) for k, v in p.items()} for p in par],
            "scale": [{"min_rate": c, "score": sc} for c, sc in qc.OCCURRENCE_SCALE]}


def reliability(stations, polls, orders):
    out = {"stations": {}}
    hours = len(polls[stations[0]["station_id"]]) * 5 / 60
    for s in stations:
        ps = polls[s["station_id"]]
        rush = [p for p in ps if p["time"].weekday() < 5 and 7 <= p["time"].hour < 9]
        def share(rows, fn):
            return r(sum(1 for p in rows if fn(p)) / len(rows), 4)
        rep = [(o["resolved_at"] - o["opened_at"]).total_seconds() / 60 for o in orders
               if o["station_id"] == s["station_id"] and o["order_type"] == "repair" and o["fault"] in FAILURE_FAULTS]
        mtbf, mttr = qc.mtbf_mttr(hours, rep)
        feed = share(ps, lambda p: p["age"] <= STALE_MIN)
        kiosk = share(ps, lambda p: p["status"] not in ("offline", "broken_kiosk"))
        dock = share(ps, lambda p: p["dd"] == 0)
        others = [o for o in stations if o["station_id"] != s["station_id"]]
        near = min(others, key=lambda o: dist(o, s))
        out["stations"][s["station_id"]] = {
            "R_bike_all": share(ps, lambda p: p["active"] and p["ba"] > 0),
            "R_dock_all": share(ps, lambda p: p["active"] and p["da"] > 0),
            "R_bike_rush": share(rush, lambda p: p["active"] and p["ba"] > 0),
            "R_dock_rush": share(rush, lambda p: p["active"] and p["da"] > 0),
            "R_feed": feed, "R_kiosk": kiosk, "R_docks": dock,
            "R_station_series": r(qc.series(feed, kiosk, dock), 4),
            "R_station_observed": share(ps, lambda p: p["age"] <= STALE_MIN and p["status"] not in ("offline", "broken_kiosk") and p["dd"] == 0),
            "failures": len(rep), "mtbf_h": r(mtbf, 1), "mttr_h": r(mttr, 2),
            "availability": r(qc.availability(mtbf, mttr), 4) if mtbf else None,
            "nearest": near["station_id"], "nearest_km": r(dist(near, s), 2)}
    rep = [(o["resolved_at"] - o["opened_at"]).total_seconds() / 60 for o in orders
           if o["order_type"] == "repair" and o["fault"] in FAILURE_FAULTS]
    # fleet MTBF: total station operating hours / unplanned failures
    mtbf, mttr = qc.mtbf_mttr(hours * len(stations), rep)
    out["network"] = {"station_hours": r(hours * len(stations), 0), "failures": len(rep),
                      "mtbf_h": r(mtbf, 1), "mttr_h": r(mttr, 2),
                      "availability": r(qc.availability(mtbf, mttr), 4) if mtbf else None}
    return out


def build(folder, scenario, seed):
    stations, polls, faults, orders, vans = load(folder)
    first = polls[stations[0]["station_id"]][0]["time"]
    last = polls[stations[0]["station_id"]][-1]["time"]
    return {
        "meta": {"id": f"{scenario}__{seed}", "scenario": scenario, "seed": seed,
                 "start": first.strftime(FMT), "end": last.strftime(FMT), "poll_min": 5,
                 "stale_min": STALE_MIN, "snapshots": [lab for lab, _ in SNAPSHOTS]},
        "stations": [{k: s[k] for k in ("station_id", "name", "district", "profile", "total_docks", "lat", "lon")}
                     for s in stations],
        "vans": vans,
        "orders": [order_json(o) for o in orders],
        "snapshots": {lab: snapshot(t(ts), stations, polls, faults, orders, vans) for lab, ts in SNAPSHOTS},
        "heatmap": heatmap(stations, polls),
        "xbar": xbar_series(stations, polls),
        "pchart": pchart(stations, polls),
        "fmea": fmea(stations, polls, orders),
        "reliability": reliability(stations, polls, orders),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for scenario in sorted(os.listdir(DATA)):
        sdir = os.path.join(DATA, scenario)
        if not os.path.isdir(sdir):
            continue
        for seed in sorted(os.listdir(sdir)):
            folder = os.path.join(sdir, seed)
            if not os.path.exists(os.path.join(folder, "status.csv")):
                continue
            doc = build(folder, scenario, seed)
            path = os.path.join(OUT, f"{scenario}__{seed}.json")
            with open(path, "w") as fh:
                json.dump(doc, fh, separators=(",", ":"))
            index.append({"id": doc["meta"]["id"], "label": f"{scenario.replace('_', ' ')} / {seed.replace('_', ' ')}"})
            print(f"wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} KB), "
                  f"{len(doc['stations'])} stations")
    index.sort(key=lambda d: (not d["id"].startswith("normal"), d["id"]))
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)


if __name__ == "__main__":
    main()
