# SPEC: Six Sigma Hackathon team project

What your tool IS. Your agent reads this before every task. Where the code and this file
disagree, the code is the bug: change this file first, then the code.

Most of this page is already decided by the event and the [rubric](docs/criteria.md).
**Only the `FILL IN` lines change, and you do not have to write them by hand:** describe your app and ask your agent to update them. They depend on the prompt your team picks at kickoff
(prompts are secret until then, see [`docs/prompts.md`](docs/prompts.md)) and on your team.
The examples after each `FILL IN` show the shape of an answer. They are not hints about the prompts.

## 1. Team and prompt
- **Team name:** Apple Jazz (from the repo name; team to confirm)
- **Track:** On-campus (24 hours).
- **Prompt we chose:** Urban Systems - Bikeshare Fleets: "docks full / docks empty" crisis at rush hour; vans dispatched blindly. Design a tool to track dock availability, when and where stations are unusable, and support network performance.
- **Our public repo:** github.com/zoebishop16/hackathonapplejazz (site: zoebishop16.github.io/hackathonapplejazz)

## 2. User and use case (rubric: scope 5, user and use case 5)
- **User:** the bikeshare network planner/analyst (with a dispatcher view for the van crew lead).
- **Decision the tool helps them make, and when:** before and during each rush hour, which stations to rebalance or repair first (which van goes where), and, weekly, which failure mode to fix first (FMEA) and whether the network is in control.
- **Why this matches the prompt:** it tracks dock availability per station and per dock, logs when and where stations are unusable, and turns that into van moves instead of blind dispatch.

## 3. Inputs (rubric: minimal inputs 5)
Only what this user can actually measure or already knows. Fewer is better; every input a user
cannot measure costs points.

| Input | Type and units | Where the user gets it |
|---|---|---|
| `status.csv`, one row per station per 5-minute poll | counts (bikes, docks), flags, timestamps | the system's GBFS station_status feed |
| `stations.csv`, one row per station | district, total docks, map position | the station inventory |
| `docks.csv`, one row per dock | state (working, faulty, bike_stuck, never_locks) | dock diagnostics at the snapshot |
| `work_orders.csv`, one row per repair or rebalance job | timestamps, minutes | the maintenance ticket system |
| `vans.csv`, one row per van | capacity (bikes), depot position | the fleet roster |

## 4. The statistics, and why (rubric: valid QC analysis 25)
Say the method in words before any code exists. Load the `stats-first-steering` skill first.
- **Method:** (1) **X-bar chart by hour of week**: subgroup = one weekday-hour (Mon 08:00, ... Sun 23:00); each observation = one station's average % of open docks in that hour in one week (3 weeks x stations in the filter). Grand mean X-double-bar = mean of subgroup means; sigma_short = sqrt(mean of within-subgroup variances); UCL/LCL = X-double-bar +/- 3 sigma_short / sqrt(n_w). (2) **I-MR chart** of `response_min` from work_orders.csv, limits from Tuesday orders (x-bar +/- 2.66 MR-bar; MR UCL = 3.267 MR-bar), Thursday orders plotted against them. (3) **p-chart** of the proportion of stations unusable (out of service, 0 bikes or 0 docks) per poll, n = stations, limits p-bar +/- 3 sqrt(p-bar(1-p-bar)/n) from Tuesday, Thursday plotted; a fixed off-peak window (10:00-15:00) is also charted. (4) **FMEA**: RPN = S x O x D, Occurrence from data, Pareto by RPN. (5) **Reliability**: series R = R_origin x R_dest; parallel R = 1-(1-R1)(1-R2); availability A = MTBF/(MTBF+MTTR) from repair orders; station-as-system = R_feed x R_kiosk x R_docks. Plus fill % = bikes / effective capacity (total docks - broken docks).
- **Why it fits the use case:** fill levels repeat by hour of week, so hour-of-week subgroups separate the predictable rush pattern (points outside limits by design) from ordinary wobble, while response times and off-peak unusable rates are stable enough for a Phase I / Phase II control chart.
- **Assumptions and how the tool checks them:** observations are independent within a subgroup (different stations/weeks); the Tuesday baseline is in control (the I-MR chart shows Tuesday points too); p-chart uses n = stations in the poll and the normal approximation (n x p-bar is shown); reliability components are independent (stated on the page); work-order repair times are complete (no censoring: open tickets are excluded from MTTR and counted as backlog).
- **Known-answer check:** (a) X-bar: subgroups [10,20,30] and [40,50,60]: means 20, 50; X-double-bar = 35; variances 100, 100, sigma_short = 10; n = 3, SE = 10/sqrt(3) = 5.7735; UCL = 52.3205, LCL = 17.6795. (b) Fill: 12 docks, 4 broken, 6 bikes: effective capacity 8, fill 75% = "high"; naive 6/12 = 50% "medium", so flagged "looks emptier". (c) I-MR: Tuesday [10,12,14,12]: mean 12, MR = 2,2,2, MR-bar 2, UCL = 12 + 3(2/1.128) = 17.319, LCL = 6.681, MR UCL = 6.534; a Thursday 20 is out. (d) p-chart: p-bar 0.10, n 20: 3 sqrt(0.1 x 0.9/20) = 0.2012, UCL = 0.3012, LCL = 0 (floored). (e) RPN 8x5x3 = 120. (f) series 0.9x0.8 = 0.72; parallel 1-(0.1)(0.2) = 0.98; MTBF 95 h, MTTR 5 h: A = 0.95. Degenerate: constant data gives sigma_short = 0, so limits are returned as None with a message; subgroups of n = 1 are skipped; effective capacity 0 gives fill None (out of service); I-MR with fewer than 2 points raises ValueError.

Fixed for every team:
- The statistic lives in **one plain, tested function** (`app/qc.py` or `app/qc.R`). The API, app or
  package only calls it and displays the result. No statistics inside UI code.
- Every statistic has a test against a known answer and a degenerate case (constant data, n = 1, missing values).
- You can explain every number the tool prints. If you cannot, it is not done.

## 5. Delivery (rubric: working tool 25)
- **Stack:** REST API (FastAPI). `app/app.py` exposes every statistic in `app/qc.py`: GET endpoints for the four test datasets and POST `/compute/...` endpoints that run the same functions on the user's own numbers. It also serves the dashboard at `/dashboard/` and interactive docs at `/docs`. Deployed on the course Posit Connect server; the static dashboard also runs on GitHub Pages.
- **Starting demo:** `demos/fastapi/` (its four-script contract: `app/testme.sh`, `app/manifestme.sh`, `app/deployme.sh`, `app/README.md`; Python 3.11 in `app/.python-version`).

Fixed for every team:
- Start from **one** demo in `demos/`, copied to `app/`. Keep its four-script contract
  (`testme`, `manifestme`, `deployme`, `README.md`); `testme` starts the tool with one command.
- Deployed on the course **Posit Connect** server with a public URL (publisher key handed out at the
  event). Deploy early: copy one workflow from
  [`.claude/skills/connect-publish/workflows/`](.claude/skills/connect-publish/workflows/).
- A small tool that runs beats a large tool that does not.

## 6. Outputs
- **What the user sees:** a seven-page dashboard (Live Map, Stockouts & Heatmap, Dock Health, Forecast & At-Risk, Dispatch, Maintenance, Data Analysis). Each chart has a legend and a "how to read this" line, e.g. "points outside the red limits are hours where % open docks is not ordinary wobble: the rush-hour pattern".
  Example: "a control chart with out-of-control points in red, plus 'stop the line: yes/no'"

## 7. Test datasets and codebook (rubric: demo 10, datasets 5, codebook 5)
2-3 small CSVs in `data/`, invented but shaped like real field data, each showing one behavior.
`data/README.md` is the codebook: every file, every column with units, and what it would take to
collect this data for real.
- **Datasets:** `data/normal_week/seed_1`, `seed_2` and `data/high_failure_week/seed_1`, `seed_2`: 20 stations, 4 districts, 10-20 docks, 5-minute polls, 3 weeks, rush hours 7-9 AM and 4-6 PM; high_failure has more broken docks, offline kiosks and silent feeds. Generated by `scripts/generate_data.py`.

## 8. Documentation and reproducibility (rubric: docs 10, public repo 5)
- `README.md` says what the tool does, for whom, every input and parameter, how to run it in one
  command, and walks through the demo on each test dataset.
- Public GitHub repo; a fresh clone runs `testme` and the tests pass with no extra steps.
- Submit on Devpost: the repo link plus a demo.

## 9. Out of scope
What we will NOT build, so nobody (human or agent) builds it by accident.
- Default: logins, databases, real customer data, a second statistic before the first one is tested.
- Real logins (the role switch is a view filter, not security), live GBFS feeds, route optimisation for vans (greedy nearest pairs only), forecasting beyond historical averages by time and day.
