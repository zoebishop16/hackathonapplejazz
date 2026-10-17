# app/: the Dock Watch REST API

A FastAPI app (`app.py`) over the tested statistics in `qc.py`. It also serves
the dashboard at `/dashboard/` and interactive docs at `/docs`, where judges can
call every endpoint from the browser.

## The four-script contract

| File | Job |
|---|---|
| `testme.sh` (or `python3 app/testme.py`) | build the JSON from `data/`, run the API on http://localhost:8000 |
| `manifestme.sh` | rebuild the JSON and write `manifest.json` for Posit Connect (run on your machine, commit the result) |
| `deployme.sh` | publish to Posit Connect from your machine (`CONNECT_SERVER`, `CONNECT_API_KEY` in your shell or a gitignored `app/.env`) |
| `README.md` | this file |

```bash
python3.11 -m venv .venv && .venv/bin/pip install -r tests/requirements.txt
.venv/bin/python app/testme.py                     # http://localhost:8000/docs
PYTHON=$PWD/.venv/bin/python bash app/manifestme.sh
PYTHON=$PWD/.venv/bin/python bash app/deployme.sh
```

## Endpoints

GET: results for the four test datasets. `{id}` is one of `normal_week__seed_1`,
`normal_week__seed_2`, `high_failure_week__seed_1`, `high_failure_week__seed_2`;
`snapshot` is `wed-0815`, `wed-1200`, `wed-1730` or `sat-1300`.

| Endpoint | Returns |
|---|---|
| `/health` | `{"status": "ok", "datasets": 4}` |
| `/datasets` | datasets and their snapshot keys |
| `/datasets/{id}/stations` | every station at a snapshot (fill %, category, bikes, effective capacity, broken docks, flags); filters `district`, `status`, `max_feed_age`, `stale_only`, `min_open_docks`, `problem_only` |
| `/datasets/{id}/stations/{station}` | one station with its dock grid, forecast, reliability and repair tickets |
| `/datasets/{id}/heatmap` | 7 × 24 grid; `metric` = `empty`, `full`, `unusable` or `fill`; same filters |
| `/datasets/{id}/events` | stockout / fullout log; `station`, `kind`, `limit`, `offset` |
| `/datasets/{id}/forecast` | at-risk list for the next 30-60 minutes |
| `/datasets/{id}/dispatch` | recommended moves, repair and rebalancing queues, vans |
| `/datasets/{id}/maintenance` | MTTR, backlog, repeat offenders, tickets; `station` for one history |
| `/datasets/{id}/xbar` | hourly X-bar chart; `scope` = `network`, `district:Northside`, `S07`, ... |
| `/datasets/{id}/imr` | I-MR of `response_min`, Tuesday limits, Thursday monitored |
| `/datasets/{id}/pchart` | p-chart of unusable stations; `window` = `off_peak` or `all_day` |
| `/datasets/{id}/fmea` | FMEA rows and Pareto order |
| `/datasets/{id}/reliability` | per-station and network reliability, MTBF, MTTR, availability |

POST: the same statistics on your own numbers (bad input → HTTP 422 with the reason).

| Endpoint | Body (example) | Returns |
|---|---|---|
| `/compute/fill` | `{"total_docks": 12, "docks_disabled": 4, "bikes_available": 6}` | effective capacity 8, fill 75%, "high", flag "looks_emptier" |
| `/compute/stockouts` | `{"polls": [{"time": "08:05", "bikes_available": 0, "docks_available": 12}, ...]}` | episodes with start and duration |
| `/compute/xbar` | `{"subgroups": [{"label": "A", "values": [10,20,30]}, {"label": "B", "values": [40,50,60]}]}` | X̿ 35, σ_short 10, UCL 52.32, LCL 17.68 |
| `/compute/imr` | `{"baseline": [10,12,14,12], "monitor": [20]}` | UCL 17.319, MR UCL 6.534, last point out |
| `/compute/pchart` | `{"baseline": [{"defectives": 2, "n": 20}], "monitor": [...]}` | p̄, limits per point |
| `/compute/fmea` | `{"modes": [{"name": "...", "severity": 8, "occurrence": 5, "detection": 3}]}` | RPN 120 and the Pareto order (`occurrence_rate` instead of `occurrence` maps a rate to 1-10) |
| `/compute/reliability` | `{"structure": "series", "reliabilities": [0.9, 0.8]}` | 0.72 (parallel: 0.98) |
| `/compute/availability` | `{"mtbf": 95, "mttr": 5}` | 0.95 |
| `/compute/forecast` | `{"bikes_now": 4, "capacity": 10, "hist_fill_now": 0.5, "hist_fill_later": 0.2}` | projected 1 bike, risk "empty" |

## Files

`qc.py` statistics (standard library only) · `app.py` the API · `build.py` data/ → `site/data/*.json` ·
`site/` the dashboard · `manifest.json` Posit Connect bundle list · `requirements.txt` pinned API dependencies.
The JSON in `site/data/` is committed because the API serves it; CI fails if it is stale.
