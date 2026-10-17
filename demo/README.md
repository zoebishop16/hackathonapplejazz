# Demo: Dock Watch on every test dataset

Start it with `.venv/bin/python app/testme.py` and open
http://localhost:8000/dashboard/ (API docs: http://localhost:8000/docs), or use
the live dashboard https://connect.systems-apps.com/content/0bd2254f-17a0-4a0a-b63b-73979c506f1e/dashboard/.
Pick the dataset and snapshot in the top bar. Numbers are for the
**Wed 08:15 (morning rush)** snapshot unless a step says otherwise. Every number
is also in the API, for example
`GET /datasets/normal_week__seed_1/xbar?scope=network` returns the X̿ = 47.02 and
σ_short = 19.36 from step 4.

The city is the same in every dataset: 30 stations at real Boston locations in
6 neighborhoods (Downtown 6, Back Bay 5, Fenway 5, South Boston 5, Jamaica
Plain 6, Charlestown 3) and 8 vans.

## 1. `normal_week / seed 1`: an ordinary three weeks

1. **Map** (`#map`). A street map of Boston. At 08:15 the Downtown and Back
   Bay markers are blue squares and purple triangles (high and full), and the
   South Boston, Jamaica Plain and Charlestown ones are mostly orange diamonds
   and red triangles (low and empty). Click any station for its fill, bikes, effective capacity
   and broken docks. Below the map, the heatmap (metric *% of polls empty*) is
   darkest on weekdays 8-9 AM. Untick everything but Back Bay and switch to
   *% of polls full*: now 8-10 AM lights up.
2. **Dispatch** (`#dispatch`). 10 stations at risk, 9 of them high priority
   (red rows); the top three are S05 Post Office Square and S10 Newbury & Mass
   Ave (full) and S30 Sullivan Square (empty). The forecast columns go to
   +2 h. Below: 12 recommended moves, 6 of 8 vans available. In **Create a
   rebalancing task**, pick a pick-up and a drop-off: only idle vans with room
   are offered, the nearest one is suggested, and after you create the task
   that van drops out of the list.
3. **Maintenance** (`#maintenance`). 0% broken docks and 0 stations with
   misleading fill at 08:15; mean time to repair 1 h 17 min. The one repeat
   offender (threshold 3 repairs) is S06 Park Street.
4. **Data Analysis → Control Charts**.
   - Daily X-bar, scope *Whole network*: X̿ = 47.02% open, σ_short = 19.36,
     n = 719-720, UCL 49.18, LCL 44.85; **0 of 21 days** outside. The rush
     hours average out within a day, so day to day the network is in control.
   - p-chart, fixed 10:00-15:00 window: p̄ = 0.0261, UCL = 0.1135, 0 Thursday
     polls out. Switch to *All day*: 57 Thursday polls out, all at rush hour.
5. **Data Analysis → FMEA**. Top RPN: Slow van response 240 (S6 × O8 × D5:
   10.5% of jobs took over 30 min), then Silent feed 108.

## 2. `normal_week / seed 2`: same city, different random days

Same shape, which shows the patterns are not luck: network X̿ = 47.08,
σ_short = 19.47, 0 of 21 days out; off-peak p̄ = 0.0243 with 0 Thursday polls
out. At 08:15, 15 stations are at risk and only 4 vans are free. Repeat
offenders: S16, S15, S18.

## 3. `high_failure_week / seed 1`: a bad stretch

- **Maintenance, Wed 08:15**: S03 South Station has ⚠ (*"Looks full only
  because docks are broken"*) and S22 Jackson Square has ⚠ (*"Looks like it
  has bikes, but none are rentable"*). Repeat offenders need 22+ repairs here
  (twice the network median of 11), which singles out exactly the four chronic
  stations: S21 Dorchester Heights, S14 Museum of Fine Arts, S06 Park Street,
  S23 JP Centre & Eliot. Mean time to repair 4 h 23 min.
- **Map, Sat 13:00**: S05 (maintenance) and S11 (blocked) are dark gray ✕;
  the top bar shows 2 stale feeds (S14, S25).
- **Dispatch, 08:15**: 18 stations at risk, 16 high priority, 16 moves, 5 vans free.
- **FMEA**: Slow van response 300 (O10: 68% of jobs over 30 min), Silent feed
  270 (O5 × D9), Docks disabled 160 (12% of polls).
- **p-chart, all day**: p̄ = 0.0923 (about 3x the normal week), 104 Thursday
  polls out.

## 4. `high_failure_week / seed 2`

- **Map, Wed 08:15**: S05 Post Office Square is a dark gray ✕ (broken kiosk).
  At **Wed 17:30** S01 (broken kiosk) and S28 (offline) are ✕.
- **Map, Wed 12:00**: the top bar shows 1 stale feed: S17 is a silent feed.
  Filter *Time of last update → Stale* to find it; it still says *active*.
- **FMEA**: Silent feed is the top RPN, 324 (O6 × D9), ahead of Slow van
  response 300.
- **Maintenance**: repeat offenders S08 and S05 (threshold 23); mean time to
  repair 5 h 6 min.

## How to read the charts

- A red diamond is outside the control limits; a dark dot is inside.
- Daily X-bar: a day outside the limits means that whole day ran unusually
  full or empty, worth a look. Within-day rush swings are expected and are
  part of σ_short.
- p-chart: the fixed 10:00-15:00 window is the fair test; the all-day view
  signals at rush hour by design.
- Every number above comes from `app/qc.py`; `python3 -m pytest tests -q`
  checks the formulas against hand-worked answers, and
  `python3 scripts/validate_data.py` checks the data rules.
