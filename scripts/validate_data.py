"""Check every dataset in data/ against the design rules. Prints PASS/FAIL per check.

Run from the repo root:  python3 scripts/validate_data.py
Exit code 1 if any check fails. Standard library only.
"""

import csv
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
FMT = "%Y-%m-%d %H:%M"
BOSTON = {"lat": (42.22, 42.40), "lon": (-71.20, -70.98)}  # city bounding box
OOS = {"offline", "broken_kiosk", "blocked", "maintenance"}
results = []


def check(name, ok, detail):
    results.append((name, ok, detail))


def read(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def summarize(folder):
    st = read(os.path.join(folder, "stations.csv"))
    status = read(os.path.join(folder, "status.csv"))
    orders = read(os.path.join(folder, "work_orders.csv"))
    vans = read(os.path.join(folder, "vans.csv"))
    info = {s["station_id"]: s for s in st}
    n = len(status)
    s = {"stations": len(st), "rows": n, "vans": len(vans),
         "broken_dock_polls": sum(int(r["num_docks_disabled"]) > 0 for r in status) / n,
         "oos_polls": sum(r["status"] in OOS for r in status) / n,
         "empty_polls": sum(r["status"] == "active" and r["num_bikes_available"] == "0" for r in status) / n,
         "full_polls": sum(r["status"] == "active" and r["num_docks_available"] == "0" for r in status) / n,
         "broken_bikes_mean": sum(int(r["num_bikes_disabled"]) for r in status) / n,
         "repair_orders": sum(o["order_type"] == "repair" for o in orders)}
    return st, status, info, vans, s


def validate(label, folder):
    st, status, info, vans, s = summarize(folder)
    per = Counter(x["district"] for x in st)
    check(f"{label}: 30-40 stations", 30 <= len(st) <= 40, f"{len(st)} stations")
    check(f"{label}: 6 districts, 3-6 stations each, counts vary",
          len(per) == 6 and all(3 <= c <= 6 for c in per.values()) and len(set(per.values())) > 1,
          ", ".join(f"{d} {c}" for d, c in per.items()))
    check(f"{label}: stations inside Boston", all(BOSTON["lat"][0] <= float(x["lat"]) <= BOSTON["lat"][1] and
                                                  BOSTON["lon"][0] <= float(x["lon"]) <= BOSTON["lon"][1] for x in st),
          f"lat {min(float(x['lat']) for x in st):.4f}..{max(float(x['lat']) for x in st):.4f}, "
          f"lon {min(float(x['lon']) for x in st):.4f}..{max(float(x['lon']) for x in st):.4f}")
    check(f"{label}: 10-20 docks per station", all(10 <= int(x["total_docks"]) <= 20 for x in st),
          f"{min(int(x['total_docks']) for x in st)}-{max(int(x['total_docks']) for x in st)}")
    times = sorted({r["timestamp"] for r in status})
    t0, t1 = datetime.strptime(times[0], FMT), datetime.strptime(times[-1], FMT)
    check(f"{label}: 5-minute polls for 3 weeks from a Monday",
          len(times) == 6048 and s["rows"] == 6048 * len(st) and t0.weekday() == 0 and t1 - t0 == timedelta(days=21, minutes=-5),
          f"{len(times)} polls per station, {times[0]} to {times[-1]}")
    bad = [r for r in status if int(r["num_bikes_available"]) + int(r["num_bikes_disabled"]) + int(r["num_docks_available"])
           + int(r["num_docks_disabled"]) != int(info[r["station_id"]]["total_docks"])]
    check(f"{label}: bikes + docks = total docks on every row", not bad, f"{len(bad)} bad rows")
    fill = defaultdict(list)
    for r in status:
        if r["status"] != "active":
            continue
        t = datetime.strptime(r["timestamp"], FMT)
        bikes = int(r["num_bikes_available"]) + int(r["num_bikes_disabled"])
        eff = bikes + int(r["num_docks_available"])
        if eff:
            fill[(info[r["station_id"]]["profile"], t.weekday() < 5, t.hour)].append(bikes / eff)
    m = {k: sum(v) / len(v) for k, v in fill.items()}
    check(f"{label}: weekday rush (residential empties, downtown fills at 8 AM)",
          m[("residential", True, 8)] < 0.35 < 0.55 < m[("residential", True, 5)] and m[("downtown", True, 8)] > 0.65,
          f"residential 5 AM {m[('residential', True, 5)]:.0%} -> 8 AM {m[('residential', True, 8)]:.0%}; "
          f"downtown 8 AM {m[('downtown', True, 8)]:.0%}")
    check(f"{label}: weekend peaks in daylight (residential drains 12-15)",
          m[("residential", False, 13)] < m[("residential", False, 4)] - 0.1,
          f"residential weekend 4 AM {m[('residential', False, 4)]:.0%}, 1 PM {m[('residential', False, 13)]:.0%}")
    check(f"{label}: broken bikes are uncommon (< 0.25 per station-poll)", s["broken_bikes_mean"] < 0.25,
          f"{s['broken_bikes_mean']:.3f} per station-poll")
    check(f"{label}: 7-8 vans", 7 <= len(vans) <= 8, f"{len(vans)} vans")
    return s


def main():
    summaries = {}
    for scenario in sorted(os.listdir(ROOT)):
        sdir = os.path.join(ROOT, scenario)
        if not os.path.isdir(sdir):
            continue
        for seed in sorted(os.listdir(sdir)):
            if os.path.exists(os.path.join(sdir, seed, "status.csv")):
                summaries[(scenario, seed)] = validate(f"{scenario}/{seed}", os.path.join(sdir, seed))
    for seed in sorted({k[1] for k in summaries}):
        nrm, hi = summaries.get(("normal_week", seed)), summaries.get(("high_failure_week", seed))
        if not nrm or not hi:
            continue
        for key, need in (("broken_dock_polls", 3), ("oos_polls", 3), ("repair_orders", 3),
                          ("full_polls", 1.5), ("empty_polls", 1.5)):
            ratio = hi[key] / nrm[key] if nrm[key] else float("inf")
            fmt = (lambda v: f"{v}") if key == "repair_orders" else (lambda v: f"{v:.2%}")
            check(f"{seed}: high_failure has far more {key.replace('_', ' ')} (>= {need}x)", ratio >= need,
                  f"normal {fmt(nrm[key])} vs high {fmt(hi[key])} ({ratio:.1f}x)")
    width = max(len(n) for n, _, _ in results)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {detail}")
    failed = sum(not ok for _, ok, _ in results)
    print(f"\n{len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
