"""Generate the synthetic bikeshare test datasets in data/.

Run from the repo root:  python3 scripts/generate_data.py

Standard library only. Every run is seeded, so the files are reproducible.
Writes data/<scenario>/<seed_n>/ with five CSVs each (see data/README.md):
stations.csv, status.csv, dock_faults.csv, work_orders.csv, vans.csv.

The rules (from the team's design document):
- 20 stations across 4 districts, 10 to 20 docks each
- one poll every 5 minutes, 24 hours a day, for 3 weeks (starting Monday)
- weekday rush hours 7-9 AM and 4-6 PM: residential stations empty out in the
  morning and downtown stations fill up; the evening reverses it
- weekends peak in daylight
- a few stations have broken docks or go offline; more in high_failure_week
"""

import csv
import math
import os
import random
from datetime import datetime, timedelta

START = datetime(2026, 9, 7)  # a Monday
DAYS = 21
POLL_MIN = 5
POLLS = DAYS * 24 * 60 // POLL_MIN  # 6048

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

# district -> (centre x, centre y, station profile). Map units are 0-100.
DISTRICTS = {
    "Downtown": (52, 48, "downtown"),
    "Northside": (48, 14, "residential"),
    "Eastside": (86, 52, "residential"),
    "Waterfront": (18, 76, "mixed"),
}
STATION_NAMES = {
    "Downtown": ["City Hall", "Main & 5th", "Transit Center", "Library Square", "Market Hall"],
    "Northside": ["Elm Park", "Hillcrest", "North Commons", "Maple Ave", "Ridge Rd"],
    "Eastside": ["Eastgate", "Orchard St", "Linden Way", "Fall Creek", "Belle Sherman"],
    "Waterfront": ["Pier 1", "Boathouse", "Marina", "Inlet Trail", "Ferry Landing"],
}

SCENARIOS = {
    # fault rates are expected events per station per week
    "normal_week": {
        "seeds": {"seed_1": 11, "seed_2": 12},
        "rates": {"dock_fault": 0.5, "offline": 0.08, "broken_kiosk": 0.08,
                  "silent_feed": 0.1, "blocked": 0.04, "maintenance": 0.15},
        "chronic": 1, "chronic_mult": 2.5, "response_mean": 22, "broken_bike_p": 0.0008,
    },
    "high_failure_week": {
        "seeds": {"seed_1": 21, "seed_2": 22},
        "rates": {"dock_fault": 1.6, "offline": 0.35, "broken_kiosk": 0.3,
                  "silent_feed": 0.45, "blocked": 0.15, "maintenance": 0.2},
        "chronic": 3, "chronic_mult": 3.0, "response_mean": 38, "broken_bike_p": 0.002,
    },
}

OUT_OF_SERVICE = ("offline", "broken_kiosk", "blocked", "maintenance")
DOCK_FAULT_STATES = ("faulty", "bike_stuck", "never_locks")


def interp(points, h):
    """Piecewise-linear interpolation through (hour, value) keypoints over 0-24."""
    for (h0, v0), (h1, v1) in zip(points, points[1:]):
        if h0 <= h <= h1:
            return v0 + (v1 - v0) * (h - h0) / (h1 - h0)
    return points[-1][1]


# Target fill fraction by hour, per profile. Weekday rush hours: 7-9 and 16-18.
WEEKDAY = {
    "residential": [(0, .72), (6.5, .72), (7, .6), (8, .12), (9, .05), (10, .15),
                    (15, .35), (16, .4), (17, .7), (18, .9), (20, .8), (24, .72)],
    "downtown": [(0, .3), (6.5, .3), (7, .4), (8, .85), (9, .97), (10, .9),
                 (15, .8), (16, .7), (17, .3), (18, .06), (20, .15), (24, .3)],
    "mixed": [(0, .5), (7, .5), (8.5, .7), (10, .62), (16, .58), (17.5, .35),
              (19, .45), (24, .5)],
}
WEEKEND = {
    "residential": [(0, .65), (9, .62), (12, .38), (15, .33), (18, .5), (21, .62), (24, .65)],
    "downtown": [(0, .4), (9, .42), (12, .62), (15, .66), (18, .5), (21, .42), (24, .4)],
    "mixed": [(0, .45), (9, .45), (12, .72), (15, .82), (18, .6), (21, .48), (24, .45)],
}


def target_fill(profile, dow, hour, amp, offset):
    table = WEEKDAY if dow < 5 else WEEKEND
    base = interp(table[profile], hour)
    return min(1.0, max(0.0, 0.5 + (base - 0.5) * amp + offset))


def noise_sd(dow, hour):
    """Ride activity: more wobble in daylight, most during weekday rushes."""
    if dow < 5 and (7 <= hour < 9 or 16 <= hour < 18):
        return 0.045
    if 7 <= hour < 21:
        return 0.03
    return 0.008


def iso(minute):
    return (START + timedelta(minutes=minute)).strftime("%Y-%m-%d %H:%M")


def make_stations():
    rng = random.Random(2026)  # the city is the same in every dataset
    stations = []
    n = 0
    for district, (cx, cy, profile) in DISTRICTS.items():
        for name in STATION_NAMES[district]:
            n += 1
            stations.append({
                "station_id": f"S{n:02d}",
                "name": name,
                "district": district,
                "profile": profile,
                "total_docks": rng.randint(10, 20),
                "x": round(cx + rng.uniform(-11, 11), 1),
                "y": round(cy + rng.uniform(-9, 9), 1),
                "amp": rng.uniform(0.85, 1.1),
                "offset": rng.uniform(-0.05, 0.05),
            })
    return stations


def lognormal_minutes(rng, mean, cv=0.6):
    s2 = math.log(1 + cv * cv)
    mu = math.log(mean) - s2 / 2
    return max(3.0, rng.lognormvariate(mu, math.sqrt(s2)))


def snap(minute):
    """Round a minute up to the next poll boundary."""
    return int(math.ceil(minute / POLL_MIN) * POLL_MIN)


def make_faults(rng, stations, cfg, vans):
    """Schedule every fault, with the repair work order that ends it."""
    chronic = set(s["station_id"] for s in rng.sample(stations, cfg["chronic"]))
    faults, orders = [], []
    dock_faults = []
    total_min = DAYS * 24 * 60
    for st in stations:
        mult = cfg["chronic_mult"] if st["station_id"] in chronic else 1.0
        for kind, rate in cfg["rates"].items():
            count = poisson(rng, rate * mult * DAYS / 7)
            for _ in range(count):
                if kind == "maintenance":  # scheduled off-peak, mid-day
                    day = rng.randrange(DAYS)
                    start = day * 1440 + rng.randint(10 * 60, 14 * 60)
                else:
                    start = rng.randrange(0, total_min - 600)
                start = snap(start)
                if kind == "blocked":  # street works: no van, city clears it
                    end = snap(start + rng.uniform(120, 480))
                    faults.append({"station_id": st["station_id"], "kind": kind,
                                   "start": start, "end": end})
                    continue
                detect = {"dock_fault": rng.uniform(10, 60), "offline": rng.uniform(5, 15),
                          "broken_kiosk": rng.uniform(5, 20), "maintenance": 0,
                          "silent_feed": rng.uniform(90, 360)}[kind]
                opened = start + detect
                assigned = opened + rng.uniform(1, 10)
                response = lognormal_minutes(rng, cfg["response_mean"])
                arrived = opened + response
                repair = {"dock_fault": lognormal_minutes(rng, 45), "offline": lognormal_minutes(rng, 30),
                          "broken_kiosk": lognormal_minutes(rng, 60), "maintenance": rng.uniform(45, 120),
                          "silent_feed": lognormal_minutes(rng, 20)}[kind]
                if kind == "dock_fault" and rng.random() < 0.3:
                    repair += rng.uniform(240, 1440)  # waits for a spare part
                resolved = arrived + repair
                end = snap(resolved)
                fault = {"station_id": st["station_id"], "kind": kind, "start": start, "end": end}
                if kind == "dock_fault":
                    k = min(rng.choice([1, 1, 2, 2, 3, 4]), st["total_docks"] - 4)
                    fault["docks"] = rng.sample(range(1, st["total_docks"] + 1), k)
                    for d in fault["docks"]:
                        dock_faults.append({"station_id": st["station_id"],
                                            "dock_id": f"{st['station_id']}-D{d:02d}",
                                            "state": rng.choice(DOCK_FAULT_STATES),
                                            "start": iso(start), "end": iso(end)})
                faults.append(fault)
                orders.append({"station_id": st["station_id"], "order_type": "repair",
                               "fault": kind, "opened": opened, "assigned": assigned,
                               "arrived": arrived, "resolved": resolved,
                               "van_id": rng.choice(vans)["van_id"], "bikes_moved": 0})
    return faults, orders, dock_faults, sorted(chronic)


def poisson(rng, lam):
    k, p, l = 0, 1.0, math.exp(-lam)
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def simulate(rng, stations, faults, orders, cfg, vans):
    by_station = {}
    for f in faults:
        by_station.setdefault(f["station_id"], []).append(f)
    rows = []
    for st in stations:
        sid, total = st["station_id"], st["total_docks"]
        fl = by_station.get(sid, [])
        dev = rng.gauss(0, 0.05)
        broken_bikes = 0
        frozen = None  # (last_reported, reported row) while the feed is silent
        pending = []   # rebalance van arrivals: (minute, )
        prev_bikes = None
        empty_since = full_since = None
        for i in range(POLLS):
            minute = i * POLL_MIN
            day, mod = divmod(minute, 1440)
            dow = day % 7
            hour = mod / 60
            active = [f for f in fl if f["start"] <= minute < f["end"]]
            broken = set()
            for f in active:
                broken.update(f.get("docks", []))
            eff = total - len(broken)
            oos = next((f["kind"] for f in active if f["kind"] in OUT_OF_SERVICE), None)
            silent = any(f["kind"] == "silent_feed" for f in active)

            tgt = target_fill(st["profile"], dow, hour, st["amp"], st["offset"])
            if oos is None:
                dev = 0.97 * dev + rng.gauss(0, noise_sd(dow, hour))
            # a rebalancing van arrives: reset the station to about half full
            if pending and pending[0] <= minute:
                pending.pop(0)
                dev = 0.5 - tgt
            x = tgt + dev
            if x < 0 or x > 1:  # clamp, and let the deviation stick at the bound
                x = min(1.0, max(0.0, x))
                dev = x - tgt
            bikes = round(x * eff) if oos is None or prev_bikes is None else min(prev_bikes, eff)
            bikes = max(0, min(eff, bikes))
            prev_bikes = bikes
            if rng.random() < cfg["broken_bike_p"]:
                broken_bikes += 1
            # each broken bike is collected by a mechanic at 0.2% per poll (about 2 days)
            broken_bikes -= sum(1 for _ in range(broken_bikes) if rng.random() < 0.002)
            bd = min(broken_bikes, bikes)
            row = {"timestamp": iso(minute), "station_id": sid,
                   "num_bikes_available": bikes - bd, "num_bikes_disabled": bd,
                   "num_docks_available": eff - bikes, "num_docks_disabled": len(broken),
                   "status": oos or "active", "is_renting": 0 if oos else 1,
                   "is_returning": 0 if oos else 1, "last_reported": iso(minute)}
            if silent and oos is None:
                if frozen is None:
                    frozen = dict(row)
                rep = dict(frozen)
                rep["timestamp"] = iso(minute)
                rows.append(rep)
            else:
                frozen = None
                rows.append(row)

            # rush-hour stockouts and fullouts sometimes get a rebalancing van
            in_rush = dow < 5 and (7 <= hour < 9.5 or 16 <= hour < 18.5)
            if oos is None and not silent:
                if bikes == 0 and empty_since is None:
                    empty_since = minute
                    if in_rush and rng.random() < 0.45:
                        pending.append(dispatch(rng, orders, sid, "stockout", minute, cfg, vans, eff))
                elif bikes > 0:
                    empty_since = None
                if bikes == eff and full_since is None:
                    full_since = minute
                    if in_rush and rng.random() < 0.45:
                        pending.append(dispatch(rng, orders, sid, "fullout", minute, cfg, vans, eff))
                elif bikes < eff:
                    full_since = None
                pending.sort()
    return rows


def dispatch(rng, orders, sid, kind, minute, cfg, vans, eff):
    opened = minute + rng.uniform(5, 15)
    response = lognormal_minutes(rng, cfg["response_mean"])
    arrived = opened + response
    orders.append({"station_id": sid, "order_type": "rebalance", "fault": kind,
                   "opened": opened, "assigned": opened + rng.uniform(1, 5),
                   "arrived": arrived, "resolved": arrived + rng.uniform(5, 15),
                   "van_id": rng.choice(vans)["van_id"],
                   "bikes_moved": max(1, round(eff / 2))})
    return snap(arrived)


def write_csv(path, rows, fields):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main():
    stations = make_stations()
    vans = [{"van_id": f"V{i}", "name": n, "capacity": c, "depot_x": x, "depot_y": y}
            for i, (n, c, x, y) in enumerate([("Van 1", 20, 50, 60), ("Van 2", 20, 50, 60),
                                                ("Van 3", 16, 30, 30), ("Van 4", 16, 75, 70)], 1)]
    for scenario, cfg in SCENARIOS.items():
        for label, seed in cfg["seeds"].items():
            rng = random.Random(seed)
            faults, orders, dock_faults, chronic = make_faults(rng, stations, cfg, vans)
            rows = simulate(rng, stations, faults, orders, cfg, vans)
            orders.sort(key=lambda o: o["opened"])
            out = []
            for n, o in enumerate(orders, 1):
                out.append({"order_id": f"WO{n:04d}", "station_id": o["station_id"],
                            "order_type": o["order_type"], "fault": o["fault"],
                            "opened_at": iso(o["opened"]), "assigned_at": iso(o["assigned"]),
                            "arrived_at": iso(o["arrived"]), "resolved_at": iso(o["resolved"]),
                            "response_min": round(o["arrived"] - o["opened"], 1),
                            "repair_min": round(o["resolved"] - o["arrived"], 1),
                            "van_id": o["van_id"], "bikes_moved": o["bikes_moved"]})
            d = os.path.join(ROOT, scenario, label)
            os.makedirs(d, exist_ok=True)
            write_csv(os.path.join(d, "stations.csv"), stations,
                      ["station_id", "name", "district", "profile", "total_docks", "x", "y"])
            write_csv(os.path.join(d, "status.csv"), rows,
                      ["timestamp", "station_id", "num_bikes_available", "num_bikes_disabled",
                       "num_docks_available", "num_docks_disabled", "status", "is_renting",
                       "is_returning", "last_reported"])
            write_csv(os.path.join(d, "dock_faults.csv"), dock_faults,
                      ["station_id", "dock_id", "state", "start", "end"])
            write_csv(os.path.join(d, "work_orders.csv"), out,
                      ["order_id", "station_id", "order_type", "fault", "opened_at", "assigned_at",
                       "arrived_at", "resolved_at", "response_min", "repair_min", "van_id",
                       "bikes_moved"])
            write_csv(os.path.join(d, "vans.csv"), vans,
                      ["van_id", "name", "capacity", "depot_x", "depot_y"])
            print(f"{scenario}/{label}: {len(rows)} polls, {len(out)} work orders, "
                  f"{len(faults)} faults, chronic stations {chronic}")


if __name__ == "__main__":
    main()
