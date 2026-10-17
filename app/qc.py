"""Quality-control statistics for the bikeshare dock-availability tool.

Every statistic the dashboard shows is computed by one plain function here.
Plain inputs (numbers and lists), plain outputs (numbers, dicts), standard
library only. The site never computes a statistic itself except the live
recalculation of the editable FMEA and reliability tables, which mirror
rpn(), series(), parallel() and availability() below (tests/test_calc_js.mjs
checks they agree).
"""

import math

# ---------------------------------------------------------------- fill level

FILL_CATEGORIES = ("empty", "low", "medium", "high", "full")


def effective_capacity(total_docks, docks_disabled):
    """Docks a rider can actually use: total docks minus broken docks."""
    if total_docks < 0 or docks_disabled < 0 or docks_disabled > total_docks:
        raise ValueError("need 0 <= docks_disabled <= total_docks")
    return total_docks - docks_disabled


def fill_pct(bikes, capacity):
    """Percent full = bikes in docks / effective capacity x 100.

    Returns None when capacity is 0 (every dock broken): there is no fill level.
    """
    if capacity <= 0:
        return None
    if bikes < 0 or bikes > capacity:
        raise ValueError("bikes must be between 0 and capacity")
    return 100.0 * bikes / capacity


def fill_category(bikes, capacity):
    """empty = 0%, low = 1-29%, medium = 30-69%, high = 70-99%, full = 100%.

    Empty and full use the exact counts (0 bikes, 0 open docks), so 99.5%
    is "high", not "full". None when capacity is 0.
    """
    pct = fill_pct(bikes, capacity)
    if pct is None:
        return None
    if bikes == 0:
        return "empty"
    if bikes == capacity:
        return "full"
    if pct < 30:
        return "low"
    if pct < 70:
        return "medium"
    return "high"


def misleading_flag(bikes_available, bikes_disabled, docks_available, docks_disabled):
    """Flag a station whose broken docks or bikes misstate how full it is.

    - "full_due_to_broken_docks": no open docks, but some docks are broken; if
      they worked a rider could return a bike.
    - "empty_due_to_broken_bikes": no rentable bikes, but broken bikes sit in
      docks, so the station looks like it has bikes.
    - "looks_emptier": counting broken docks as capacity puts the station in a
      lower fill category than its true (effective) fill.
    None when nothing is misleading.
    """
    bikes = bikes_available + bikes_disabled
    total = bikes + docks_available + docks_disabled
    eff = total - docks_disabled
    if docks_disabled > 0 and docks_available == 0 and eff > 0:
        return "full_due_to_broken_docks"
    if bikes_available == 0 and bikes_disabled > 0:
        return "empty_due_to_broken_bikes"
    if docks_disabled > 0 and eff > 0:
        naive = fill_category(bikes, total)
        true = fill_category(bikes, eff)
        if FILL_CATEGORIES.index(naive) < FILL_CATEGORIES.index(true):
            return "looks_emptier"
    return None


# ---------------------------------------------------- stockout / fullout log

def event_log(polls, poll_minutes=5):
    """Every stockout (0 bikes) and fullout (0 docks) episode for one station.

    polls: list of (time, bikes_available, docks_available, in_service), in
    time order, one per poll. An out-of-service poll ends an episode (the
    station is unusable for a different reason, logged separately).
    Returns a list of dicts: kind, start, end (the first poll after the
    episode, or None), polls, duration_min, ongoing (True if the data ended
    first, so the duration is a lower bound).
    """
    events = []
    open_ev = {"stockout": None, "fullout": None}
    for i, (t, bikes, docks, ok) in enumerate(polls):
        state = {"stockout": ok and bikes == 0, "fullout": ok and docks == 0}
        for kind in ("stockout", "fullout"):
            if state[kind] and open_ev[kind] is None:
                open_ev[kind] = (i, t)
            elif not state[kind] and open_ev[kind] is not None:
                i0, t0 = open_ev[kind]
                events.append({"kind": kind, "start": t0, "end": t, "polls": i - i0,
                               "duration_min": (i - i0) * poll_minutes, "ongoing": False})
                open_ev[kind] = None
    for kind, ev in open_ev.items():
        if ev is not None:
            i0, t0 = ev
            n = len(polls) - i0
            events.append({"kind": kind, "start": t0, "end": None, "polls": n,
                           "duration_min": n * poll_minutes, "ongoing": True})
    events.sort(key=lambda e: e["start"])
    return events


# ------------------------------------------------------------- X-bar chart

def mean(xs):
    """Arithmetic mean. math.fsum is exactly rounded, so every Python version
    gives the same answer (built-in sum() changed its float rounding in 3.12)."""
    return math.fsum(xs) / len(xs)


def variance(xs):
    """Sample variance (n - 1 denominator)."""
    m = mean(xs)
    return math.fsum((x - m) ** 2 for x in xs) / (len(xs) - 1)


def xbar_chart(subgroups):
    """Averages (X-bar) chart with limits from the within-subgroup spread.

    subgroups: ordered list of (label, [values]).
    Grand mean X-double-bar = mean of the subgroup means.
    sigma_short = sqrt(mean of the within-subgroup variances), over subgroups
    with n >= 2 (a single value has no within-subgroup spread).
    For each subgroup: SE = sigma_short / sqrt(n), UCL/LCL = X-double-bar +/- 3 SE.
    Returns grand_mean, sigma_short, message, and points (label, n, mean,
    ucl, lcl, out). Limits are None with a message when sigma_short is 0 or
    no subgroup has two values.
    """
    pts = [(lab, list(v)) for lab, v in subgroups if len(v) > 0]
    if not pts:
        raise ValueError("no subgroup has any values")
    means = [mean(v) for _, v in pts]
    grand = mean(means)
    variances = [variance(v) for _, v in pts if len(v) >= 2]
    sigma = math.sqrt(mean(variances)) if variances else None
    message = None
    if sigma is None:
        message = "every subgroup has one value: no within-subgroup variation to set limits"
    elif sigma == 0:
        message = "no within-subgroup variation (constant data): control limits undefined"
    points = []
    for (lab, v), m in zip(pts, means):
        if sigma:
            se = sigma / math.sqrt(len(v))
            ucl, lcl = grand + 3 * se, grand - 3 * se
            out = m > ucl or m < lcl
        else:
            ucl = lcl = None
            out = False
        points.append({"label": lab, "n": len(v), "mean": m, "ucl": ucl, "lcl": lcl, "out": out})
    return {"grand_mean": grand, "sigma_short": sigma, "message": message, "points": points}


# ----------------------------------------------------------------- p-chart

def p_chart(baseline, monitor=()):
    """Proportion chart; p-bar from the baseline, limits per point by its n.

    baseline, monitor: lists of (defectives, n). Here a "defective" is an
    unusable station at one poll (out of service, 0 bikes or 0 docks) and n is
    the number of stations polled.
    p-bar = total defectives / total n over the baseline.
    UCL/LCL = p-bar +/- 3 sqrt(p-bar (1 - p-bar) / n); LCL floored at 0, UCL
    capped at 1.
    """
    base = list(baseline)
    tot_n = sum(n for _, n in base)
    if tot_n == 0:
        raise ValueError("baseline has no observations")
    pbar = sum(x for x, _ in base) / tot_n
    points = []
    for phase, rows in (("baseline", base), ("monitor", list(monitor))):
        for x, n in rows:
            if n <= 0:
                continue
            p = x / n
            half = 3 * math.sqrt(pbar * (1 - pbar) / n)
            ucl, lcl = min(1.0, pbar + half), max(0.0, pbar - half)
            points.append({"p": p, "n": n, "ucl": ucl, "lcl": lcl, "phase": phase,
                           "out": (p > ucl or p < lcl) if half > 0 else False})
    msg = None
    if pbar in (0.0, 1.0):
        msg = "p-bar is %g: no variation, limits collapse" % pbar
    return {"pbar": pbar, "message": msg, "points": points}


# -------------------------------------------------------------------- FMEA

def rpn(severity, occurrence, detection):
    """Risk priority number RPN = S x O x D, each scored 1-10."""
    for v in (severity, occurrence, detection):
        if not (isinstance(v, int) and 1 <= v <= 10):
            raise ValueError("S, O and D must be whole numbers from 1 to 10")
    return severity * occurrence * detection


# rate (share of opportunities affected) -> occurrence score, highest first
OCCURRENCE_SCALE = ((0.30, 10), (0.20, 9), (0.10, 8), (0.05, 7), (0.02, 6),
                    (0.01, 5), (0.005, 4), (0.002, 3), (0.0005, 2))


def occurrence_score(rate):
    """Map an observed failure rate (0-1) to an FMEA occurrence score 1-10.

    Scale (team's choice, log-spaced like the AIAG table): >=30% -> 10,
    >=20% -> 9, >=10% -> 8, >=5% -> 7, >=2% -> 6, >=1% -> 5, >=0.5% -> 4,
    >=0.2% -> 3, >=0.05% -> 2, else 1.
    """
    if not 0 <= rate <= 1:
        raise ValueError("rate must be a proportion between 0 and 1")
    for cut, score in OCCURRENCE_SCALE:
        if rate >= cut:
            return score
    return 1


def pareto(items):
    """items: list of (name, value). Sorted descending with cumulative %."""
    rows = sorted(items, key=lambda kv: -kv[1])
    total = sum(v for _, v in rows)
    if total <= 0:
        raise ValueError("Pareto needs a positive total")
    out, run = [], 0
    for name, v in rows:
        run += v
        out.append({"name": name, "value": v, "pct": 100 * v / total, "cum_pct": 100 * run / total})
    return out


def median(xs):
    """Middle value (mean of the two middle values for an even count)."""
    if not xs:
        raise ValueError("median of an empty list")
    v = sorted(xs)
    k = len(v) // 2
    return v[k] if len(v) % 2 else (v[k - 1] + v[k]) / 2


def repeat_offender_threshold(repair_counts, minimum=3, multiple=2):
    """Repairs a station needs to count as a repeat offender.

    At least `minimum` repairs AND at least `multiple` x the network median, so
    a bad week where every station breaks still singles out the chronic ones.
    """
    return max(minimum, multiple * median(list(repair_counts)))


# ------------------------------------------------------------- reliability

def _check_r(rs):
    if not rs:
        raise ValueError("need at least one reliability")
    for r in rs:
        if not 0 <= r <= 1:
            raise ValueError("reliabilities must be between 0 and 1")


def series(*rs):
    """Series system: works only if every block works. R = R1 x R2 x ..."""
    _check_r(rs)
    return math.prod(rs)


def parallel(*rs):
    """Parallel system: works if any block works. R = 1 - (1-R1)(1-R2)..."""
    _check_r(rs)
    return 1 - math.prod(1 - r for r in rs)


def availability(mtbf, mttr):
    """Steady-state availability A = MTBF / (MTBF + MTTR)."""
    if mtbf < 0 or mttr < 0 or mtbf + mttr == 0:
        raise ValueError("need MTBF, MTTR >= 0 and not both 0")
    return mtbf / (mtbf + mttr)


def mtbf_mttr(operating_hours, repair_minutes):
    """MTBF = operating time / number of failures; MTTR = mean repair time.

    repair_minutes: one value per completed repair (open tickets excluded).
    Returns (mtbf_hours, mttr_hours); MTBF is None when there were no failures.
    """
    if operating_hours <= 0:
        raise ValueError("operating time must be positive")
    if not repair_minutes:
        return None, None
    return operating_hours / len(repair_minutes), mean(repair_minutes) / 60


# ---------------------------------------------------------------- forecast

def forecast_bikes(bikes_now, capacity, hist_fill_now, hist_fill_later, margin=None):
    """Project bikes ahead with the historical average change for that time slot.

    projected = bikes_now + (hist_fill_later - hist_fill_now) x capacity,
    where hist_fill_* are the average fill fractions (0-1) at this weekday and
    time of day, from earlier weeks. Clamped to [0, capacity].
    Risk is "empty" when the projection is within `margin` bikes of 0, "full"
    when within `margin` open docks of capacity, else None. The default
    margin is 10% of capacity, at least 1: an early warning, not a certainty.
    Returns (projected bikes, risk).
    """
    if capacity <= 0:
        return None, None
    if margin is None:
        margin = max(1.0, 0.1 * capacity)
    raw = bikes_now + (hist_fill_later - hist_fill_now) * capacity
    proj = min(float(capacity), max(0.0, raw))
    risk = "empty" if proj <= margin else "full" if proj >= capacity - margin else None
    return proj, risk
