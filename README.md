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
neighborhoods, 8 vans, polled every 5 minutes for 3 weeks, with commuters
riding into the city in the morning and home in the evening, and vans
rebalancing gradually overnight ([codebook](data/README.md)).

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
| test datasets | `GET /datasets`, then `/datasets/{id}/` + `overview`, `stations`, `stations/{station}`, `heatmap`, `forecast`, `dispatch`, `maintenance`, `xbar`, `imr`, `pchart`, `fmea`, `reliability` |
| your own numbers | `POST /compute/` + `fill`, `stockouts`, `xbar`, `pchart`, `fmea`, `reliability`, `availability`, `forecast` |

Example: is a station's "full" real?

```bash
curl -X POST http://localhost:8000/compute/fill -H "content-type: application/json" \
  -d '{"total_docks": 12, "docks_disabled": 4, "bikes_available": 6}'
```

returns effective capacity 8, fill 75% ("high"), naive fill 50%, and the flag
`looks_emptier`: the 4 broken docks hide how full it really is.

## The seven pages

The site opens on the **Network Overview**; click **Dock Watch** at the top
left from any page to return to it.

| Page | What it shows | How to read it |
|---|---|---|
| **Network Overview** | what is going wrong right now, where, and where to go next: a status strip (empty, full and out-of-service stations now, % of docks available), the top 5 stations at risk, and one card per page with its key number | red rows are high priority; Risk % = how often the station was empty, full or out of service in the next 2 hours at this weekday and time in earlier weeks (100% when it already is); click a row to open the station on the map |
| **Map** | a muted street map of Boston (OpenStreetMap, desaturated so markers stand out) with every station colored *and shaped* by fill level, and the 8 vans; filters by district, status, time of last update, open docks, problem stations only; click a station for fill %, bikes, effective capacity, broken docks. Below it, the hour × weekday heatmap with the same filters | ▽ red empty, ◇ orange low, ● green medium, ■ blue high, ▲ purple full, ✕ dark gray out of service; a dashed ring marks a problem station, `!` a misleading fill. Dark weekday 7-9 AM and 4-6 PM heatmap cells are the rush pattern |
| **Dispatch** | the forecast first (subheading: ranked by priority, then expected impact; offline stations and broken docks are ranked in too, the same order the Overview uses): every station ranked by priority, projected bikes at +30 min, 1 h, 1.5 h and 2 h, at-risk rows in red, checked against what happened. Then light-blue summary boxes (moves, open tasks, vans available, resolution time), recommended pickup → drop-off moves, a form to create a rebalancing task by hand, a task queue with Repair and Rebalancing tabs, and van status | only available vans (idle, not already assigned, with room for the bikes) are offered, nearest to the pick-up first; assignments are saved in your browser |
| **Maintenance** | light-blue dock-health percentage boxes (broken docks, broken bikes, effective capacity, misleading fill, repeat offenders) and a table with a square for every dock (bike, broken bike, open, faulty ×, bike stuck !, never locks ∅) | ⚠ before a station name = misleading fill; the right-hand column is the repeat-offender report (3+ unplanned repairs and at least twice the network median) |
| **Data Analysis** | tabs: FMEA (editable S/O/D, Pareto by RPN) and Control Charts (X-bar by hourly block, p-chart) | under each chart: the formula, how many points fall outside, and what the subgroup is |

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
| `xbar_chart(subgroups, constant_limits)` | X̿ = mean of subgroup means; σ_short = √(mean within-subgroup variance); limits X̿ ± 3σ_short/√n, with n per subgroup or, as the dashboard uses, the most common n (`most_common_n`) for flat limits |
| `p_chart(baseline, monitor, constant_limits)` | p̄ ± 3√(p̄(1−p̄)/n), LCL floored at 0; n per point or the most common n |
| `rpn`, `occurrence_score`, `pareto` | RPN = S × O × D; observed rate → occurrence 1-10; Pareto order |
| `median`, `repeat_offender_threshold` | repairs needed to be a repeat offender: max(3, 2 × network median) |
| `series`, `parallel`, `availability`, `mtbf_mttr` | R₁R₂…; 1 − Π(1 − Rᵢ); MTBF/(MTBF + MTTR) (API only) |
| `network_summary(stations)` | Overview status strip: empty (0 rentable bikes), full (0 open docks), out of service, stations with broken docks, % of docks available |
| `risk_pct(flags)`, `rank_at_risk(items)` | Risk % from earlier weeks; one ranking (urgency, then impact, then risk %) shared by Overview and Dispatch |
| `forecast_bikes(...)` | bikes now + (historical fill later − historical fill now) × capacity, at +30 min, 1 h, 1.5 h, 2 h |

How the charts are set up:
- **X-bar by hourly block** of % docks open: one subgroup per hour
  (00:01-01:00, 01:01-02:00, ... 23:01-24:00; 24 a day, 504 in all); each observation is one
  station's % open docks at one 5-minute poll, so a block holds 12 × stations
  values. The limits are one flat pair from the most common n. Rush and night
  blocks sit outside by design (the commuter day); a block that breaks its
  usual weekly pattern is the one to look into.
- **p-chart** of the share of stations unusable per poll (n = 30, the most common n): limits from
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

## Analyst and developer documentation

The top navigation ends with **Docs** (analyst workflow, actual dashboard previews and formula cards) and **About** (Zoe Bishop, Allison Lou, Liliana Nasrallah and Joanna Tan, with supplied headshots and biographies). Click **Dock Watch** to return to Overview.

See the [tool guide](docs/TOOL_GUIDE.md) for setup, inputs, function signatures, parameter defaults, outputs and interpretation limits. Dashboard `#docs` is separate from API `/docs`. Hosting paths are unchanged.

## Documentation map

This README is the project manual: purpose, setup, operation, statistical interpretation, architecture, validation and release process. It is intended to support a fresh clone and an independent review, beyond the website's concise analyst instructions.

| Document | Audience and scope |
| --- | --- |
| [Comprehensive dataset codebook](data/CODEBOOK.md) | Analysts and data engineers: every file/variable, exact file inventories, keys, units, categories, joins, missingness, derivations and proposed real-data collection protocol |
| [Data overview](data/README.md) | Short introduction to the synthetic scenarios and their commuter patterns |
| [Function reference](docs/TOOL_GUIDE.md) | Developers: signatures, parameters, outputs and browser lifecycle |
| [API reference](app/README.md) | API consumers: dataset IDs, snapshot keys, filters and example request bodies; live `/docs` supplies machine-derived schemas |
| [Demonstration](demo/README.md) | Reviewers: expected behavior and example results for all four datasets |
| [Specification](SPEC.md) | Team: agreed scope, methods, assumptions and known answers |
| [Task ledger](CONTRACT.yaml) | Team: ownership, verification commands and completion records |

## Windows setup and static preview

Use an installed Python 3.11 or later for local development; the Connect bundle separately targets Python 3.12.4. Python 3.13 has also passed the repository tests in this workspace. Node.js is needed for JavaScript verification, not for serving the buildless dashboard.

From PowerShell in the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tests/requirements.txt
.\.venv\Scripts\python.exe app/testme.py
```

Open `http://localhost:8000/dashboard/` for the complete app. Use the same Python executable to run tests so dependencies are resolved from the same environment. If Windows redirects `python` to a Store alias, use the full path to the installed interpreter. You do not need to activate the virtual environment when using these explicit paths.

For a dashboard-only preview using the already committed JSON:

```powershell
python -m http.server 8001 --bind 127.0.0.1 --directory app/site
```

Open `http://localhost:8001/`, `http://localhost:8001/#docs` or `http://localhost:8001/#about`. This server does not expose the API. Opening `index.html` directly from disk does not reliably support JSON fetching. Stop either server with Ctrl+C. Do not run both on the same port.

## An analyst session from start to finish

1. Select a dataset and replay snapshot. Compare like times: a normal morning rush and a high-failure morning rush answer a different question from morning versus midday. The snapshot freshness indicator uses the replay clock, not today's date.
2. Open Overview and note service failures before interpreting forecasts. Empty means no rentable bikes; full means no open docks. Inspect out-of-service stations and stale reports even when the visible inventory looks balanced.
3. Follow an at-risk station to the Map. Confirm its district, bikes, available docks, effective capacity and report age. Use filters to narrow the operational area. The heatmap pools three weeks of history and helps identify recurring weekday/hour patterns; it does not show only the selected snapshot.
4. In Dispatch, inspect the ranked forecast and compare proposed pickup/dropoff actions with vehicle capacity and availability. The order is urgency, expected impact, then historical risk; it is not a route optimization solution. An apparently severe warning can still fail to occur because the model uses historical averages.
5. In Maintenance, distinguish a bike shortage from a broken-dock problem. The dock squares reproduce diagnostic states schematically. A station with recurring unplanned repairs may warrant a root-cause investigation rather than repeated dispatch alone.
6. In Data Analysis, review FMEA judgments and control-chart assumptions. Keep a note of edited S/O/D scores and why they changed. A high RPN prioritizes investigation but is not a calibrated probability or monetary loss estimate.
7. Record dataset ID, snapshot, filters, affected stations, observed evidence and proposed action. Browser assignments are a demonstration and do not create an external work order. Share the written decision with colleagues; local browser state is not a shared fleet system.

The Docs page contains the actual map, heatmap and dock-state components alongside concise guidance and formulas. Changing dataset or snapshot updates the examples. External map tiles require internet access; the text, dock tracker, forecast and heatmap remain useful without a basemap.

## Statistical interpretation and reproducibility

The functions in `app/qc.py` are the source of truth. The API calls them directly for custom computations; `app/build.py` calls them while preparing the bundled JSON. UI preview components reuse the generated results. No change to a displayed score, filter or local assignment rewrites the source CSVs.

Fill is occupancy of working docks, including disabled bikes occupying working docks. Rental availability uses rentable bikes only. A station can therefore have nonzero occupancy while being empty from a rider's perspective. Network open-dock percentage uses all installed docks as its denominator, which differs from effective-capacity fill. See the codebook's derived-variable table before comparing percentages from different pages.

X-bar observations are open-dock percentages at station-polls, grouped into hours that close on the hour. The center line is the mean of subgroup means. The estimated short-term spread is the square root of the mean sample variance within groups. Flat limits use the most common subgroup size, with the smaller size breaking a tie. Unequal group sizes and serial dependence affect interpretation; the limits do not remove time-of-day demand. Constant groups produce a message instead of invented nonzero limits.

The p-chart treats each station-poll as an opportunity for unusable service. Tuesday provides the baseline proportion; Thursday is monitoring. Off-peak comparisons reduce the regular rush-hour signal. A boundary baseline proportion of zero or one collapses limits and requires interpretation of the returned message. The normal approximation and independence assumptions should be checked before applying this approach to an operator's feed.

Historical risk uses only comparable earlier weeks. The forecast adds historical average change to current bikes and clamps the result to physical capacity. Neither is a trained predictive model with an evaluated confidence interval. The synthetic generator models stations independently and allows a depot float; it does not conserve the exact citywide bicycle total. These demonstrations establish reproducible behavior, not estimates of Boston's actual operations.

Reliability and availability are exposed through the API. Series and parallel models assume independent components. MTBF and MTTR must share time units when used for availability. Completed-repair averages omit open tickets; report backlog as well to avoid describing only resolved work.

## Adapting the tool to an operator's data

Read [the collection protocol and schema](data/CODEBOOK.md) before importing real exports. Maintain a separate raw archive, record timezone and source report time, normalize operator status categories, retain inventory changes, and reconcile whether disabled bike/dock categories overlap. Keep missing polls distinct from genuine empty stations. The current builder expects complete typed CSV columns and does not provide an interactive upload/cleaning workflow.

Preserve stable station and vehicle IDs and validate every foreign-key reference. Real unresolved tickets need an explicit ingestion rule; blank timestamps are not accepted by the current CSV parser. Add source-specific checks rather than assuming the synthetic-data validation covers all production cases. Do not use the two simulation seeds as independent real-world evidence. Collect enough representative history to evaluate forecast errors and chart assumptions before operational reliance.

## Verification and troubleshooting

Run from the repository root after installing test dependencies:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
node tests/test_calc_js.mjs
node app/check_h09.mjs
.\.venv\Scripts\python.exe scripts/validate_data.py
```

The Python suite checks known-answer/degenerate statistics and API responses. The calculator checks compare the browser formulas to expected results. The guide checks exercise navigation, data-independent help and all 16 bundled snapshot combinations. They do not replace visual browser review of layout, Leaflet tiles or image crops. The data validator checks the committed simulation's design rules.

| Symptom | What to check |
| --- | --- |
| Public site still has the old layout | Local changes require a commit, push and successful hosting workflow; refresh with Ctrl+Shift+R after deployment |
| No station data | Serve over HTTP; confirm `app/site/data/index.json` exists; run `python app/build.py` if rebuilding is needed |
| API reports 404 for a dataset/snapshot | Use `GET /datasets` for the accepted IDs and snapshot keys |
| API reports 422 | Read the validation message in the response; use counts, proportions and time units defined in `/docs` |
| Map blank but other views work | Check Leaflet CDN and street-tile access; a map warning distinguishes network failures from dataset failures |
| Assignments differ on a colleague's computer | Assignment state is stored locally in each browser; it is not synchronized |
| Test command cannot import a dependency | Install `tests/requirements.txt` with the same Python interpreter used for pytest |

## Release checklist and team

Review the diff, run the checks, update generated JSON if input/build behavior changed, and refresh Connect manifest checksums when bundled application files change. Stage explicit paths. Commit/push after team approval, then inspect the existing GitHub Actions workflows. GitHub Pages serves the static dashboard and Connect serves the API and dashboard; deploying one should not be mistaken for verification of the other. Existing public paths remain unchanged. Keep credentials in environment/repository secrets.

The team is **Zoe Bishop, Allison Lou, Liliana Nasrallah and Joanna Tan**, members of Cornell University's Systems Engineering and Six Sigma for the Design and Operation of Reliable Systems Course. Their supplied biographies and portraits appear on About. This repository contains synthetic operational data and team-provided portraits; it contains no real rider records. Preserve source/library attribution when adapting the project.
