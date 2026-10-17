# Plan: Dock Watch (Urban Systems - Bikeshare Fleets)

Source: the team's design document ("Design of Website.pdf"); SPEC.md section 4 holds every formula.

## Decisions
- Track: on-campus (24 hours).
- Stack: Python standard library computes every statistic into JSON; a static HTML/JS dashboard reads it.
- Stack (revised): public REST API with FastAPI (`app/app.py`) over `app/qc.py`, deployed to Posit Connect (`.github/workflows/deploy-fastapi.yml`); it also serves the dashboard. GitHub Pages keeps a static copy of the dashboard.
- Python 3.11 for the API bundle (`app/.python-version`); built JSON in `app/site/data/` is committed because the API serves it.
- Map: schematic SVG (no tiles, no keys). 20 stations, 4 districts.
- "Now" in the live pages = four replay snapshots in week 3 (Wed 08:15, 12:00, 17:30; Sat 13:00).
- Role-based access = a view switch (Analyst / Dispatcher), not a login.

## Tasks
| Id | What | Owns | Known-answer test | Degenerate test |
|---|---|---|---|---|
| H-01 | SPEC filled from the PDF | SPEC.md | `grep -c "FILL IN[.,]" SPEC.md` = 0 | - |
| H-02 | 4 seeded datasets + codebook | data/, scripts/generate_data.py | identity bikes + docks = total on every row; rush pattern visible (residential 72% -> 18% by 8 AM) | - |
| H-03 | statistics in app/qc.py | app/qc.py, tests/ | SPEC 4 (a)-(f) | constant data, n = 1, capacity 0, < 2 I-MR points, MTBF + MTTR = 0 |
| H-04 | FastAPI app + dashboard + build + testme | app/ | `/compute/*` reproduce SPEC 4 answers; `/datasets/*` match the reviewed JSON (tests/test_api.py) | bad input -> HTTP 422 with the reason; unknown dataset/snapshot -> 404 |
| H-05 | demo walkthrough | demo/ | demo/README.md numbers match the JSON | - |
| H-06 | publish to Posit Connect | .github/workflows/, .github/scripts/, app/manifest.json, app/.python-version | `/health` answers 200 on the public URL | - |
| H-07 | README | README.md, app/README.md | fresh clone runs `python3 app/testme.py` | - |
| H-08 | public repo + Devpost | .gitignore | clone, test, run | - |

## Formulas (see SPEC 4)
fill % = bikes / (total docks - broken docks); X-bar limits = X̿ ± 3 σ_short/√n, σ_short = √mean(s²);
I-MR = x̄ ± 3 MR̄/1.128, MR UCL = 3.267 MR̄; p = p̄ ± 3√(p̄(1-p̄)/n); RPN = S·O·D;
series ΠR, parallel 1-Π(1-R), A = MTBF/(MTBF+MTTR); forecast = bikes + (hist fill later - hist fill now)·capacity.
