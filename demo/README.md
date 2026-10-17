# Demo: Dock Watch on every test dataset

Start it with `.venv/bin/python app/testme.py` and open
http://localhost:8000/dashboard/ (API docs: http://localhost:8000/docs), or use
the live dashboard https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/dashboard/.
Pick the dataset and snapshot in the top bar. Numbers are for the
**Wed 08:15 (morning rush)** snapshot unless a step says otherwise. Every number
is also in the API, for example
`GET /datasets/normal_week__seed_1/xbar?scope=network` returns the X̿ = 46.40 and
σ_short = 23.57 from step 4.

The city is the same in every dataset: 30 stations at real Boston locations in
6 neighborhoods (Downtown 6, Back Bay 5, Fenway 5, South Boston 5, Jamaica
Plain 6, Charlestown 3) and 8 vans. Overnight (11 PM-5 AM) vans step every
station from the evening's end state back to a morning start, so each morning
begins rebalanced (see [the codebook](../data/README.md#commuter-flow-and-overnight-rebalancing)).

## 1. `normal_week / seed 1`: an ordinary three weeks

0. **Network Overview** (the page the site opens on; click **Dock Watch** at the
   top left to come back). Status strip: 5 empty stations, 0 full, 0 out of
   service, 53% of docks available (246 of 461). Stations at risk: the top 5
   of 9 are S22 Jackson Square, S30 Sullivan Square, S28 Bunker Hill Monument,
   S19 L St & E Broadway and S24 Green Street, all empty now (red rows, Risk
   100%, Now). Click a row to open that station on the map. The cards below
   link to each page; Maintenance shows a mean time to repair of 1 h 17 min.
1. **Map** (`#map`). A muted street map of Boston with bright station markers.
   At 08:15 Back Bay and Downtown are mostly blue squares (high) and green
   circles (medium); South Boston, Jamaica Plain and Charlestown are mostly
   orange diamonds and red triangles (low and empty). Click any station for its
   fill, bikes, effective capacity and broken docks. Below the map, the
   heatmap (metric *% of polls empty*) is darkest on weekdays at 8 AM. Untick
   everything but Back Bay and switch to *% of polls full*: weekday 8 AM lights up.
2. **Dispatch** (`#dispatch`). The forecast table comes first: 9 stations at
   risk, 7 high priority (red rows), led by S22 Jackson Square, S30 Sullivan
   Square and S28 Bunker Hill Monument (all heading to empty). Below it, the
   light-blue boxes: 5 recommended moves and 6 of 8 vans available. In **Create
   a rebalancing task**, only idle vans with room are offered, nearest first,
   and a van drops out of the list once it has a task.
3. **Maintenance** (`#maintenance`). Light-blue percentage boxes: 0.0% broken
   docks (0 of 461) and 0 stations with misleading fill at 08:15. The one
   repeat offender (threshold 3 repairs) is S06 Park Street.
4. **Data Analysis → Control Charts**.
   - X-bar by 3-hour block, scope *Whole network*: 168 blocks (8 a day for 21
     days), X̿ = 46.40% open, σ_short = 23.57, flat limits from the most common
     n = 1,080 (30 stations × 36 polls): UCL 48.55, LCL 44.25; 60 of 168 blocks
     outside. The blocks follow the daily commuter pattern (rush blocks are
     emptier or fuller than night blocks), so blocks outside the limits are
     mostly that predictable time-of-day pattern.
   - p-chart, fixed 10:00-15:00 window: p̄ = 0.0219, UCL = 0.1019 (n = 30),
     0 Thursday polls out. Switch to *All day*: 37 Thursday polls out, at rush hour.
5. **Data Analysis → FMEA**. Top RPN: Slow van response 240 (S6 × O8 × D5:
   11.3% of dispatched jobs took over 30 min; overnight runs are not counted),
   then Silent feed 108.

## 2. `normal_week / seed 2`: same city, different random days

Same shape, which shows the patterns are not luck: network X̿ = 46.37,
σ_short = 23.44, n = 1,080, 43 of 168 blocks out. Unlike seed 1, the off-peak
p-chart shows 18 Thursday polls above the UCL (p̄ = 0.0139, UCL = 0.078): a
Thursday that was worse than the Tuesday baseline. Repeat offenders: S16, S15, S18.

## 3. `high_failure_week / seed 1`: a bad stretch

- **Maintenance, Wed 08:15**: S03 South Station has ⚠ (*"Looks full only
  because docks are broken"*). Repeat offenders need 22+ repairs here (twice
  the network median of 11), which singles out exactly the four chronic
  stations: S21 Dorchester Heights, S14 Museum of Fine Arts, S06 Park Street,
  S23 JP Centre & Eliot.
- **Map, Sat 13:00**: S05 (maintenance) and S11 (blocked) are dark gray ✕;
  the top bar shows 2 stale feeds (S14, S25).
- **Dispatch, 08:15**: 17 stations at risk, 16 high priority, 13 moves, 4 vans free.
- **FMEA**: Slow van response 300 (O10: 68% of dispatched jobs over 30 min),
  Silent feed 270 (O5 × D9), Docks disabled 160 (12% of polls).
- **p-chart, all day**: p̄ = 0.135 (about 3x the normal week), 76 Thursday polls out.

## 4. `high_failure_week / seed 2`

- **Network Overview, Wed 08:15**: 6 empty, 5 full, 1 out of service, 44% of
  docks available. The top row is S05 Post Office Square (*Broken kiosk · 3
  broken docks*), so offline stations and broken docks rank alongside
  forecast empties and fulls, in the same order as the Dispatch table.
- **Map, Wed 08:15**: S05 Post Office Square is a dark gray ✕ (broken kiosk).
  At **Wed 17:30** S01 (broken kiosk) and S28 (offline) are ✕.
- **Map, Wed 12:00**: the top bar shows 1 stale feed: S17 is a silent feed.
  Filter *Time of last update → Stale* to find it; it still says *active*.
- **FMEA**: Silent feed is the top RPN, 324 (O6 × D9), ahead of Slow van
  response 300.
- **Maintenance**: repeat offenders S08 and S05 (threshold 23).

## How to read the charts

- A red diamond is outside the control limits; a dark dot is inside.
- X-bar by 3-hour block: limits are one flat pair from the most common
  subgroup size. Because fill follows the commuter day, rush and night blocks
  sit outside by design; look for a block that breaks the usual weekly pattern.
- p-chart: the fixed 10:00-15:00 window is the fair test; the all-day view
  signals at rush hour by design.
- Every number above comes from `app/qc.py`; `python3 -m pytest tests -q`
  checks the formulas against hand-worked answers, and
  `python3 scripts/validate_data.py` checks the data rules.
