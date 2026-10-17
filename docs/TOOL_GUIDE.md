# Dock Watch tool guide

Dock Watch supports bikeshare analysts deciding where to rebalance bikes and repair docks. All bundled data is synthetic. Start with the website's **Docs** tab for an analyst walkthrough; **About** introduces the four team members with their supplied portraits and biographies.

## Run locally

Install Python 3.11 or later, then run from the repository root:

```sh
python -m pip install -r tests/requirements.txt
python app/testme.py
```

Open http://localhost:8000/dashboard/. The analyst guide is at `/dashboard/#docs`; About is at `/dashboard/#about`. Interactive API documentation is at `/docs`. Set the `PORT` environment variable to change the default port (8000). Stop with Ctrl+C.

## Data flow and inputs

`data/` CSVs -> `app/build.py` -> `app/site/data/*.json` -> dashboard and read-only dataset API. `app/qc.py` owns the statistical functions. POST `/compute/...` calls those functions on supplied numbers without changing the bundled data. The dashboard has no upload or live-feed connection.

There are four dataset IDs: `normal_week__seed_1`, `normal_week__seed_2`, `high_failure_week__seed_1`, `high_failure_week__seed_2`. Snapshot API keys are `wed-0815`, `wed-1200`, `wed-1730`, `sat-1300`. In the UI select the human-readable labels. See [the codebook](../data/README.md) for every CSV column, unit and rule, [the endpoint reference](../app/README.md) for request bodies and query parameters, and [the demo](../demo/README.md) for expected scenario results.

| Input file | Contents and purpose |
| --- | --- |
| stations.csv | Station ID, name, district, installed dock capacity and location |
| status.csv | Five-minute station polls: timestamps, service state, available/disabled bikes and docks, feed timestamp |
| dock_faults.csv | Dock fault episodes with dock ID, state, start and end |
| work_orders.csv | Repair/rebalance jobs, stations, assigned van and lifecycle timestamps |
| vans.csv | Van IDs, capacity and depot location |

## Parameters and conventions

Counts are numbers of bikes, docks or stations. Fill percentages, risk percentages and Pareto percentages use 0–100; historical fill fractions and reliability use 0–1. Repair durations are minutes; MTBF and MTTR outputs are hours. Missing results use Python `None` / JSON `null`, displayed as a dash. A missing result is not zero. Timestamps in the synthetic files use `YYYY-MM-DD HH:MM`; keep their replay clock consistent.

Dataset queries use `snapshot` to select replay time. Station filters include repeatable `district`, fill `status`, `max_feed_age` (minutes), `stale_only`, `min_open_docks` and `problem_only`. Overview `top` defaults to 5 (1–50). Heatmap `metric` is empty/full/unusable/fill. X-bar `scope` is network, district:<name>, or station ID. P-chart `window` is off_peak or all_day. Forecast `at_risk_only` defaults to true. Maintenance and reliability accept a station ID filter. The interactive API schema gives exact defaults, validation and response shapes.

## Core function reference

Import with `from app import qc` from the repository root. Functions take plain Python values and return numbers, lists, dictionaries or tuples. Invalid supported inputs usually raise `ValueError`; API validation reports HTTP 422. Mean requires nonempty values and variance requires at least two values. Do not pass NaN, missing values or physically inconsistent counts; these low-level functions do not all validate every possible malformed input.

Example:

```python
from app import qc
capacity = qc.effective_capacity(12, 4)  # 8 usable docks
qc.fill_pct(6, capacity)                # 75.0 (percent)
qc.rpn(8, 5, 3)                        # 120
qc.forecast_bikes(4, 10, 0.5, 0.2)      # (1.0, 'empty')
```

The signatures below preserve parameter names and defaults. Their descriptions come from the function docstrings, beside the implementation.


## app/qc.py

### `effective_capacity(total_docks, docks_disabled)`

Docks a rider can actually use: total docks minus broken docks.

### `fill_pct(bikes, capacity)`

Percent full = bikes in docks / effective capacity x 100.

Returns None when capacity is 0 (every dock broken): there is no fill level.

### `fill_category(bikes, capacity)`

empty = 0%, low = 1-29%, medium = 30-69%, high = 70-99%, full = 100%.

Empty and full use the exact counts (0 bikes, 0 open docks), so 99.5%
is "high", not "full". None when capacity is 0.

### `misleading_flag(bikes_available, bikes_disabled, docks_available, docks_disabled)`

Flag a station whose broken docks or bikes misstate how full it is.

- "full_due_to_broken_docks": no open docks, but some docks are broken; if
  they worked a rider could return a bike.
- "empty_due_to_broken_bikes": no rentable bikes, but broken bikes sit in
  docks, so the station looks like it has bikes.
- "looks_emptier": counting broken docks as capacity puts the station in a
  lower fill category than its true (effective) fill.
None when nothing is misleading.

### `event_log(polls, poll_minutes=5)`

Every stockout (0 bikes) and fullout (0 docks) episode for one station.

polls: list of (time, bikes_available, docks_available, in_service), in
time order, one per poll. An out-of-service poll ends an episode (the
station is unusable for a different reason, logged separately).
Returns a list of dicts: kind, start, end (the first poll after the
episode, or None), polls, duration_min, ongoing (True if the data ended
first, so the duration is a lower bound).

### `mean(xs)`

Arithmetic mean. math.fsum is exactly rounded, so every Python version
gives the same answer (built-in sum() changed its float rounding in 3.12).

### `variance(xs)`

Sample variance (n - 1 denominator).

### `most_common_n(sizes)`

The most common sample size; on a tie, the smallest (wider, more cautious limits).

### `xbar_chart(subgroups, constant_limits=False)`

Averages (X-bar) chart with limits from the within-subgroup spread.

subgroups: ordered list of (label, [values]).
Grand mean X-double-bar = mean of the subgroup means.
sigma_short = sqrt(mean of the within-subgroup variances), over subgroups
with n >= 2 (a single value has no within-subgroup spread).
SE = sigma_short / sqrt(n), UCL/LCL = X-double-bar +/- 3 SE, where n is each
subgroup's own size, or, with constant_limits=True, the most common
subgroup size for every point (one flat pair of limits for the chart).
Returns grand_mean, sigma_short, n_limits (None unless constant), message,
and points (label, n, mean, ucl, lcl, out). Limits are None with a message
when sigma_short is 0 or no subgroup has two values.

### `p_chart(baseline, monitor=(), constant_limits=False)`

Proportion chart; p-bar from the baseline.

baseline, monitor: lists of (defectives, n). Here a "defective" is an
unusable station at one poll (out of service, 0 bikes or 0 docks) and n is
the number of stations polled.
p-bar = total defectives / total n over the baseline.
UCL/LCL = p-bar +/- 3 sqrt(p-bar (1 - p-bar) / n); LCL floored at 0, UCL
capped at 1. n is each point's own size, or, with constant_limits=True, the
most common n over all points (one flat pair of limits).

### `rpn(severity, occurrence, detection)`

Risk priority number RPN = S x O x D, each scored 1-10.

### `occurrence_score(rate)`

Map an observed failure rate (0-1) to an FMEA occurrence score 1-10.

Scale (team's choice, log-spaced like the AIAG table): >=30% -> 10,
>=20% -> 9, >=10% -> 8, >=5% -> 7, >=2% -> 6, >=1% -> 5, >=0.5% -> 4,
>=0.2% -> 3, >=0.05% -> 2, else 1.

### `pareto(items)`

items: list of (name, value). Sorted descending with cumulative %.

### `median(xs)`

Middle value (mean of the two middle values for an even count).

### `repeat_offender_threshold(repair_counts, minimum=3, multiple=2)`

Repairs a station needs to count as a repeat offender.

At least `minimum` repairs AND at least `multiple` x the network median, so
a bad week where every station breaks still singles out the chronic ones.

### `_check_r(rs)`

Internal helper used by this module.

### `series(*rs)`

Series system: works only if every block works. R = R1 x R2 x ...

### `parallel(*rs)`

Parallel system: works if any block works. R = 1 - (1-R1)(1-R2)...

### `availability(mtbf, mttr)`

Steady-state availability A = MTBF / (MTBF + MTTR).

### `mtbf_mttr(operating_hours, repair_minutes)`

MTBF = operating time / number of failures; MTTR = mean repair time.

repair_minutes: one value per completed repair (open tickets excluded).
Returns (mtbf_hours, mttr_hours); MTBF is None when there were no failures.

### `network_summary(stations)`

Network status right now, from one snapshot's station rows.

stations: dicts with status, bikes_available, docks_available,
docks_disabled, total_docks.
Counts are from a rider's view, the same rule as the at-risk list:
empty = in service with 0 rentable bikes; full = in service with 0 open
docks; out of service = status is not active. Also stations with broken
docks, and docks_available_pct = open docks at in-service stations / all
docks installed x 100 (None when there are no docks).

### `risk_pct(unusable_flags)`

Risk % = share of comparable past polls when the station was unusable.

unusable_flags: one True/False per poll in the same weekday-and-time window
of earlier weeks (True = out of service, 0 bikes or 0 open docks).
None when there is no history.

### `rank_at_risk(items)`

Rank stations for action: most urgent first, then biggest impact, then risk %.

items: dicts with urgency (0-5), impact_bikes and risk_pct. Sorts in
place, writes rank = 1, 2, ... and returns the list. The Overview and the
Dispatch forecast table both use this one order.

### `forecast_bikes(bikes_now, capacity, hist_fill_now, hist_fill_later, margin=None)`

Project bikes ahead with the historical average change for that time slot.

projected = bikes_now + (hist_fill_later - hist_fill_now) x capacity,
where hist_fill_* are the average fill fractions (0-1) at this weekday and
time of day, from earlier weeks. Clamped to [0, capacity].
Risk is "empty" when the projection is within `margin` bikes of 0, "full"
when within `margin` open docks of capacity, else None. The default
margin is 10% of capacity, at least 1: an early warning, not a certainty.
Returns (projected bikes, risk).


## app/build.py

### `t(s)`

Parse a synthetic timestamp string s using FMT; return a datetime.

### `r(x, nd=2)`

Round numeric x to nd decimal places (default 2); preserve None.

### `read(path)`

Read path as CSV and return rows as dictionaries of strings.

### `load(folder)`

Load and convert the CSV files in folder for the dataset builder.

### `scheduled(o)`

Planned overnight rebalancing runs (not a response to a call).

### `fill_frac(p)`

Fill as a fraction (0-1) for history; None when not usable.

### `problems(p)`

Return operational problem labels for station poll p.

### `dist(a, b)`

Great-circle (haversine) distance in km between two points with lat/lon.

### `order_json(o)`

Convert work-order o into a JSON-serializable queue row.

### `hist_fill(polls, now, minutes_ahead, window=2)`

Average fill at the same weekday and time of day (+/- window polls) in earlier weeks.

### `hist_unusable(polls, now, minutes_ahead=120)`

Unusable flags for every poll in the next `minutes_ahead` minutes at the same
weekday and time in earlier weeks (only polls before `now`).

### `snapshot(now, stations, polls, faults, orders, vans)`

Build one replay snapshot from now and station, poll, fault, order and van records.

### `heatmap(stations, polls)`

Per station, per hour of week (Mon 00 .. Sun 23): poll counts for the heatmap.

### `block_open_pct(polls)`

{(day, block): [% open docks at each active poll]} for one station.

Block b of a day covers the polls after b:00 up to and including
(b+1):00, so 01:00 belongs to 00:01-01:00, 08:00 to 07:01-08:00, and
midnight closes the previous day's 23:01-24:00 block.

### `xbar_series(stations, polls)`

X-bar chart of % docks open, one subgroup per hourly block (24 a day, 504 in all).

Each observation is one station's % open docks at one 5-minute poll in that
block, so a block holds up to 12 x (stations in scope) values. Limits use
the most common subgroup size for every point (flat limits).

### `pchart(stations, polls)`

Build Tuesday-baseline/Thursday-monitoring p-charts for all-day and off-peak polls.

### `fmea(stations, polls, orders)`

Build failure-mode scores and Pareto results from station, poll and work-order records.

### `reliability(stations, polls, orders)`

Build reliability summaries from station, poll and completed work-order records.

### `build(folder, scenario, seed)`

Build one folder into a JSON dataset, tagged with scenario and seed.

### `main()`

Build bundled datasets and their index; the launcher then starts the local API server.


## app/app.py

### `_index()`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `_dataset(dataset_id)`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `snapshot_key(label)`

'Wed 08:15 (morning rush)' -> 'wed-0815'.

### `_snap(d, snapshot)`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `_stations(d)`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `_problem(r)`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `_filter(d, rows, district, status, max_feed_age, stale_only, min_open_docks, problem_only)`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `_check(fn, *args, **kwargs)`

Run a qc function; its ValueErrors become HTTP 422 with the message.

### `root()`

What this API is and where to start.

### `health()`

Liveness check: answers ok and how many datasets are loaded.

### `docs_redirect()`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.

### `datasets()`

The four test datasets and their snapshot times.

### `stations(dataset_id: str, snapshot: Optional[str]=SnapshotQ, district: Optional[List[str]]=DistrictQ, status: Optional[List[str]]=StatusQ, max_feed_age: Optional[float]=Query(None, description='Only feeds updated within this many minutes.'), stale_only: bool=Query(False, description='Only stale feeds (older than 15 min).'), min_open_docks: int=Query(0, ge=0, description='Only stations with at least this many open docks.'), problem_only: bool=Query(False, description='Only problem stations.'))`

Every station at a snapshot: fill %, category, bikes, effective capacity, broken docks, flags.

The same filters as the Live Map: district, status, time of last update,
open docks, problem stations only.

### `overview(dataset_id: str, snapshot: Optional[str]=SnapshotQ, top: int=Query(5, ge=1, le=50))`

The Network Overview: status strip numbers and the top stations at risk.

summary: empty (0 rentable bikes), full (0 open docks) and out-of-service
stations, stations with broken docks, and % of all docks available.
at_risk: the same ranking as /forecast (and the Dispatch table), with each
station's issues, risk % and minutes until the event (0 = now).

### `station(dataset_id: str, station_id: str, snapshot: Optional[str]=SnapshotQ)`

One station: its state, its per-dock grid, its forecast and reliability.

### `heatmap(dataset_id: str, metric: Literal['empty', 'full', 'unusable', 'fill']='empty', snapshot: Optional[str]=SnapshotQ, district: Optional[List[str]]=DistrictQ, status: Optional[List[str]]=StatusQ, max_feed_age: Optional[float]=None, stale_only: bool=False, min_open_docks: int=Query(0, ge=0), problem_only: bool=False)`

Hour x weekday grid (7 rows Mon-Sun, 24 columns) of a percent over all 3 weeks.

empty / full = % of active polls with 0 bikes / 0 open docks; unusable = %
of all polls empty, full or out of service; fill = average fill %. Pooled
over the stations that pass the filters (status filters use the snapshot).

### `forecast(dataset_id: str, snapshot: Optional[str]=SnapshotQ, at_risk_only: bool=True)`

At-risk list for the next 30-60 minutes, ranked by urgency then impact.

### `dispatch(dataset_id: str, snapshot: Optional[str]=SnapshotQ)`

Recommended pickup -> drop-off moves, repair and rebalancing queues, van status.

### `maintenance(dataset_id: str, snapshot: Optional[str]=SnapshotQ, station: Optional[str]=None)`

Mean time to repair, backlog, repeat offenders, and the repair tickets opened so far.

### `xbar(dataset_id: str, scope: str=Query('network', description='network, district:<name>, or a station id like S07'))`

X-bar chart of % docks open; subgroup = one hourly block (00:01-01:00, 01:01-02:00, ..., 23:01-24:00).

Observations = each station's % open docks at every 5-minute poll in the
block. UCL, LCL = grand mean +/- 3 sigma_short / sqrt(n), with n the most
common subgroup size (flat limits); sigma_short = sqrt(mean of
within-subgroup variances).

### `pchart(dataset_id: str, window: Literal['off_peak', 'all_day']='off_peak')`

p-chart of the share of stations unusable per poll (n = 20); Tuesday limits, Thursday plotted.

### `fmea(dataset_id: str)`

FMEA rows (S, O from data, D, RPN) and the Pareto order.

### `reliability(dataset_id: str, station: Optional[str]=None)`

Per-station reliabilities (bike, dock, feed, kiosk, docks), MTBF, MTTR, availability; network totals.

### `compute_fill(body: FillIn)`

Effective capacity, fill %, fill category and misleading-fill flag for one station reading.

### `compute_stockouts(body: PollsIn)`

Stockout / fullout episodes from one station's polls, in time order.

### `compute_xbar(body: XbarIn)`

Averages chart: grand mean, sigma_short = sqrt(mean within-subgroup variance), limits per subgroup.

### `compute_pchart(body: PIn)`

p-chart: p-bar from the baseline; limits p-bar +/- 3 sqrt(p-bar(1 - p-bar)/n), LCL floored at 0.

### `compute_fmea(body: FmeaIn)`

RPN = S x O x D for each mode (O from occurrence_rate if not given), plus the Pareto order.

### `compute_reliability(body: ReliabilityIn)`

Series R = R1 x R2 x ...; parallel R = 1 - (1 - R1)(1 - R2)...

### `compute_availability(body: AvailIn)`

A = MTBF / (MTBF + MTTR), same time units for both.

### `compute_forecast(body: ForecastIn)`

Project bikes ahead from historical average fills; flags empty or full risk.

### `dashboard_slash()`

API adapter; see the endpoint and model schemas in /docs for parameter validation and returned fields.


## app/testme.py

### `main()`

Build bundled datasets and their index; the launcher then starts the local API server.

## Browser modules and lifecycle

`app/site/index.html` loads the stylesheet, Leaflet and the ES-module entry point. The header contains the brand and navigation; the workspace contains replay controls and a focusable page region.

`app/site/app.js` keeps state in `S`: dataset index/data, selected snapshot, page, filters, analysis tab and local assignments. `store.get(key, fallback)` and `store.set(key, value)` wrap browser storage and tolerate storage being disabled. `esc(value)` escapes text inserted into markup. Formatting helpers handle display units and missing values.

`init()` binds controls and loads the index; `loadDataset(id)` fetches generated JSON and preserves a valid snapshot. `route()` resolves the URL fragment, including old aliases, renders and moves focus to the page region. `renderNav()` marks the active tab; `renderTop()` fills the replay controls and freshness indicator. `render()` handles help pages before loading/errors, then dispatches to the operational page renderer. Each `page...` renderer receives the page DOM element and replaces its contents, binding the controls it creates. Map rendering uses Leaflet; filters update the shared state. Chart and table helpers receive prepared results rather than recomputing statistics. `pageDocs(el)` and `pageAbout(el)` need no dataset.

`app/site/calc.js` exports `rpn(s,o,d)`, `series(...rs)`, `parallel(...rs)`, `availability(mtbf,mttr)` and `pareto(items)`. The first four mirror Python's formulas and validation. JavaScript Pareto accepts objects with name/value fields (Python accepts name/value pairs), returns a new descending array with pct/cum_pct, and requires a positive total. Inputs to reliability are proportions. See tests/test_calc_js.mjs for known answers.

`app/site/styles.css` defines shared colors, top navigation, workspace layout, tables, charts and responsive rules. Small screens wrap navigation with labels visible and stack panels.

Browser assignments are local to this browser. FMEA edits are session state. Neither writes CSVs or sends fleet instructions. Clearing browser storage resets saved choices and assignments.

## Verify and publish

Run `python -m pytest tests -q` and `node tests/test_calc_js.mjs`. Rebuild JSON with `python app/build.py` when input data or builder behavior changes. `app/testme.sh` wraps the Python launcher; `app/manifestme.sh` rebuilds JSON and writes the Connect manifest, and `app/deployme.sh` publishes using environment credentials. Never put credentials into source files. `app/requirements.txt` pins runtime dependencies; `.python-version` pins the Connect Python minor version. `manifest.json` lists bundle checksums and is generated metadata, not source code.

Existing GitHub Actions workflows publish on a push. This update retains the existing URL paths; local edits are visible on hosted URLs only after deployment. The dashboard Docs tab (`#docs`) and FastAPI API docs (`/docs`) are separate.

## Interpretation limits

Historical forecasts are illustrative and have no calibrated prediction intervals. Risk percentage is an empirical historical share, not a probability guarantee. X-bar assumes independent observations despite autocorrelated polls; systematic daily patterns can cross limits. The p-chart's Tuesday baseline must be representative. Reliability formulas assume independent components. Open repairs are excluded from MTTR and counted as backlog. Zero spread can leave limits undefined; read the returned message. Confirm feed age and local context before operational decisions.

The Docs guide uses the full workspace width with nested bullet lists. Network summary cards, station markers and a forecast-table excerpt use the currently selected dataset and replay snapshot. Without data, a notice replaces those visuals while the guide remains available. Team portraits are bundled under `app/site/images/`; About does not require data.
