# Dock Watch dataset codebook

All data here is **synthetic** (invented, not real riders). It was made by
[`scripts/generate_data.py`](../scripts/generate_data.py) with fixed seeds, so
`python3 scripts/generate_data.py` rebuilds every file exactly, and
`python3 scripts/validate_data.py` checks every rule below (it prints PASS/FAIL
for each and exits non-zero on any failure).

## Datasets

| Folder | What it shows |
|---|---|
| `normal_week/seed_1`, `normal_week/seed_2` | an ordinary 3 weeks: rare dock faults (about 0.5% of polls have a broken dock), rare outages, one chronic station, quick vans that answer most rush-hour stockouts |
| `high_failure_week/seed_1`, `high_failure_week/seed_2` | the same city in a bad stretch: about 25x the broken-dock polls, 10-17x the out-of-service polls, 11-12x the repair tickets, and 3-4x the empty and full polls (heavier rush demand, slower vans that answer only a quarter of rush-hour stockouts), four chronic stations |

Every dataset: **30 stations** at real Boston locations in **6 neighborhoods**
used as districts, with a random 3-6 stations each: Downtown 6, Back Bay 5,
Fenway 5, South Boston 5, Jamaica Plain 6, Charlestown 3. **10-20 docks** each,
one poll every **5 minutes**, 24 hours a day, for **3 weeks** (Mon 2026-09-07
00:00 to Sun 2026-09-27 23:55; 6,048 polls per station, 181,440 rows in
`status.csv`). **8 vans.**

Built-in patterns:
- **Weekday rush hours 7-9 AM and 4-6 PM.** Residential stations (South
  Boston, Jamaica Plain, Charlestown) empty out in the morning and refill in
  the evening; Downtown and Back Bay fill up in the morning and empty in the
  evening. Fenway is mixed. See [Commuter flow](#commuter-flow-and-overnight-rebalancing).
- **Weekends** peak in daylight (about 10 AM-5 PM): residential stations drain,
  Downtown, Back Bay and Fenway fill.
- **Failures:** broken docks, offline or broken kiosks, blocked stations,
  scheduled maintenance and silent feeds (see `status` and `fault` below).
  Some stations are "chronic" and fail 2-3x as often.
- **Broken bikes are uncommon:** about 0.02-0.06 per station-poll in a normal
  week, 0.08-0.11 in a high-failure week.
- **Rebalancing during the day:** 70% of rush-hour stockouts and fullouts get
  a van in a normal week (25% in a high-failure week); the van resets the
  station to roughly half full when it arrives.
- **Overnight rebalancing (11 PM-5 AM):** riders barely move bikes, and vans
  gradually redistribute them so each station starts the next morning at a
  realistic level (details below).

## Commuter flow and overnight rebalancing

Each station's fill level (bikes ÷ effective capacity) follows a target curve
plus ordinary random wobble. The target depends on the time of day:

| Time | Who moves the bikes | Residential (South Boston, Jamaica Plain, Charlestown) | Downtown and Back Bay | Fenway (mixed) |
|---|---|---|---|---|
| **Morning, 5-7 AM** | riders, light; early commuting begins toward 7 AM | start near 74%, easing toward 62% by 7 AM | start near 32%, rising toward 40% by 7 AM | about 50% |
| **Morning rush, 7-9 AM** | riders going INTO the city | drain: about 74% → 5-12% | fill: about 32% → 85-97% | rises a little |
| **Midday, 9 AM-4 PM** | riders, light | slowly refill to about 35% | stay high (about 80%) | about 60% |
| **Evening rush, 4-6 PM** | riders going HOME, away from the city | refill to about 90% | drain to about 6% | dips to about 35% |
| **Evening, 6-11 PM** | riders, light | hold the evening end state (about 93%) | hold it (about 7%) | about 38% |
| **Overnight, 11 PM-5 AM** | **vans**, not riders | stepped down to the morning start (about 74%) | stepped up to the morning start (about 32%) | stepped to about 50% |

Weekends have no commuter rush: residential stations drain and the others fill
in daylight (about 10 AM-5 PM), and the overnight steps are small.

How the overnight rebalancing works (`night_plan` and `overnight_order` in the generator):

- **Riders almost stop.** Random rider wobble overnight is about 1/20 of the
  rush-hour level (validation: about 0.03 bikes moved per poll at night versus
  0.6 at rush hour, excluding the van visits).
- **Vans visit every station 2-4 times a night.** The night is cut into as many
  equal slices as there are visits, and one visit falls at a random time inside
  each slice, so the work is spread from 11 PM to 5 AM rather than done at once.
- **Each visit moves an equal share** of the gap between that evening's end
  state and the next morning's start, so the level steps gradually (normal
  week, residential: 88% at 10 PM, 81% at 1 AM, 75% at 4 AM; downtown: 14% at
  10 PM to 32% at 4 AM). A visit that removes bikes is an `overnight_pickup`
  work order and one that adds bikes is an `overnight_dropoff`; about 1.2 bikes
  move per visit. If a visit's share rounds to 0 bikes (common on weekend
  nights, when the two levels are close), no order is written.
- **Out-of-service stations are skipped** that night and keep their level.
- **The first night** (before Monday 5 AM of week 1) starts at the morning level.
- Overnight runs are **scheduled work**, not responses to a call, so they are
  left out of the FMEA "slow van response" rate and the dispatch
  time-to-resolution figures.

Assumptions, stated plainly: the network-wide bike total is not held exactly
constant (each station is modelled on its own, so vans can be thought of as
drawing on a depot float); vans have enough capacity overnight; the morning
start and evening end levels are design choices for a plausible commuter city,
not measured from real Boston data.

Every row keeps the dock identity, so `num_bikes_available + num_docks_disabled`
never exceeds `total_docks` (checked by `scripts/validate_data.py`).

## How the control charts group this data

The Data Analysis page's X-bar chart groups `status.csv` into **hourly
subgroups**, 24 per day: **00:01-01:00**, **01:01-02:00**, ... **23:01-24:00**
(a poll exactly on the hour closes the hour before it, so 08:00 belongs to
07:01-08:00, and midnight closes the previous day's 23:01-24:00 block). Each
observation is one station's % of open docks
(`num_docks_available` ÷ effective capacity) at one 5-minute poll while the
station is in service, so a full block holds 12 polls per station (360 for
the whole network of 30). An hour in which a station was out of service the
whole time has no readings and is left off that station's chart. The limits use the most common block size for every
point. The p-chart uses one subgroup per poll: all 30 stations.

## Files and columns

### `stations.csv` (one row per station)

| Column | Meaning | Units |
|---|---|---|
| `station_id` | station code, `S01`-`S30` | text |
| `name` | station name | text |
| `district` | Boston neighborhood: Downtown, Back Bay, Fenway, South Boston, Jamaica Plain or Charlestown | text |
| `profile` | demand pattern: `downtown`, `residential` or `mixed` | text |
| `total_docks` | docks installed at the station | docks |
| `lat`, `lon` | real street location (approximate) | decimal degrees (WGS 84) |

### `status.csv` (one row per station per 5-minute poll; what the feed reports)

| Column | Meaning | Units |
|---|---|---|
| `timestamp` | poll time | `YYYY-MM-DD HH:MM`, local time |
| `station_id` | station code | text |
| `num_bikes_available` | rentable bikes in docks | bikes |
| `num_bikes_disabled` | broken bikes sitting in docks (cannot be rented) | bikes |
| `num_docks_available` | working, empty docks a rider can return to | docks |
| `num_docks_disabled` | broken docks (faulty, bike stuck, never locks) | docks |
| `status` | `active`, or out of service: `offline`, `broken_kiosk`, `blocked`, `maintenance` | text |
| `is_renting`, `is_returning` | 1 if riders can take / return bikes, else 0 | 0/1 |
| `last_reported` | when the station last sent fresh data | `YYYY-MM-DD HH:MM` |

Identity on every row: `num_bikes_available + num_bikes_disabled +
num_docks_available + num_docks_disabled = total_docks`.

Derived in the tool: **effective capacity** = `total_docks - num_docks_disabled`;
**fill %** = 100 ? (`num_bikes_available + num_bikes_disabled`) / effective capacity;
**feed age** = `timestamp - last_reported` in minutes. A **silent feed** keeps
repeating its last reading with an old `last_reported` while `status` still says
`active`, so it looks healthy.

### `dock_faults.csv` (one row per broken-dock episode)

| Column | Meaning | Units |
|---|---|---|
| `station_id` | station code | text |
| `dock_id` | dock code, `S01-D07` = dock 7 at S01 | text |
| `state` | `faulty`, `bike_stuck` or `never_locks` | text |
| `start`, `end` | when the dock broke and when it was fixed (end is exclusive) | `YYYY-MM-DD HH:MM` |

A dock not listed at a given time is `working`.

### `work_orders.csv` (one row per van job)

| Column | Meaning | Units |
|---|---|---|
| `order_id` | ticket number | text |
| `station_id` | station code | text |
| `order_type` | `repair` or `rebalance` | text |
| `fault` | repair: `dock_fault`, `offline`, `broken_kiosk`, `silent_feed`, `maintenance`; rebalance: `stockout` (bring bikes) or `fullout` (take bikes) during the day, or `overnight_pickup` / `overnight_dropoff` for the scheduled overnight runs | text |
| `opened_at` | ticket opened (fault detected) | `YYYY-MM-DD HH:MM` |
| `assigned_at` | van assigned | `YYYY-MM-DD HH:MM` |
| `arrived_at` | van arrived at the station | `YYYY-MM-DD HH:MM` |
| `resolved_at` | job finished | `YYYY-MM-DD HH:MM` |
| `response_min` | `arrived_at - opened_at` | minutes |
| `repair_min` | `resolved_at - arrived_at` (time on site, including waits for parts) | minutes |
| `van_id` | van that did the job | text |
| `bikes_moved` | bikes moved by a rebalance job (0 for repairs) | bikes |

### `vans.csv` (one row per van)

| Column | Meaning | Units |
|---|---|---|
| `van_id`, `name` | van code and name | text |
| `capacity` | bikes the van can carry | bikes |
| `depot_lat`, `depot_lon` | depot location | decimal degrees (WGS 84) |

## Collecting this for real

`status.csv` and `stations.csv` are what any bikeshare publishes through its
public [GBFS](https://gbfs.org/) feeds (`station_status.json` polled every 5
minutes, `station_information.json` once). Per-dock states come from the dock
controllers' diagnostics. `work_orders.csv` is an export from the maintenance
ticket system, and `vans.csv` from the fleet roster.

## Exact file inventories

Counts below are computed from the committed CSV files, not estimates.

| Dataset | stations.csv | status.csv | dock_faults.csv | work_orders.csv | vans.csv |
| --- | ---: | ---: | ---: | ---: | ---: |
| high_failure_week/seed_1 | 30 | 181440 | 788 | 2173 | 8 |
| high_failure_week/seed_2 | 30 | 181440 | 844 | 2174 | 8 |
| normal_week/seed_1 | 30 | 181440 | 28 | 1876 | 8 |
| normal_week/seed_2 | 30 | 181440 | 29 | 1850 | 8 |

## Exact column order

Use header names rather than assuming a spreadsheet column position.

- **dock_faults.csv**: `station_id`, `dock_id`, `state`, `start`, `end`.
- **stations.csv**: `station_id`, `name`, `district`, `profile`, `total_docks`, `lat`, `lon`.
- **status.csv**: `timestamp`, `station_id`, `num_bikes_available`, `num_bikes_disabled`, `num_docks_available`, `num_docks_disabled`, `status`, `is_renting`, `is_returning`, `last_reported`.
- **vans.csv**: `van_id`, `name`, `capacity`, `depot_lat`, `depot_lon`.
- **work_orders.csv**: `order_id`, `station_id`, `order_type`, `fault`, `opened_at`, `assigned_at`, `arrived_at`, `resolved_at`, `response_min`, `repair_min`, `van_id`, `bikes_moved`.

## Reading and joining the files

Treat each scenario/seed folder as a separate experiment. Do not combine its station IDs with another folder without also carrying the scenario and seed. The same ID across folders is not evidence of the same measured real-world station, capacity or failure history.

| File | Grain / logical key | Joins | How the tool uses it |
| --- | --- | --- | --- |
| stations.csv | One station; station_id unique within a dataset | Parent of every station_id | Location, district, demand profile, installed capacity |
| status.csv | One reported station state; (station_id, timestamp) | station_id to stations | Snapshot counts, feed age, fill, history, forecast, heatmap and charts |
| dock_faults.csv | One fault episode; station_id, dock_id, start identify an episode | station_id to stations; dock_id embeds station and dock number | Reconstruct broken-dock state for start <= snapshot < end |
| work_orders.csv | One job; order_id unique within a dataset | station_id to stations; van_id to vans | Repair counts, queues, response time, repair time, reliability and FMEA |
| vans.csv | One van; van_id unique within a dataset | Referenced by work_orders | Vehicle capacity and depot; snapshot availability is derived |

There is no rider, trip or person identifier in these files. They cannot answer questions about individual behavior, exact trip origin/destination, fares or rider demographics. A station name and coordinate are geographic context, not a claim that an operator supplied these measurements.

## Storage types, valid values and missingness

CSVs are comma-delimited text with a header row. IDs and names must remain strings: do not convert the numeric portion of an ID to an integer and lose its prefix or leading zero. Counts, flags and dock numbers are integers. Coordinates and duration fields are numeric; timestamps are strings parsed as local wall-clock time with minute precision.

The bundled datasets use a complete regular poll grid. Blank cells are not an intended missing-value code. The builder calls integer and timestamp parsers directly, so inserting blank counts or blank ticket timestamps will fail rather than silently impute a value. Never replace an unknown value with zero: zero bikes is a service failure and zero repair time changes reliability estimates.

| Variable family | Expected constraints | Collection / interpretation note |
| --- | --- | --- |
| station_id | Existing inventory ID; consistent across files in the folder | Preserve the operator's source ID through ingestion |
| dock_id | Station prefix plus dock suffix, e.g. S01-D07 | Dock number must refer to an installed dock at that station |
| order_id | Unique job ID | Reopened or duplicated tickets need a documented deduplication rule |
| van_id | Existing fleet-roster ID | Do not assign one ID to different vehicles during the observation period |
| total_docks | Positive installed count; bundled stations have 10–20 | Retain inventory history if capacity changes in production |
| num_bikes_available, num_bikes_disabled | Nonnegative counts of rentable and non-rentable docked bikes | Available is a rental-service measure, not all visible bicycles |
| num_docks_available, num_docks_disabled | Nonnegative counts of empty usable and disabled docks | Disabled docks reduce usable capacity |
| is_renting, is_returning | Integer 0 or 1 | These flags describe permission, separately from inventory counts |
| lat, lon, depot_lat, depot_lon | WGS 84 decimal-degree coordinates | Latitude north is positive; Boston longitude west is negative |
| timestamp, last_reported | YYYY-MM-DD HH:MM; last_reported should not be after timestamp | Poll time is when we observed a report; last_reported is the source's report time |
| start, end | Fault start precedes end; end is exclusive | A dock is no longer faulty exactly at end |
| opened_at, assigned_at, arrived_at, resolved_at | Lifecycle order should be chronological | Archive original event timestamps; do not infer all four from an export time |
| response_min, repair_min | Nonnegative durations in minutes | Compare to timestamp differences during ingestion |
| bikes_moved | Nonnegative integer; zero for repairs | The fault label supplies pickup/dropoff direction; the count has no sign |
| capacity | Positive integer bikes per van | Capacity is a vehicle limit, not its current load |

`status` and `fault` are different concepts. Status is the station's reported operating condition; fault is a work-order reason. A silent feed may still report `active`, yet its old last_reported indicates that the information is stale. `blocked` appears as a station status; not every status episode necessarily corresponds one-to-one with a repair ticket.

`dock_faults.state` values are `faulty`, `bike_stuck` and `never_locks`. The dashboard additionally draws `bike`, `bike_disabled` and `open` states, which are reconstructed display states, not extra categories in that source CSV. Dock placement in the display is schematic; the synthetic aggregate counts do not locate every actual bicycle at a specific physical dock.

## Distinguishing reported state from physical state

The station counts satisfy the installed-capacity identity:

```text
rentable bikes + disabled bikes + open docks + disabled docks = installed docks
```

This is the dataset's accounting model. In particular, the display does not count a disabled dock again as an ordinary occupied working dock. Real operator taxonomies may overlap differently; document and reconcile them before using these equations.

The status file is what the feed reports. It may repeat old inventory while a dock-fault log records a change. A discrepancy between those sources can therefore be intentional evidence of a silent feed, rather than a parsing error. The Maintenance mismatch note makes this visible. Do not overwrite source records solely to force agreement.

## Derived variables and denominators

| Derived quantity | Definition / units | Interpretation |
| --- | --- | --- |
| Effective capacity | Installed docks minus disabled docks; docks | Working dock capacity, not rentable-bike count |
| Fill | 100 × (rentable + disabled docked bikes) / effective capacity; percent | Occupancy of usable docks; undefined at zero usable capacity |
| Empty / full | Active station with zero rentable bikes / zero open docks | Different rider-service failures; disabled bikes can make an empty rental station look occupied |
| Unusable | Out of service OR zero rentable bikes OR zero open docks | Union of conditions, not sum of overlapping counts |
| Feed age | Poll timestamp minus last_reported; minutes | The app treats over 15 minutes as stale |
| Network docks available | Open docks at active stations divided by all installed docks × 100 | Network installed-capacity denominator includes inactive stations |
| Heatmap empty/full | Affected active station-polls / active station-polls × 100 in each weekday-hour cell | Pooled across three weeks; not a snapshot or percentage of trips |
| Heatmap unusable | Unusable station-polls / all station-polls × 100 | Includes out-of-service observations in numerator and denominator |
| Heatmap fill | Mean effective fill of active station-polls, as percent | Different denominator from network docks available |
| Historical risk | Comparable earlier-week unusable polls / comparable earlier-week polls × 100 | Current unusability overrides this with 100; missing history is null |
| Forecast | Current bikes + historical change in fill fraction × effective capacity | Bounded to capacity; 30/60/90/120-minute horizons |
| Repeat offender | At least three unplanned repairs AND at least twice the network median | Network comparison changes with repair history; scheduled maintenance excluded |
| MTTR | Mean completed repair duration, converted from minutes to hours for reliability functions | Open repairs are excluded; backlog is separate |
| MTBF | Operating hours / completed failure count | No completed failures yields an undefined estimate |
| Availability | MTBF / (MTBF + MTTR) | Use matching time units |
| RPN | Severity × Occurrence × Detection, each 1–10 | Prioritization score, not failure probability |

X-bar uses percentage of **open docks**, not occupancy fill: observations are open docks / effective capacity × 100 at active station-polls. The mean of hourly means is the center line. Within-hour sample variances estimate short-term spread; flat limits use the most common subgroup size. Hour boundaries close on the hour, unlike the heatmap's conventional hour-start labels. This distinction matters when independently reproducing chart points.

The p-chart estimates baseline unusability from Tuesday station-polls and monitors Thursday. The fixed off-peak 10:00–15:00 window is intended to reduce systematic commute effects; it does not establish that the baseline is statistically in control. Inspect the baseline and assumptions before operational use.

## How to collect equivalent operational data

The following is a proposed collection protocol, not a claim that these synthetic files were collected from an operator:

1. Obtain permission to use the operator's station inventory, status, diagnostics, ticket history and fleet roster. Record source owners, licenses and allowed retention. No rider identities are needed for this tool.
2. Export inventory with stable station IDs, installed capacity and coordinate reference system. Save the extraction date and retain inventory changes; a capacity change should not rewrite past observations.
3. Schedule five-minute status polls. Store receipt time and source report time independently, alongside rental/return permissions and disabled equipment counts. Archive original payloads for audit. Poll failure is missing observation, not a zero-bike observation.
4. Convert source timezone-aware timestamps to a consistent analytic clock. The bundled timestamps have no UTC offset and no daylight-saving transition; a real collector must preserve UTC and source offset to disambiguate repeated local times.
5. Export per-dock diagnostic episodes. Preserve exclusive end semantics and distinguish unresolved faults from missing end times. Avoid duplicate overlapping episodes for the same dock unless the taxonomy explicitly allows them.
6. Export work-order lifecycle events with stable job, station and van references. Separate scheduled service from unplanned failures and pickup from dropoff. Record completed and unresolved jobs; the current builder expects complete timestamp columns, so adapt ingestion explicitly before importing open-ticket exports.
7. Export fleet capacity and depot locations. If actual vehicle load or position is needed, collect a separate time series; the current roster does not supply live GPS or telematics.
8. Validate counts, dates, uniqueness, references and chronology. Investigate outages and stale feeds rather than interpolating them into apparently healthy readings. Keep a collection log with rejected rows and reasons.
9. Check coverage over several comparable weeks, including holidays, weekends and outages. Estimate the effect of missing polls, operating changes and unequal intervals before trusting historical patterns.
10. Version raw extracts, normalized CSVs and the transformation code together, with access controls appropriate to operator data. Do not put credentials in CSVs, source, screenshots or public commits.

## Reproducibility, quality checks and limitations

Run `python scripts/validate_data.py` to check the repository's design rules. It validates scenario patterns, capacity accounting and overnight movement, among other checks; it is not a universal validator for every possible operational export. Add explicit checks for unique keys, referential integrity, unresolved events, timezone ambiguity and source-specific semantics when adapting ingestion.

Run `python scripts/generate_data.py` only when intentionally regenerating the bundled synthetic files; it writes the four dataset folders. Use the fixed seeds and unchanged generator to reproduce the demonstration. The scenario names include “week,” but each folder contains three weeks. A new seed is another simulation, not an independent sample of real Boston performance.

The generator models stations separately and does not conserve the exact network-wide bike total. A depot float supplies overnight redistribution. Demand profiles, chronic failures and van responses are design choices. Reliability assumes independent components, and five-minute samples are autocorrelated. These features make the data suitable for explaining the tool and testing known behavior, not for estimating Boston's actual service quality or optimizing a real fleet.

For a research or operating report, retain the dataset ID, generator revision, collection window, filtering rules, denominator definitions and exclusions. Distinguish a station-poll rate from a trip failure rate. Report null values separately from zero. Include open-ticket backlog alongside completed-repair summaries to avoid presenting only the successful resolutions.
