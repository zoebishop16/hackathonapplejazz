# Demo: Dock Watch on every test dataset

Start it with `python3 app/testme.py` and open http://localhost:8000, or use
the live site https://zoebishop16.github.io/hackathonapplejazz/. Pick the
dataset and snapshot in the top bar. All numbers below are for the
**Wed 08:15 (morning rush)** snapshot unless a step says otherwise.

## 1. `normal_week / seed 1`: an ordinary three weeks

1. **Live Map** (`#map`). Northside and Eastside markers are mostly orange
   diamonds (low) and red triangles (empty); Downtown is blue squares (high).
   Click **S07 Hillcrest**: 1 bike in 15 effective docks (7% full), but it is
   a broken bike, so the panel says *"Looks like it has bikes, but none are
   rentable"*. Tick **Problem stations only** to hide the healthy ones.
2. **Stockouts & Heatmap** (`#stockouts`). Metric *% of polls empty*: the
   darkest cells are weekdays 8-9 AM. Untick everything but Downtown and
   switch to *% of polls full*: now 8-10 AM lights up. 679 episodes in the
   whole log (340 stockouts).
3. **Forecast & At-Risk** (`#forecast`). 8 stations at risk; the "Check" column
   compares each flag with what the replay did next.
4. **Dispatch** (`#dispatch`). 8 recommended moves from Downtown donors to
   Northside/Eastside. Assign one to *Van 1*; it appears in the Rebalancing tab.
5. **Maintenance** (`#maintenance`). Mean time to repair 3 h 26 min over 52
   unplanned repairs; S15 Belle Sherman is the top repeat offender (7).
6. **Data Analysis → FMEA**. Top RPN: Slow van response 270 (S6 × O9 × D5:
   23.6% of jobs took over 30 min), then Silent feed 162. Change Silent feed's
   D from 9 to 3 and watch it drop down the Pareto chart.
7. **Data Analysis → Control Charts**.
   - X-bar, scope *District: Northside*: X̿ = 45.30% open, σ_short = 10.52,
     n = 14-15. Mon 08:00 averages 87.27% open against UCL 53.45: 135 of 168
     hours are outside, because the rush pattern is built into fill levels.
   - I-MR: Tuesday baseline x̄ = 23.66 min, UCL = 64.60, MR UCL = 50.30;
     1 Thursday order is above the UCL.
   - p-chart, fixed 10:00-15:00 window: p̄ = 0.035, UCL = 0.158, 0 Thursday
     points out. Switch to *All day*: 46 Thursday polls out, all at rush hour.
8. **Data Analysis → Reliability** (window *Weekday morning rush*). Series
   S07 → S02: 0.8389 × 0.8139 = 0.6828. Parallel S07 + S10: 0.9763.
   Network availability: MTBF 157.5 h, MTTR 3.23 h, A = 0.9799.

## 2. `normal_week / seed 2`: same city, different random days

Same shape as seed 1, which shows the patterns are not luck: Northside X-bar
X̿ = 44.84, σ_short = 10.40; I-MR x̄ = 22.36, UCL = 51.17 with 4 Thursday
orders out; network A = 0.9834; S16 Pier 1 is the top repeat offender.

## 3. `high_failure_week / seed 1`: about 3x the faults

- **Live Map, Wed 12:00**: S19 Inlet Trail is a dark gray ✕ (offline).
- **Dock Health, Wed 08:15**: S02 Main & 5th is flagged *"Looks full only
  because docks are broken"*.
- **Maintenance**: 19 repeat offenders; S19 (24 repairs) and S06 (23) lead.
- **FMEA**: Slow van response 300 (O10: 59% of jobs over 30 min), Silent
  feed 270 (O5 × D9).
- **I-MR**: x̄ = 43.61 min, UCL = 118.6; 2 Tuesday and 2 Thursday points out.
- **Availability**: MTBF 51.4 h, MTTR 4.09 h, A = 0.9263 (vs 0.9799 normal).

## 4. `high_failure_week / seed 2`

- **Live Map, Wed 08:15**: the top bar shows **1 stale** feed: S08 North
  Commons is a silent feed. Filter *Time of last update → Stale* to find it;
  it still says *active*. At **Wed 12:00**, S03 Transit Center is a dark gray
  ✕ (under maintenance) and S08 is still stale.
- **p-chart, 10:00-15:00**: p̄ = 0.0875, UCL = 0.277, 4 Thursday polls out:
  a real off-peak signal, unlike the normal weeks.
- **Availability**: A = 0.9327; S08 (26 repairs) is the worst repeat offender.

## How to read the charts

- A red diamond is outside the control limits; a dark dot is inside.
- On the hourly X-bar chart, out-of-limit hours are the *predictable* rush
  pattern. On the I-MR and fixed-window p-chart, a point out is a real special
  cause worth investigating.
- Every number above comes from `app/qc.py`; `python3 -m pytest tests -q`
  checks the formulas against hand-worked answers.
