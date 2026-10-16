# Dock Watch: a bikeshare dock-availability and QC dashboard

**Live site:** https://zoebishop16.github.io/hackathonapplejazz/
**Prompt:** Urban Systems: Bikeshare Fleets (Cornell Six Sigma Hackathon, on-campus track)

At rush hour a city bikeshare runs out of bikes in residential districts and
out of docks downtown, and maintenance vans are sent out blind. Dock Watch is
for the **network planner or analyst** (with a dispatcher view for the van
crew lead). It shows which stations are unusable, when and where, which dock
counts are misleading, which stations will hit empty or full in the next hour,
and which van should move bikes where. It also runs the quality-control
analysis behind those calls: an FMEA, control charts and reliability models.

All data is **synthetic**: 20 stations in 4 districts, polled every 5 minutes
for 3 weeks ([codebook](data/README.md)).

## Run it (one command)

```bash
python3 app/testme.py
```

Then open http://localhost:8000. Python 3.9+ and nothing else: the app is
standard library only. It builds the JSON from `data/` and serves `app/site/`.

Run the tests:

```bash
python3 -m pip install -r app/requirements.txt && python3 -m pytest tests -q && node tests/test_calc_js.mjs
```

Rebuild the datasets (optional; they are committed): `python3 scripts/generate_data.py`.

## The seven pages

| Page | What it shows | How to read it |
|---|---|---|
| **Live Map** | every station on a schematic map, colored *and shaped* by fill level; filters by district, status, time of last update, open docks, problem stations only; click for fill %, bikes, effective capacity, broken docks | ▽ red empty, ◇ orange low, ● green medium, ■ blue high, ▲ purple full, ✕ dark gray out of service; a dashed ring marks a problem station, `!` a misleading fill |
| **Stockouts & Heatmap** | hour × weekday heatmap (same filters), plus a log of every stockout (0 bikes) and fullout (0 docks) with station, start and duration | dark weekday 7-9 AM and 4-6 PM cells are the predictable rush pattern |
| **Dock Health** | per-station table with a square for every dock (bike, broken bike, open, faulty ×, bike stuck !, never locks ∅) and a warning flag | "Fill: total docks" vs "Fill: effective" shows how broken docks mislead |
| **Forecast & At-Risk** | stations likely to hit empty or full in the next 30-60 minutes, ranked by urgency then impact, with a check against what actually happened | "Now" first, then ≤ 30 min, then 30-60 min |
| **Dispatch** | recommended pickup → drop-off moves, a task queue with Repair and Rebalancing tabs, and van status (location, load, queue) | assign a move to a van, confirm tasks complete (saved in your browser) |
| **Maintenance** | fault tickets (opened, assigned, resolved, station history), repeat-offender report, mean time to repair, backlog | stations with 3+ unplanned repairs are repeat offenders |
| **Data Analysis** | tabs: FMEA (editable S/O/D, Pareto by RPN), Control Charts (hourly X-bar, I-MR, p-chart), Reliability (series, parallel, availability, station as a system) | each chart has its formula and a "how to read this" line |

The top bar on every page has the dataset, the snapshot time ("now" in the
replay: Wed 08:15, Wed 12:00, Wed 17:30 or Sat 13:00 of week 3) and a
"last updated" freshness pill. **View as** switches between Analyst (all
pages) and Dispatcher (no Data Analysis); it is a view filter, not a login.

## Inputs

| File | One row per | Key columns |
|---|---|---|
| `status.csv` | station per 5-minute poll | bikes available/disabled, docks available/disabled, status, last_reported |
| `stations.csv` | station | district, total_docks, map x/y |
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
| `event_log(polls)` | every stockout / fullout: start, duration (5-minute steps), ongoing |
| `xbar_chart(subgroups)` | X̿ = mean of subgroup means; σ_short = √(mean within-subgroup variance); limits X̿ ± 3σ_short/√n per subgroup |
| `imr_chart(baseline, monitor)` | x̄ ± 3·MR̄/1.128; MR UCL = 3.267·MR̄; limits from the baseline only |
| `p_chart(baseline, monitor)` | p̄ ± 3√(p̄(1−p̄)/n), LCL floored at 0 |
| `rpn`, `occurrence_score`, `pareto` | RPN = S × O × D; observed rate → occurrence 1-10; Pareto order |
| `series`, `parallel`, `availability`, `mtbf_mttr` | R₁R₂…; 1 − Π(1 − Rᵢ); MTBF/(MTBF + MTTR) |
| `forecast_bikes(...)` | bikes now + (historical fill later − historical fill now) × capacity |

How the charts are set up:
- **Hourly X-bar** of % docks open: one subgroup per hour of the week; each
  observation is one station's average for that hour in one week. Fill follows
  a daily pattern, so rush hours fall outside the limits *by design*: that is
  the predictable pattern, not a fault.
- **I-MR** of `response_min`: limits from Tuesday's work orders, Thursday's
  plotted against them.
- **p-chart** of the share of stations unusable per poll (n = 20): limits from
  Tuesday, Thursday plotted; a fixed 10:00-15:00 window avoids the rush signal.

Every function has a known-answer and a degenerate test in
[`tests/test_qc.py`](tests/test_qc.py) (numbers in [SPEC.md](SPEC.md) section 4).
The in-browser FMEA and reliability calculators use [`app/site/calc.js`](app/site/calc.js),
tested against the same answers in [`tests/test_calc_js.mjs`](tests/test_calc_js.mjs).

Assumptions: observations within a subgroup are independent; the Tuesday
baseline is in control; reliability blocks fail independently (the station
page shows the observed joint rate to check this); open tickets are left out
of MTTR (no censoring correction) and counted as backlog.

## Demo

[`demo/README.md`](demo/README.md) walks through every dataset with the
numbers you should see.

## Repo layout

```
app/qc.py            every statistic (standard library only)
app/build.py         data/ -> app/site/data/*.json, calling qc.py
app/testme.py        build + serve on localhost:8000
app/site/            the static dashboard (index.html, app.js, calc.js, styles.css)
data/                4 synthetic datasets + codebook
scripts/generate_data.py   the dataset generator (seeded)
tests/               pytest + node tests
.github/workflows/pages.yml  test, build and publish to GitHub Pages on every push
SPEC.md, CONTRACT.yaml, docs/plan.md   what we built and why
```

The hackathon's own pages (schedule, rubric, prompts) are in [`docs/`](docs/README.md).

## Credits

Built with Claude Code from the team's design document. Course methods from
the SYSEN 5300 textbook, https://timothyfraser.com/sigma/. GBFS field names
follow https://gbfs.org/. No external libraries in the app.
