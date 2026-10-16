# app/

| File | Job |
|---|---|
| `qc.py` | every statistic, plain functions, standard library only (tested in `tests/test_qc.py`) |
| `build.py` | reads `data/<scenario>/<seed>/*.csv`, calls `qc.py`, writes `site/data/<id>.json` + `index.json` |
| `testme.py` | `python3 app/testme.py`: build, then serve `site/` on http://localhost:8000 (set `PORT` to change) |
| `site/` | the static dashboard: `index.html`, `app.js` (pages, filters, SVG charts), `calc.js` (live FMEA/reliability math, mirrors `qc.py`), `styles.css` |
| `requirements.txt` | test-only dependency (pytest) |

Deploy: `.github/workflows/pages.yml` runs the tests, `build.py`, and publishes `site/` to GitHub Pages on every push to `main`.
The `manifestme` / `deployme` Posit Connect scripts are not used: the team chose GitHub Pages (see `docs/plan.md`).
