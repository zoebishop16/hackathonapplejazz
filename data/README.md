# Data codebook

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
| **Morning rush, 7-9 AM** | riders going INTO the city | drain: about 74% → 5-12% | fill: about 32% → 85-97% | rises a little |
| **Midday** | riders, light | slowly refill to about 35% | stay high (about 80%) | about 60% |
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
**fill %** = (`num_bikes_available + num_bikes_disabled`) / effective capacity;
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
