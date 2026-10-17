"""Generate the synthetic bikeshare test datasets in data/.

Run from the repo root:  python3 scripts/generate_data.py
Then check them:          python3 scripts/validate_data.py

Standard library only. Every run is seeded, so the files are reproducible.
Writes data/<scenario>/<seed_n>/ with five CSVs each (see data/README.md):
stations.csv, status.csv, dock_faults.csv, work_orders.csv, vans.csv.

The rules (from the team's design document, revised):
- 6 Boston neighborhoods as districts, a random 3 to 6 stations in each
  (30 to 40 stations in all), placed at real street locations (lat/lon)
- 10 to 20 docks per station
- one poll every 5 minutes, 24 hours a day, for 3 weeks (starting Monday)
- weekday rush hours 7-9 AM and 4-6 PM: residential stations empty out in the
  morning and downtown stations fill up; the evening reverses it
- weekends peak in daylight
- a few stations have broken docks or go offline; far more in high_failure_week
- broken bikes are uncommon (well under 1 per station on average)
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

# Six Boston neighborhoods. Each lists up to 6 real locations (name, lat, lon);
# the generator keeps the first 3-6. Coordinates are street-level approximations.
DISTRICTS = {
    "Downtown": ("downtown", [
        ("Government Center", 42.3597, -71.0592), ("Downtown Crossing", 42.3555, -71.0605),
        ("South Station", 42.3523, -71.0552), ("Faneuil Hall", 42.3600, -71.0568),
        ("Post Office Square", 42.3561, -71.0555), ("Park Street", 42.3564, -71.0624)]),
    "Back Bay": ("downtown", [
        ("Copley Square", 42.3499, -71.0774), ("Back Bay Station", 42.3473, -71.0754),
        ("Boylston & Arlington", 42.3520, -71.0702), ("Newbury & Mass Ave", 42.3487, -71.0870),
        ("Prudential Center", 42.3471, -71.0825), ("Commonwealth & Dartmouth", 42.3511, -71.0790)]),
    "Fenway": ("mixed", [
        ("Fenway Park", 42.3467, -71.0972), ("Kenmore Square", 42.3489, -71.0952),
        ("Museum of Fine Arts", 42.3394, -71.0940), ("Longwood Medical Area", 42.3381, -71.1058),
        ("Northeastern University", 42.3398, -71.0892), ("Boylston & Jersey St", 42.3445, -71.1000)]),
    "South Boston": ("residential", [
        ("Broadway Station", 42.3426, -71.0570), ("Andrew Square", 42.3302, -71.0570),
        ("L St & E Broadway", 42.3348, -71.0350), ("World Trade Center", 42.3486, -71.0420),
        ("Dorchester Heights", 42.3330, -71.0480), ("M Street Beach", 42.3320, -71.0300)]),
    "Jamaica Plain": ("residential", [
        ("Jackson Square", 42.3232, -71.0995), ("JP Centre & Eliot", 42.3105, -71.1150),
        ("Green Street", 42.3105, -71.1074), ("Forest Hills", 42.3005, -71.1137),
        ("Jamaica Pond", 42.3160, -71.1200), ("Hyde Square", 42.3215, -71.1100)]),
    "Charlestown": ("residential", [
        ("Bunker Hill Monument", 42.3763, -71.0608), ("Navy Yard", 42.3735, -71.0545),
        ("Sullivan Square", 42.3840, -71.0770), ("Community College", 42.3737, -71.0696),
        ("City Square", 42.3720, -71.0620), ("Thompson Square", 42.3767, -71.0646)]),
}

VANS = [  # name, capacity (bikes), depot (lat, lon)
    ("Van 1", 20, 42.3480, -71.0640), ("Van 2", 20, 42.3480, -71.0640),
    ("Van 3", 16, 42.3530, -71.0800), ("Van 4", 16, 42.3420, -71.0950),
    ("Van 5", 16, 42.3380, -71.0500), ("Van 6", 12, 42.3160, -71.1080),
    ("Van 7", 12, 42.3760, -71.0640), ("Van 8", 20, 42.3480, -71.0640),
]

SCENARIOS = {
    # fault rates are expected events per station per week
    "normal_week": {
        "seeds": {"seed_1": 11, "seed_2": 12},
        "rates": {"dock_fault": 0.35, "offline": 0.04, "broken_kiosk": 0.04,
                  "silent_feed": 0.06, "blocked": 0.02, "maintenance": 0.12},
        "chronic": 1, "chronic_mult": 2.0, "dock_fault_sizes": [1, 1, 1, 2],
        "parts_wait_p": 0.15, "response_mean": 18, "rebalance_p": 0.7,
        "demand_amp": 1.0, "broken_bike_p": 0.0002, "broken_bike_fix_p": 0.004,
    },
    "high_failure_week": {
        "seeds": {"seed_1": 21, "seed_2": 22},
        "rates": {"dock_fault": 2.4, "offline": 0.6, "broken_kiosk": 0.5,
                  "silent_feed": 0.6, "blocked": 0.25, "maintenance": 0.3},
        "chronic": 4, "chronic_mult": 3.0, "dock_fault_sizes": [1, 2, 2, 3, 4, 5],
        "parts_wait_p": 0.45, "response_mean": 45, "rebalance_p": 0.25,
        "demand_amp": 1.25, "broken_bike_p": 0.0004, "broken_bike_fix_p": 0.003,
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


def station_counts(rng):
    """A random 3-6 stations per district, 30-40 in all, not all the same."""
    while True:
        counts = [rng.randint(3, 6) for _ in DISTRICTS]
        if 30 <= sum(counts) <= 40 and len(set(counts)) > 1:
            return counts


def make_stations():
    rng = random.Random(2026)  # the city is the same in every dataset
    stations = []
    n = 0
    for (district, (profile, places)), k in zip(DISTRICTS.items(), station_counts(rng)):
        for name, lat, lon in places[:k]:
            n += 1
            stations.append({
                "station_id": f"S{n:02d}",
                "name": name,
                "district": district,
                "profile": profile,
                "total_docks": rng.randint(10, 20),
                "lat": lat,
                "lon": lon,
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
                if kind == "dock_fault" and rng.random() < cfg["parts_wait_p"]:
                    repair += rng.uniform(240, 1440)  # waits for a spare part
                resolved = arrived + repair
                end = snap(resolved)
                fault = {"station_id": st["station_id"], "kind": kind, "start": start, "end": end}
                if kind == "dock_fault":
                    k = min(rng.choice(cfg["dock_fault_sizes"]), st["total_docks"] - 4)
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
        amp = st["amp"] * cfg["demand_amp"]
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

            tgt = target_fill(st["profile"], dow, hour, amp, st["offset"])
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
            # each broken bike is collected by a mechanic at broken_bike_fix_p per poll
            broken_bikes -= sum(1 for _ in range(broken_bikes) if rng.random() < cfg["broken_bike_fix_p"])
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
                    if in_rush and rng.random() < cfg["rebalance_p"]:
                        pending.append(dispatch(rng, orders, sid, "stockout", minute, cfg, vans, eff))
                elif bikes > 0:
                    empty_since = None
                if bikes == eff and full_since is None:
                    full_since = minute
                    if in_rush and rng.random() < cfg["rebalance_p"]:
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
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def main():
    stations = make_stations()
    vans = [{"van_id": f"V{i}", "name": n, "capacity": c, "depot_lat": lat, "depot_lon": lon}
            for i, (n, c, lat, lon) in enumerate(VANS, 1)]
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
                      ["station_id", "name", "district", "profile", "total_docks", "lat", "lon"])
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
                      ["van_id", "name", "capacity", "depot_lat", "depot_lon"])
            print(f"{scenario}/{label}: {len(stations)} stations, {len(rows)} polls, "
                  f"{len(out)} work orders, {len(faults)} faults, chronic stations {chronic}")


if __name__ == "__main__":
    main()
