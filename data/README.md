# Data codebook

All data here is **synthetic** (invented, not real riders). It was made by
[`scripts/generate_data.py`](../scripts/generate_data.py) with fixed seeds, so
`python3 scripts/generate_data.py` rebuilds every file exactly.

## Datasets

| Folder | What it shows |
|---|---|
| `normal_week/seed_1`, `normal_week/seed_2` | an ordinary 3 weeks: a few dock faults, rare kiosk outages, one chronic station |
| `high_failure_week/seed_1`, `high_failure_week/seed_2` | the same city with about 3x the faults, more offline kiosks and silent feeds, slower vans, three chronic stations |

Every dataset: **20 stations** in **4 districts** (Downtown, Northside, Eastside,
Waterfront), **10-20 docks** each, one poll every **5 minutes**, 24 hours a day,
for **3 weeks** (Mon 2026-09-07 00:00 to Sun 2026-09-27 23:55; 6,048 polls per
station, 120,960 rows in `status.csv`).

Built-in patterns:
- **Weekday rush hours 7-9 AM and 4-6 PM.** Residential stations (Northside,
  Eastside) empty out in the morning and refill in the evening; Downtown fills
  up in the morning and empties in the evening. Waterfront is mixed.
- **Weekends** peak in daylight (about 10 AM-5 PM): residential stations drain,
  Downtown and Waterfront fill.
- **Failures:** broken docks, offline or broken kiosks, blocked stations,
  scheduled maintenance and silent feeds (see `status` and `fault` below).
  Some stations are "chronic" and fail 2.5-3x as often.
- **Rebalancing:** about half of rush-hour stockouts and fullouts get a van,
  which resets the station to roughly half full when it arrives.

## Files and columns

### `stations.csv` (one row per station)

| Column | Meaning | Units |
|---|---|---|
| `station_id` | station code, `S01`-`S20` | text |
| `name` | station name | text |
| `district` | Downtown, Northside, Eastside or Waterfront | text |
| `profile` | demand pattern: `downtown`, `residential` or `mixed` | text |
| `total_docks` | docks installed at the station | docks |
| `x`, `y` | position on the schematic city map | map units, 0-100 (y grows downward) |

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
| `fault` | repair: `dock_fault`, `offline`, `broken_kiosk`, `silent_feed`, `maintenance`; rebalance: `stockout` (bring bikes) or `fullout` (take bikes) | text |
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
| `depot_x`, `depot_y` | depot position on the schematic map | map units |

## Collecting this for real

`status.csv` and `stations.csv` are what any bikeshare publishes through its
public [GBFS](https://gbfs.org/) feeds (`station_status.json` polled every 5
minutes, `station_information.json` once). Per-dock states come from the dock
controllers' diagnostics. `work_orders.csv` is an export from the maintenance
ticket system, and `vans.csv` from the fleet roster.
