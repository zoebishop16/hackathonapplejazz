# Dock Watch: a bikeshare dock-availability QC REST API and dashboard

**REST API (FastAPI) on Posit Connect:** https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/
- Interactive API docs (try every endpoint): https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/docs
- Dashboard: https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/dashboard/
- Health check: https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/health
**Dashboard on GitHub Pages:** https://zoebishop16.github.io/hackathonapplejazz/
**Prompt:** Urban Systems: Bikeshare Fleets (Cornell Six Sigma Hackathon, on-campus track)

At rush hour a city bikeshare runs out of bikes in residential districts and
out of docks downtown, and maintenance vans are sent out blind. Dock Watch is
for the **network planner or analyst** (with a dispatcher view for the van
crew lead). It shows which stations are unusable, when and where, which dock
counts are misleading, which stations will hit empty or full in the next hour,
and which van should move bikes where. It also runs the quality-control
analysis behind those calls: an FMEA, control charts and reliability models.
Every result is available as a **public REST API**, and the `/compute/...`
endpoints run the same tested statistics on your own numbers.

All data is **synthetic**: 30 stations at real Boston locations in 6
neighborhoods, 8 vans, polled every 5 minutes for 3 weeks ([codebook](data/README.md)).

## Run it (one command)

Once, with Python 3.11:

```bash
python3.11 -m venv .venv && .venv/bin/pip install -r tests/requirements.txt
```

Then:

```bash
.venv/bin/python app/testme.py
```

Open http://localhost:8000/docs for the API (try any endpoint with **Try it
out**) and http://localhost:8000/dashboard/ for the dashboard. Ctrl+C stops it.

Run the tests (statistics, API and the browser calculator):

```bash
.venv/bin/python -m pytest tests -q && node tests/test_calc_js.mjs
```

Rebuild the datasets (optional; they are committed): `python3 scripts/generate_data.py`,
then check every data rule: `python3 scripts/validate_data.py`.

## The REST API

Full endpoint list with example bodies: [`app/README.md`](app/README.md).

| Kind | Endpoints |
|---|---|
| about | `GET /`, `GET /health`, `GET /docs` |
| test datasets | `GET /datasets`, then `/datasets/{id}/` + `stations`, `stations/{station}`, `heatmap`, `forecast`, `dispatch`, `maintenance`, `xbar`, `imr`, `pchart`, `fmea`, `reliability` |
| your own numbers | `POST /compute/` + `fill`, `stockouts`, `xbar`, `pchart`, `fmea`, `reliability`, `availability`, `forecast` |

Example: is a station's "full" real?

```bash
curl -X POST http://localhost:8000/compute/fill -H "content-type: application/json" \
  -d '{"total_docks": 12, "docks_disabled": 4, "bikes_available": 6}'
```

returns effective capacity 8, fill 75% ("high"), naive fill 50%, and the flag
`looks_emptier`: the 4 broken docks hide how full it really is.

## The four pages

| Page | What it shows | How to read it |
|---|---|---|
| **Map** | a street map of Boston (OpenStreetMap) with every station colored *and shaped* by fill level, and the 8 vans; filters by district, status, time of last update, open docks, problem stations only; click a station for fill %, bikes, effective capacity, broken docks. Below it, the hour × weekday heatmap with the same filters | ▽ red empty, ◇ orange low, ● green medium, ■ blue high, ▲ purple full, ✕ dark gray out of service; a dashed ring marks a problem station, `!` a misleading fill. Dark weekday 7-9 AM and 4-6 PM heatmap cells are the rush pattern |
| **Dispatch** | the forecast first: every station ranked by priority, projected bikes at +30 min, 1 h, 1.5 h and 2 h, at-risk rows in red, checked against what happened. Then recommended pickup → drop-off moves, a form to create a rebalancing task by hand, a task queue with Repair and Rebalancing tabs, and van status | only available vans (idle, not already assigned, with room for the bikes) are offered, nearest to the pick-up first; assignments are saved in your browser |
| **Maintenance** | dock-health percentages (broken docks, broken bikes, effective capacity, misleading fill, repeat offenders), mean time to repair and backlog, and a table with a square for every dock (bike, broken bike, open, faulty ×, bike stuck !, never locks ∅) | ⚠ before a station name = misleading fill; the right-hand column is the repeat-offender report (3+ unplanned repairs and at least twice the network median) |
| **Data Analysis** | tabs: FMEA (editable S/O/D, Pareto by RPN) and Control Charts (daily X-bar, p-chart) | under each chart: the formula, how many points fall outside, and what the subgroup is |

The top bar on every page has the dataset, the snapshot time ("now" in the
replay: Wed 08:15, Wed 12:00, Wed 17:30 or Sat 13:00 of week 3) and a
"last updated" freshness pill. There are no logins or roles.

## Inputs

| File | One row per | Key columns |
|---|---|---|
| `status.csv` | station per 5-minute poll | bikes available/disabled, docks available/disabled, status, last_reported |
| `stations.csv` | station | district (Boston neighborhood), total_docks, lat/lon |
| `dock_faults.csv` | broken-dock episode | dock_id, state, start, end |
| `work_orders.csv` | van job | type, fault, opened/assigned/arrived/resolved, response_min |
| `vans.csv` | van | capacity, depot |

Units and meanings for every column: [`data/README.md`](data/README.md). A
real system would get the first two from its public GBFS feed.

## The statistics (all in [`app/qc.py`](app/qc.py))

| Function | What it computes |
|---|---|
| `effective_capacity(total, disabled)` | total docks − broken docks |
| `fill_pct(bikes, capacity)`, `fill_category(...)` | bikes ÷ effective capacity; empty 0%, low 1-29%, medium 30-69%, high 70-99%, full 100% |
| `misleading_flag(...)` | full only because docks are broken; "bikes" that are all broken; or looks emptier when broken docks count as capacity |
| `event_log(polls)` | stockout / fullout episodes in one station's polls (API `/compute/stockouts` only) |
| `xbar_chart(subgroups)` | X̿ = mean of subgroup means; σ_short = √(mean within-subgroup variance); limits X̿ ± 3σ_short/√n per subgroup |
| `p_chart(baseline, monitor)` | p̄ ± 3√(p̄(1−p̄)/n), LCL floored at 0 |
| `rpn`, `occurrence_score`, `pareto` | RPN = S × O × D; observed rate → occurrence 1-10; Pareto order |
| `median`, `repeat_offender_threshold` | repairs needed to be a repeat offender: max(3, 2 × network median) |
| `series`, `parallel`, `availability`, `mtbf_mttr` | R₁R₂…; 1 − Π(1 − Rᵢ); MTBF/(MTBF + MTTR) (API only) |
| `forecast_bikes(...)` | bikes now + (historical fill later − historical fill now) × capacity, at +30 min, 1 h, 1.5 h, 2 h |

How the charts are set up:
- **Daily X-bar** of % docks open: one subgroup per day (21 days); each
  observation is one station's average for one clock hour of that day, so a
  subgroup holds 24 × stations values. The rush swings sit inside each day, so
  a day outside the limits ran unusually full or empty overall.
- **p-chart** of the share of stations unusable per poll (n = 30): limits from
  Tuesday, Thursday plotted; a fixed 10:00-15:00 window avoids the rush
  signal. The y-axis starts at 0.

Every function has a known-answer and a degenerate test in
[`tests/test_qc.py`](tests/test_qc.py) (numbers in [SPEC.md](SPEC.md) section 4).
The in-browser FMEA calculator uses [`app/site/calc.js`](app/site/calc.js),
tested against the same answers in [`tests/test_calc_js.mjs`](tests/test_calc_js.mjs).

Assumptions: observations within a subgroup are independent; the Tuesday
baseline is in control; reliability blocks fail independently (the station
page shows the observed joint rate to check this); open tickets are left out
of MTTR (no censoring correction) and counted as backlog.

## Deploy

- **Posit Connect (the API).** On every push, `.github/workflows/deploy-fastapi.yml`
  checks the committed `app/manifest.json`, imports the app, uploads the bundle
  and waits for `/health` to answer. It needs two repo secrets, `CONNECT_SERVER`
  and `CONNECT_API_KEY` (handed out at the event; set them in Settings → Secrets
  and variables → Actions, never in a file). From your machine instead:
  `PYTHON=$PWD/.venv/bin/python bash app/deployme.sh`.
- After changing anything in `app/` or `data/`, run `PYTHON=$PWD/.venv/bin/python bash app/manifestme.sh`
  and commit `app/manifest.json` and `app/site/data/`.
- **GitHub Pages (dashboard only).** `.github/workflows/pages.yml` tests, rebuilds
  and publishes `app/site/` (Settings → Pages → Source: GitHub Actions).

## Demo

[`demo/README.md`](demo/README.md) walks through every dataset with the
numbers you should see.

## Repo layout

```
app/qc.py            every statistic (standard library only)
app/app.py           the FastAPI REST API (+ serves the dashboard)
app/build.py         data/ -> app/site/data/*.json, calling qc.py
app/testme.py        build + run the API on localhost:8000
app/manifestme.sh, app/deployme.sh, app/manifest.json   Posit Connect deploy
app/site/            the static dashboard (index.html, app.js, calc.js, styles.css)
data/                4 synthetic datasets + codebook
scripts/generate_data.py   the dataset generator (seeded)
tests/               pytest + node tests
.github/workflows/deploy-fastapi.yml  publish the API to Posit Connect on every push
.github/workflows/pages.yml  test, build and publish the dashboard to GitHub Pages
SPEC.md, CONTRACT.yaml, docs/plan.md   what we built and why
```

The hackathon's own pages (schedule, rubric, prompts) are in [`docs/`](docs/README.md).

## Credits

Built with Claude Code from the team's design document. Course methods from
the SYSEN 5300 textbook, https://timothyfraser.com/sigma/. GBFS field names
follow https://gbfs.org/. The API uses FastAPI, uvicorn and pydantic; the statistics use only the Python standard library. The Connect workflow is adapted from timothyfraser/fastapi-connect-demo (MIT).
