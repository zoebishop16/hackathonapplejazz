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


def test_stations_and_filters():
    r = client.get(f"/datasets/{DS}/stations", params={"snapshot": "wed-0815"}).json()
    assert r["count"] == 20 and r["time"] == "2026-09-23 08:15"
    s07 = next(s for s in r["stations"] if s["id"] == "S07")
    assert s07["eff"] == 15 and s07["misleading"] == "empty_due_to_broken_bikes"
    north = client.get(f"/datasets/{DS}/stations", params={"district": "Northside"}).json()
    assert north["count"] == 5 and all(s["district"] == "Northside" for s in north["stations"])
    prob = client.get(f"/datasets/{DS}/stations", params={"problem_only": True}).json()
    assert all(s["problems"] or s["misleading"] for s in prob["stations"])
    assert client.get(f"/datasets/{DS}/stations", params={"snapshot": "nope"}).status_code == 404
    assert client.get("/datasets/nope/stations").status_code == 404


def test_station_detail_and_heatmap():
    s = client.get(f"/datasets/{DS}/stations/S07").json()
    assert len(s["docks"]["grid"]) == s["total_docks"]
    h = client.get(f"/datasets/{DS}/heatmap", params={"metric": "fill"}).json()
    assert len(h["percent"]) == 7 and len(h["percent"][0]) == 24


def test_xbar_matches_review():
    x = client.get(f"/datasets/{DS}/xbar", params={"scope": "district:Northside"}).json()
    assert x["grand_mean"] == pytest.approx(45.3, abs=0.01)
    assert x["sigma_short"] == pytest.approx(10.52, abs=0.01)
    mon8 = next(p for p in x["points"] if p["label"] == "Mon 08:00")
    assert mon8["n"] == 15 and mon8["out"]


def test_other_reads():
    assert client.get(f"/datasets/{DS}/imr").json()["n_baseline"] > 0
    assert client.get(f"/datasets/{DS}/pchart").json()["window"] == "off_peak"
    assert len(client.get(f"/datasets/{DS}/fmea").json()["rows"]) == 6
    assert client.get(f"/datasets/{DS}/reliability", params={"station": "S07"}).json()["station"] == "S07"
    assert "moves" in client.get(f"/datasets/{DS}/dispatch").json()
    assert "mttr_min" in client.get(f"/datasets/{DS}/maintenance").json()
    assert client.get(f"/datasets/{DS}/events", params={"kind": "stockout", "limit": 3}).json()["events"][0]["kind"] == "stockout"
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


def test_compute_imr_pchart():
    r = client.post("/compute/imr", json={"baseline": [10, 12, 14, 12], "monitor": [20]}).json()
    assert r["ucl"] == pytest.approx(17.319, abs=1e-3) and r["mr_ucl"] == pytest.approx(6.534)
    assert r["points"][-1]["out"]
    assert client.post("/compute/imr", json={"baseline": [5]}).status_code == 422
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
