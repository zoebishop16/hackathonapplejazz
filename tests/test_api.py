"""The REST API returns the same numbers as app/qc.py (SPEC.md section 4).

Needs: pip install -r tests/requirements.txt, and the built JSON (python3 app/build.py).
"""

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.app import app  # noqa: E402

client = TestClient(app)
DS = "normal_week__seed_1"


def test_health_and_datasets():
    assert client.get("/health").json() == {"status": "ok", "datasets": 4}
    ds = client.get("/datasets").json()
    assert {d["id"] for d in ds} == {"normal_week__seed_1", "normal_week__seed_2",
                                     "high_failure_week__seed_1", "high_failure_week__seed_2"}
    assert ds[0]["snapshots"][0]["key"] == "wed-0815"


def _n_stations():
    import csv
    with open("data/normal_week/seed_1/stations.csv") as fh:
        return sum(1 for _ in csv.DictReader(fh))


def test_stations_and_filters():
    n = _n_stations()
    r = client.get(f"/datasets/{DS}/stations", params={"snapshot": "wed-0815"}).json()
    assert r["count"] == n and r["time"] == "2026-09-23 08:15"
    for s in r["stations"]:  # effective capacity = total docks - broken docks, on every row
        assert s["eff"] == s["total_docks"] - s["docks_disabled"]
    bb = client.get(f"/datasets/{DS}/stations", params={"district": "Back Bay"}).json()
    assert 3 <= bb["count"] <= 6 and all(s["district"] == "Back Bay" for s in bb["stations"])
    prob = client.get(f"/datasets/{DS}/stations", params={"problem_only": True}).json()
    assert all(s["problems"] or s["misleading"] for s in prob["stations"])
    assert client.get(f"/datasets/{DS}/stations", params={"snapshot": "nope"}).status_code == 404
    assert client.get("/datasets/nope/stations").status_code == 404


def test_station_detail_and_heatmap():
    s = client.get(f"/datasets/{DS}/stations/S01").json()
    assert len(s["docks"]["grid"]) == s["total_docks"]
    h = client.get(f"/datasets/{DS}/heatmap", params={"metric": "fill"}).json()
    assert len(h["percent"]) == 7 and len(h["percent"][0]) == 24


def test_xbar_eight_hour_blocks():
    """Recompute the first 8-hour block straight from status.csv and compare with the API."""
    import csv
    x = client.get(f"/datasets/{DS}/xbar", params={"scope": "district:Back Bay"}).json()
    assert x["subgroup"] == "8-hour block" and len(x["points"]) == 21 * 3
    assert [p["label"] for p in x["points"][:3]] == ["Mon 09-07 00:01-08:00", "Mon 09-07 08:01-16:00", "Mon 09-07 16:01-24:00"]
    assert len({p["ucl"] for p in x["points"]}) == 1  # one flat pair of limits
    with open("data/normal_week/seed_1/stations.csv") as fh:
        ids = {s["station_id"] for s in csv.DictReader(fh) if s["district"] == "Back Bay"}
    obs = []
    with open("data/normal_week/seed_1/status.csv") as fh:
        for row in csv.DictReader(fh):
            t = row["timestamp"]
            in_block = t.startswith("2026-09-07") and "00:05" <= t[11:] <= "08:00"
            if row["station_id"] in ids and in_block and row["status"] == "active":
                eff = int(row["num_bikes_available"]) + int(row["num_bikes_disabled"]) + int(row["num_docks_available"])
                if eff:
                    obs.append(100 * int(row["num_docks_available"]) / eff)
    first = x["points"][0]
    assert first["n"] == len(obs) and x["n_limits"] == 96 * len(ids)
    assert first["mean"] == pytest.approx(sum(obs) / len(obs), abs=0.01)
    assert client.get(f"/datasets/{DS}/xbar", params={"scope": "district:Nowhere"}).status_code == 404


def test_other_reads():
    assert client.get(f"/datasets/{DS}/imr").status_code == 404  # the I-MR chart was removed
    assert client.get(f"/datasets/{DS}/pchart").json()["window"] == "off_peak"
    assert len(client.get(f"/datasets/{DS}/fmea").json()["rows"]) == 6
    assert client.get(f"/datasets/{DS}/reliability", params={"station": "S01"}).json()["station"] == "S01"
    assert "moves" in client.get(f"/datasets/{DS}/dispatch").json()
    assert "mttr_min" in client.get(f"/datasets/{DS}/maintenance").json()
    assert client.get(f"/datasets/{DS}/events").status_code == 404  # the event log was removed
    assert "stations" in client.get(f"/datasets/{DS}/forecast").json()


# ---- compute endpoints: SPEC 4 known answers and degenerate cases

def test_compute_fill():
    r = client.post("/compute/fill", json={"total_docks": 12, "docks_disabled": 4, "bikes_available": 6}).json()
    assert r == {"effective_capacity": 8, "docks_available": 2, "fill_pct": 75.0, "category": "high",
                 "naive_fill_pct": 50.0, "misleading": "looks_emptier"}
    zero = client.post("/compute/fill", json={"total_docks": 10, "docks_disabled": 10, "bikes_available": 0}).json()
    assert zero["fill_pct"] is None and zero["category"] is None
    assert client.post("/compute/fill", json={"total_docks": 5, "docks_disabled": 6, "bikes_available": 0}).status_code == 422


def test_compute_xbar():
    r = client.post("/compute/xbar", json={"subgroups": [{"label": "A", "values": [10, 20, 30]},
                                                         {"label": "B", "values": [40, 50, 60]}]}).json()
    assert r["grand_mean"] == 35 and r["sigma_short"] == pytest.approx(10)
    assert r["points"][0]["ucl"] == pytest.approx(52.3205, abs=1e-4)
    const = client.post("/compute/xbar", json={"subgroups": [{"label": "A", "values": [5, 5]}]}).json()
    assert const["points"][0]["ucl"] is None and const["message"]
    assert client.post("/compute/xbar", json={"subgroups": [{"label": "A", "values": []}]}).status_code == 422


def test_compute_pchart():
    assert client.post("/compute/imr", json={"baseline": [10, 12]}).status_code == 404
    p = client.post("/compute/pchart", json={"baseline": [{"defectives": 2, "n": 20}] * 5,
                                             "monitor": [{"defectives": 7, "n": 20}]}).json()
    assert p["pbar"] == pytest.approx(0.1) and p["points"][0]["ucl"] == pytest.approx(0.3012, abs=1e-4)
    assert client.post("/compute/pchart", json={"baseline": [{"defectives": 3, "n": 2}]}).status_code == 422


def test_compute_fmea_reliability_forecast():
    f = client.post("/compute/fmea", json={"modes": [
        {"name": "x", "severity": 8, "occurrence": 5, "detection": 3},
        {"name": "y", "severity": 2, "occurrence_rate": 0.01, "detection": 2}]}).json()
    assert f["modes"][0]["rpn"] == 120 and f["modes"][1]["O"] == 5 and f["pareto"][0]["name"] == "x"
    assert client.post("/compute/fmea", json={"modes": [{"name": "z", "severity": 0, "occurrence": 1, "detection": 1}]}).status_code == 422
    assert client.post("/compute/reliability", json={"structure": "series", "reliabilities": [0.9, 0.8]}).json()["R"] == pytest.approx(0.72)
    assert client.post("/compute/reliability", json={"structure": "parallel", "reliabilities": [0.9, 0.8]}).json()["R"] == pytest.approx(0.98)
    assert client.post("/compute/availability", json={"mtbf": 95, "mttr": 5}).json()["availability"] == pytest.approx(0.95)
    assert client.post("/compute/availability", json={"mtbf": 0, "mttr": 0}).status_code == 422
    fc = client.post("/compute/forecast", json={"bikes_now": 4, "capacity": 10, "hist_fill_now": 0.5, "hist_fill_later": 0.2}).json()
    assert fc == {"projected_bikes": pytest.approx(1.0), "risk": "empty"}


def test_compute_stockouts():
    polls = [{"time": t, "bikes_available": b, "docks_available": d} for t, b, d in
             [("08:00", 3, 9), ("08:05", 0, 12), ("08:10", 0, 12), ("08:15", 2, 10)]]
    ev = client.post("/compute/stockouts", json={"polls": polls}).json()
    assert ev == [{"kind": "stockout", "start": "08:05", "end": "08:15", "polls": 2, "duration_min": 10, "ongoing": False}]


def test_dashboard_is_served():
    r = client.get("/dashboard/")
    assert r.status_code == 200 and "Dock Watch" in r.text
    assert client.get("/dashboard/data/index.json").status_code == 200


def test_forecast_horizons_and_priority():
    f = client.get(f"/datasets/{DS}/forecast", params={"at_risk_only": False}).json()["stations"]
    assert all(f"p{m}" in s for s in f for m in (30, 60, 90, 120))
    assert [s["rank"] for s in f] == sorted(s["rank"] for s in f)
    urg = [s["urgency"] for s in f]
    assert urg == sorted(urg, reverse=True)  # ranked by priority first
    assert all((s["priority"] == "high") == (s["urgency"] >= 4) for s in f)


def test_eight_vans():
    assert len(client.get(f"/datasets/{DS}/dispatch").json()["vans"]) == 8


def test_overview_matches_station_rows_and_ranking():
    for ds in ("normal_week__seed_1", "high_failure_week__seed_2"):
        o = client.get(f"/datasets/{ds}/overview", params={"snapshot": "wed-0815"}).json()
        rows = client.get(f"/datasets/{ds}/stations", params={"snapshot": "wed-0815"}).json()["stations"]
        sm = o["summary"]
        assert sm["empty"] == sum(1 for r in rows if r["status"] == "active" and r["bikes_available"] == 0)
        assert sm["full"] == sum(1 for r in rows if r["status"] == "active" and r["docks_available"] == 0)
        assert sm["out_of_service"] == sum(1 for r in rows if r["status"] != "active")
        open_docks = sum(r["docks_available"] for r in rows if r["status"] == "active")
        assert sm["docks_available_pct"] == pytest.approx(100 * open_docks / sum(r["total_docks"] for r in rows), abs=0.05)
        # top 5 = the first 5 of the Dispatch forecast ranking, and out-of-service stations are included
        fc = client.get(f"/datasets/{ds}/forecast").json()["stations"]
        assert [a["station"] for a in o["at_risk"]] == [f["id"] for f in fc][:5]
        oos = {r["id"] for r in rows if r["status"] != "active"}
        assert oos <= {f["id"] for f in fc}
        assert all(a["risk_pct"] is None or 0 <= a["risk_pct"] <= 100 for a in o["at_risk"])


def test_xbar_block_boundaries():
    """08:00 closes the first block and 16:00 the second (blocks are x:01 to y:00)."""
    import sys
    sys.path.insert(0, "app")
    import build
    from datetime import datetime
    t0 = datetime(2026, 9, 7)
    polls = [{"time": datetime(2026, 9, 7, h, m), "active": True, "eff": 10, "da": da}
             for h, m, da in [(0, 0, 0), (8, 0, 2), (8, 5, 4), (16, 0, 6), (16, 5, 8), (23, 55, 9)]]
    polls[0]["time"] = t0
    acc = build.block_open_pct(polls)
    assert dict(acc) == {(0, 0): [20.0], (0, 1): [40.0, 60.0], (0, 2): [80.0, 90.0]}
