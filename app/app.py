"""Dock Watch REST API (FastAPI).

Two kinds of endpoint, both thin wrappers around app/qc.py:

- GET  /datasets/...  results for the four test datasets in data/, read from
  the JSON that build.py writes with qc.py (site/data/*.json).
- POST /compute/...   run a statistic on numbers you send (your own data).

Also serves the dashboard at /dashboard/ and interactive docs at /docs.
Run locally from the repo root: python3 app/testme.py
"""

import json
import os
import sys
from functools import lru_cache
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # on Posit Connect the bundle root is this folder

import qc  # noqa: E402

DATA_DIR = os.path.join(HERE, "site", "data")

app = FastAPI(
    title="Dock Watch API",
    description=(
        "Bikeshare dock availability and quality control (synthetic data). "
        "GET /datasets/... returns results for the four test datasets; "
        "POST /compute/... runs the same tested statistics on your own numbers. "
        "The dashboard is at /dashboard/."
    ),
    version="1.0.0",
)
# Public, read-only demo API: any origin may call it.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def revalidate_dashboard(request, call_next):
    """Make browsers re-check dashboard files on every visit, so an update is never hidden by a stale cache."""
    response = await call_next(request)
    if request.url.path.startswith("/dashboard"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# ------------------------------------------------------------------ loading

@lru_cache(maxsize=None)
def _index():
    path = os.path.join(DATA_DIR, "index.json")
    if not os.path.exists(path):
        raise HTTPException(503, "No built data. Run python3 app/build.py first.")
    with open(path) as fh:
        return json.load(fh)


@lru_cache(maxsize=8)
def _dataset(dataset_id):
    if dataset_id not in {d["id"] for d in _index()}:
        raise HTTPException(404, f"Unknown dataset '{dataset_id}'. See GET /datasets.")
    with open(os.path.join(DATA_DIR, f"{dataset_id}.json")) as fh:
        return json.load(fh)


def snapshot_key(label):
    """'Wed 08:15 (morning rush)' -> 'wed-0815'."""
    day, hhmm = label.split()[:2]
    return f"{day.lower()}-{hhmm.replace(':', '')}"


def _snap(d, snapshot):
    labels = d["meta"]["snapshots"]
    if snapshot is None:
        return labels[0], d["snapshots"][labels[0]]
    for lab in labels:
        if snapshot in (lab, snapshot_key(lab)):
            return lab, d["snapshots"][lab]
    raise HTTPException(404, f"Unknown snapshot '{snapshot}'. Use one of {[snapshot_key(l) for l in labels]}.")


def _stations(d):
    return {s["station_id"]: s for s in d["stations"]}


def _problem(r):
    return bool(r["problems"]) or bool(r["misleading"])


def _filter(d, rows, district, status, max_feed_age, stale_only, min_open_docks, problem_only):
    info = _stations(d)
    out = []
    for r in rows:
        if district and info[r["id"]]["district"] not in district:
            continue
        if status and r["category"] not in status:
            continue
        if max_feed_age is not None and r["feed_age_min"] > max_feed_age:
            continue
        if stale_only and not r["feed_age_min"] > d["meta"]["stale_min"]:
            continue
        if r["docks_available"] < min_open_docks:
            continue
        if problem_only and not _problem(r):
            continue
        out.append(r)
    return out


def _check(fn, *args, **kwargs):
    """Run a qc function; its ValueErrors become HTTP 422 with the message."""
    try:
        return fn(*args, **kwargs)
    except ValueError as err:
        raise HTTPException(422, str(err))


SnapshotQ = Query(None, description="Snapshot key, e.g. wed-0815, wed-1200, wed-1730, sat-1300 (default: the first).")
DistrictQ = Query(None, description="Repeat to allow several: Downtown, Northside, Eastside, Waterfront.")
StatusQ = Query(None, description="Fill category: empty, low, medium, high, full, out_of_service. Repeat for several.")


# -------------------------------------------------------------------- basics

@app.get("/", tags=["about"])
def root():
    """What this API is and where to start."""
    return {"name": "Dock Watch API", "docs": "/docs", "dashboard": "/dashboard/", "health": "/health",
            "datasets": "/datasets", "data": "synthetic: 20 stations, 4 districts, 5-minute polls, 3 weeks"}


@app.get("/health", tags=["about"])
def health():
    """Liveness check: answers ok and how many datasets are loaded."""
    return {"status": "ok", "datasets": len(_index())}


@app.get("/__docs__/", include_in_schema=False)
def docs_redirect():
    return RedirectResponse(url="/docs")


# ------------------------------------------------------------ dataset reads

@app.get("/datasets", tags=["datasets"])
def datasets():
    """The four test datasets and their snapshot times."""
    out = []
    for item in _index():
        d = _dataset(item["id"])
        out.append({**item, "start": d["meta"]["start"], "end": d["meta"]["end"],
                    "snapshots": [{"key": snapshot_key(l), "label": l} for l in d["meta"]["snapshots"]]})
    return out


@app.get("/datasets/{dataset_id}/stations", tags=["datasets"])
def stations(dataset_id: str, snapshot: Optional[str] = SnapshotQ, district: Optional[List[str]] = DistrictQ,
             status: Optional[List[str]] = StatusQ,
             max_feed_age: Optional[float] = Query(None, description="Only feeds updated within this many minutes."),
             stale_only: bool = Query(False, description="Only stale feeds (older than 15 min)."),
             min_open_docks: int = Query(0, ge=0, description="Only stations with at least this many open docks."),
             problem_only: bool = Query(False, description="Only problem stations.")):
    """Every station at a snapshot: fill %, category, bikes, effective capacity, broken docks, flags.

    The same filters as the Live Map: district, status, time of last update,
    open docks, problem stations only.
    """
    d = _dataset(dataset_id)
    label, snap = _snap(d, snapshot)
    info = _stations(d)
    rows = _filter(d, snap["stations"], district, status, max_feed_age, stale_only, min_open_docks, problem_only)
    return {"dataset": dataset_id, "snapshot": label, "time": snap["time"], "count": len(rows),
            "stations": [{**info[r["id"]], **r} for r in rows]}


@app.get("/datasets/{dataset_id}/stations/{station_id}", tags=["datasets"])
def station(dataset_id: str, station_id: str, snapshot: Optional[str] = SnapshotQ):
    """One station: its state, its per-dock grid, its forecast and reliability."""
    d = _dataset(dataset_id)
    label, snap = _snap(d, snapshot)
    row = next((r for r in snap["stations"] if r["id"] == station_id), None)
    if row is None:
        raise HTTPException(404, f"Unknown station '{station_id}'.")
    fc = next((f for f in snap["forecast"] if f["id"] == station_id), None)
    return {"snapshot": label, **_stations(d)[station_id], **row, "docks": snap["docks"][station_id],
            "forecast": fc, "reliability": d["reliability"]["stations"][station_id],
            "repair_tickets": [o for o in d["orders"] if o["station"] == station_id and o["type"] == "repair"
                               and o["opened"] <= snap["time"]]}


HEAT = {"empty": ("empty", "active_n"), "full": ("full", "active_n"),
        "unusable": ("unusable", "n"), "fill": ("fill_sum", "active_n")}


@app.get("/datasets/{dataset_id}/heatmap", tags=["datasets"])
def heatmap(dataset_id: str, metric: Literal["empty", "full", "unusable", "fill"] = "empty",
            snapshot: Optional[str] = SnapshotQ, district: Optional[List[str]] = DistrictQ,
            status: Optional[List[str]] = StatusQ, max_feed_age: Optional[float] = None,
            stale_only: bool = False, min_open_docks: int = Query(0, ge=0), problem_only: bool = False):
    """Hour x weekday grid (7 rows Mon-Sun, 24 columns) of a percent over all 3 weeks.

    empty / full = % of active polls with 0 bikes / 0 open docks; unusable = %
    of all polls empty, full or out of service; fill = average fill %. Pooled
    over the stations that pass the filters (status filters use the snapshot).
    """
    d = _dataset(dataset_id)
    _, snap = _snap(d, snapshot)
    ids = [r["id"] for r in _filter(d, snap["stations"], district, status, max_feed_age, stale_only,
                                    min_open_docks, problem_only)]
    num_k, den_k = HEAT[metric]
    grid = []
    for day in range(7):
        row = []
        for h in range(24):
            k = day * 24 + h
            num = sum(d["heatmap"][i][num_k][k] for i in ids)
            den = sum(d["heatmap"][i][den_k][k] for i in ids)
            row.append(round(100 * num / den, 2) if den else None)
        grid.append(row)
    return {"metric": metric, "stations": ids, "rows": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
            "columns": list(range(24)), "percent": grid}


@app.get("/datasets/{dataset_id}/forecast", tags=["datasets"])
def forecast(dataset_id: str, snapshot: Optional[str] = SnapshotQ, at_risk_only: bool = True):
    """At-risk list for the next 30-60 minutes, ranked by urgency then impact."""
    label, snap = _snap(_dataset(dataset_id), snapshot)
    rows = [f for f in snap["forecast"] if f["urgency"] > 0 or not at_risk_only]
    return {"snapshot": label, "method": "projected = bikes now + (historical fill at +m - historical fill now) x capacity",
            "stations": rows}


@app.get("/datasets/{dataset_id}/dispatch", tags=["datasets"])
def dispatch(dataset_id: str, snapshot: Optional[str] = SnapshotQ):
    """Recommended pickup -> drop-off moves, repair and rebalancing queues, van status."""
    d = _dataset(dataset_id)
    label, snap = _snap(d, snapshot)
    orders = {o["id"]: o for o in d["orders"]}
    return {"snapshot": label, "moves": snap["moves"],
            "queues": {k: [orders[i] for i in v] for k, v in snap["tasks"].items()},
            "vans": snap["vans"], "time_to_resolution": snap["resolution"]}


@app.get("/datasets/{dataset_id}/maintenance", tags=["datasets"])
def maintenance(dataset_id: str, snapshot: Optional[str] = SnapshotQ, station: Optional[str] = None):
    """Mean time to repair, backlog, repeat offenders, and the repair tickets opened so far."""
    d = _dataset(dataset_id)
    label, snap = _snap(d, snapshot)
    now = snap["time"]
    tickets = []
    for o in d["orders"]:
        if o["type"] != "repair" or o["opened"] > now or (station and o["station"] != station):
            continue
        st = "resolved" if o["resolved"] <= now else ("in progress" if o["arrived"] <= now else
                                                      "assigned" if o["assigned"] <= now else "opened")
        tickets.append({**o, "status": st})
    return {"snapshot": label, **snap["maintenance"], "tickets": tickets}


@app.get("/datasets/{dataset_id}/xbar", tags=["control charts"])
def xbar(dataset_id: str, scope: str = Query("network",
                                             description="network, district:<name>, or a station id like S07")):
    """Daily averages (X-bar) chart of % docks open; subgroup = one day.

    Observations = each station's hourly average that day. UCL, LCL = grand
    mean +/- 3 sigma_short / sqrt(n); sigma_short = sqrt(mean of
    within-subgroup variances).
    """
    d = _dataset(dataset_id)
    if scope not in d["xbar"]:
        raise HTTPException(404, f"Unknown scope '{scope}'. Use one of {list(d['xbar'])}.")
    return {"scope": scope, **d["xbar"][scope]}


@app.get("/datasets/{dataset_id}/pchart", tags=["control charts"])
def pchart(dataset_id: str, window: Literal["off_peak", "all_day"] = "off_peak"):
    """p-chart of the share of stations unusable per poll (n = 20); Tuesday limits, Thursday plotted."""
    return {"window": window, **_dataset(dataset_id)["pchart"][window]}


@app.get("/datasets/{dataset_id}/fmea", tags=["analysis"])
def fmea(dataset_id: str):
    """FMEA rows (S, O from data, D, RPN) and the Pareto order."""
    return _dataset(dataset_id)["fmea"]


@app.get("/datasets/{dataset_id}/reliability", tags=["analysis"])
def reliability(dataset_id: str, station: Optional[str] = None):
    """Per-station reliabilities (bike, dock, feed, kiosk, docks), MTBF, MTTR, availability; network totals."""
    rel = _dataset(dataset_id)["reliability"]
    if station:
        if station not in rel["stations"]:
            raise HTTPException(404, f"Unknown station '{station}'.")
        return {"station": station, **rel["stations"][station]}
    return rel


# --------------------------------------------------- compute on your numbers

class FillIn(BaseModel):
    total_docks: int = Field(..., ge=0, examples=[12])
    docks_disabled: int = Field(0, ge=0, examples=[4])
    bikes_available: int = Field(..., ge=0, examples=[6])
    bikes_disabled: int = Field(0, ge=0, examples=[0])


@app.post("/compute/fill", tags=["compute"])
def compute_fill(body: FillIn):
    """Effective capacity, fill %, fill category and misleading-fill flag for one station reading."""
    eff = _check(qc.effective_capacity, body.total_docks, body.docks_disabled)
    bikes = body.bikes_available + body.bikes_disabled
    if bikes > eff:
        raise HTTPException(422, "bikes_available + bikes_disabled cannot exceed effective capacity")
    docks_available = eff - bikes
    return {"effective_capacity": eff, "docks_available": docks_available,
            "fill_pct": qc.fill_pct(bikes, eff), "category": qc.fill_category(bikes, eff),
            "naive_fill_pct": qc.fill_pct(bikes, body.total_docks) if body.total_docks else None,
            "misleading": qc.misleading_flag(body.bikes_available, body.bikes_disabled,
                                             docks_available, body.docks_disabled)}


class Poll(BaseModel):
    time: str
    bikes_available: int = Field(..., ge=0)
    docks_available: int = Field(..., ge=0)
    in_service: bool = True


class PollsIn(BaseModel):
    polls: List[Poll] = Field(..., examples=[[
        {"time": "08:00", "bikes_available": 3, "docks_available": 9},
        {"time": "08:05", "bikes_available": 0, "docks_available": 12},
        {"time": "08:10", "bikes_available": 0, "docks_available": 12},
        {"time": "08:15", "bikes_available": 2, "docks_available": 10}]])
    poll_minutes: int = Field(5, ge=1)


@app.post("/compute/stockouts", tags=["compute"])
def compute_stockouts(body: PollsIn):
    """Stockout / fullout episodes from one station's polls, in time order."""
    return qc.event_log([(p.time, p.bikes_available, p.docks_available, p.in_service) for p in body.polls],
                        poll_minutes=body.poll_minutes)


class Subgroup(BaseModel):
    label: str
    values: List[float]


class XbarIn(BaseModel):
    subgroups: List[Subgroup] = Field(..., examples=[[{"label": "A", "values": [10, 20, 30]},
                                                      {"label": "B", "values": [40, 50, 60]}]])


@app.post("/compute/xbar", tags=["compute"])
def compute_xbar(body: XbarIn):
    """Averages chart: grand mean, sigma_short = sqrt(mean within-subgroup variance), limits per subgroup."""
    return _check(qc.xbar_chart, [(s.label, s.values) for s in body.subgroups])


class Count(BaseModel):
    defectives: int = Field(..., ge=0)
    n: int = Field(..., ge=0)


class PIn(BaseModel):
    baseline: List[Count] = Field(..., examples=[[{"defectives": 2, "n": 20}] * 5])
    monitor: List[Count] = Field(default_factory=list, examples=[[{"defectives": 7, "n": 20}]])


@app.post("/compute/pchart", tags=["compute"])
def compute_pchart(body: PIn):
    """p-chart: p-bar from the baseline; limits p-bar +/- 3 sqrt(p-bar(1 - p-bar)/n), LCL floored at 0."""
    for c in body.baseline + body.monitor:
        if c.defectives > c.n:
            raise HTTPException(422, "defectives cannot exceed n")
    return _check(qc.p_chart, [(c.defectives, c.n) for c in body.baseline],
                  [(c.defectives, c.n) for c in body.monitor])


class Mode(BaseModel):
    name: str
    severity: int
    occurrence: Optional[int] = None
    occurrence_rate: Optional[float] = Field(None, description="Observed rate 0-1; used when occurrence is missing.")
    detection: int


class FmeaIn(BaseModel):
    modes: List[Mode] = Field(..., examples=[[
        {"name": "Station empty", "severity": 7, "occurrence_rate": 0.012, "detection": 3},
        {"name": "Silent feed", "severity": 6, "occurrence": 3, "detection": 9}]])


@app.post("/compute/fmea", tags=["compute"])
def compute_fmea(body: FmeaIn):
    """RPN = S x O x D for each mode (O from occurrence_rate if not given), plus the Pareto order."""
    rows = []
    for m in body.modes:
        if m.occurrence is None and m.occurrence_rate is None:
            raise HTTPException(422, f"{m.name}: give occurrence or occurrence_rate")
        o = m.occurrence if m.occurrence is not None else _check(qc.occurrence_score, m.occurrence_rate)
        rows.append({"name": m.name, "S": m.severity, "O": o, "D": m.detection,
                     "rpn": _check(qc.rpn, m.severity, o, m.detection)})
    return {"modes": rows, "pareto": _check(qc.pareto, [(r["name"], r["rpn"]) for r in rows])}


class ReliabilityIn(BaseModel):
    structure: Literal["series", "parallel"] = "series"
    reliabilities: List[float] = Field(..., examples=[[0.9, 0.8]])


@app.post("/compute/reliability", tags=["compute"])
def compute_reliability(body: ReliabilityIn):
    """Series R = R1 x R2 x ...; parallel R = 1 - (1 - R1)(1 - R2)..."""
    fn = qc.series if body.structure == "series" else qc.parallel
    return {"structure": body.structure, "R": _check(fn, *body.reliabilities)}


class AvailIn(BaseModel):
    mtbf: float = Field(..., examples=[95])
    mttr: float = Field(..., examples=[5])


@app.post("/compute/availability", tags=["compute"])
def compute_availability(body: AvailIn):
    """A = MTBF / (MTBF + MTTR), same time units for both."""
    return {"availability": _check(qc.availability, body.mtbf, body.mttr)}


class ForecastIn(BaseModel):
    bikes_now: float = Field(..., ge=0, examples=[4])
    capacity: int = Field(..., examples=[10])
    hist_fill_now: float = Field(..., ge=0, le=1, examples=[0.5])
    hist_fill_later: float = Field(..., ge=0, le=1, examples=[0.2])
    margin: Optional[float] = Field(None, description="Warning margin in bikes; default 10% of capacity, at least 1.")


@app.post("/compute/forecast", tags=["compute"])
def compute_forecast(body: ForecastIn):
    """Project bikes ahead from historical average fills; flags empty or full risk."""
    proj, risk = qc.forecast_bikes(body.bikes_now, body.capacity, body.hist_fill_now, body.hist_fill_later, body.margin)
    return {"projected_bikes": proj, "risk": risk}


# ---------------------------------------------------------------- dashboard

if os.path.isdir(os.path.join(HERE, "site")):
    app.mount("/dashboard", StaticFiles(directory=os.path.join(HERE, "site"), html=True), name="dashboard")


@app.get("/dashboard", include_in_schema=False)
def dashboard_slash():
    return RedirectResponse(url="/dashboard/")
