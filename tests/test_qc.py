"""Known-answer and degenerate tests for app/qc.py (numbers from SPEC.md section 4)."""

import math

import pytest

from app.qc import (availability, median, most_common_n, repeat_offender_threshold, effective_capacity, event_log, fill_category, fill_pct,
                    forecast_bikes, misleading_flag, mtbf_mttr, occurrence_score,
                    p_chart, parallel, pareto, rpn, series, xbar_chart)


# ---- fill level (SPEC 4b)

def test_fill_known_answer():
    eff = effective_capacity(12, 4)
    assert eff == 8
    assert fill_pct(6, eff) == 75.0
    assert fill_category(6, eff) == "high"
    assert fill_category(6, 12) == "medium"
    assert misleading_flag(6, 0, 2, 4) == "looks_emptier"


def test_fill_category_boundaries():
    assert fill_category(0, 10) == "empty"
    assert fill_category(1, 10) == "low"      # 10%
    assert fill_category(3, 10) == "medium"   # 30%
    assert fill_category(7, 10) == "high"     # 70%
    assert fill_category(199, 200) == "high"  # 99.5% is not full
    assert fill_category(10, 10) == "full"


def test_fill_degenerate_zero_capacity():
    assert effective_capacity(10, 10) == 0
    assert fill_pct(0, 0) is None
    assert fill_category(0, 0) is None
    with pytest.raises(ValueError):
        effective_capacity(10, 11)


def test_misleading_flags():
    assert misleading_flag(8, 0, 0, 4) == "full_due_to_broken_docks"
    assert misleading_flag(0, 2, 8, 0) == "empty_due_to_broken_bikes"
    assert misleading_flag(5, 0, 5, 0) is None


# ---- stockout / fullout log

def test_event_log_durations():
    polls = [(0, 3, 5, True), (5, 0, 8, True), (10, 0, 8, True), (15, 2, 6, True),
             (20, 8, 0, True), (25, 0, 8, False), (30, 0, 8, True)]
    ev = event_log(polls)
    assert [(e["kind"], e["start"], e["duration_min"], e["ongoing"]) for e in ev] == [
        ("stockout", 5, 10, False), ("fullout", 20, 5, False), ("stockout", 30, 5, True)]


def test_event_log_empty_input():
    assert event_log([]) == []


# ---- X-bar chart (SPEC 4a)

def test_xbar_known_answer():
    r = xbar_chart([("A", [10, 20, 30]), ("B", [40, 50, 60])])
    assert r["grand_mean"] == 35
    assert r["sigma_short"] == pytest.approx(10)
    a = r["points"][0]
    assert a["ucl"] == pytest.approx(52.3205, abs=1e-4)
    assert a["lcl"] == pytest.approx(17.6795, abs=1e-4)
    assert [p["out"] for p in r["points"]] == [False, False]


def test_xbar_constant_limits_use_most_common_n():
    # A and B have n = 3, C has n = 2; the most common n is 3, used for every point.
    # sigma_short = sqrt((100 + 100 + 50) / 3) = 9.1287; SE = 9.1287 / sqrt(3) = 5.2705
    # X-double-bar = (20 + 50 + 35) / 3 = 35; UCL = 50.8114, LCL = 19.1886 for all three
    r = xbar_chart([("A", [10, 20, 30]), ("B", [40, 50, 60]), ("C", [30, 40])], constant_limits=True)
    assert r["n_limits"] == 3 and r["sigma_short"] == pytest.approx(9.1287, abs=1e-4)
    assert {round(p["ucl"], 4) for p in r["points"]} == {50.8114}
    assert {round(p["lcl"], 4) for p in r["points"]} == {19.1886}
    # without the option, C gets its own wider limits (n = 2)
    assert xbar_chart([("A", [10, 20, 30]), ("B", [40, 50, 60]), ("C", [30, 40])])["points"][2]["ucl"] == pytest.approx(35 + 3 * 9.1287 / 2 ** 0.5, abs=1e-3)


def test_most_common_n():
    assert most_common_n([36, 36, 35, 36]) == 36
    assert most_common_n([4, 5, 5, 4]) == 4  # tie -> the smaller n (wider limits)
    with pytest.raises(ValueError):
        most_common_n([])


def test_p_chart_constant_limits():
    r = p_chart([(2, 20), (2, 20), (1, 10)], [(7, 20)], constant_limits=True)
    assert r["n_limits"] == 20 and len({p["ucl"] for p in r["points"]}) == 1


def test_xbar_flags_planted_shift():
    groups = [(i, [50, 52, 48]) for i in range(10)] + [("shift", [70, 72, 68])]
    r = xbar_chart(groups)
    assert [p["label"] for p in r["points"] if p["out"]] == ["shift"]


def test_xbar_degenerate_constant():
    r = xbar_chart([("A", [5, 5, 5]), ("B", [5, 5])])
    assert r["sigma_short"] == 0
    assert r["points"][0]["ucl"] is None and r["message"]


def test_xbar_degenerate_n1():
    r = xbar_chart([("A", [5]), ("B", [7])])
    assert r["sigma_short"] is None and r["grand_mean"] == 6 and r["message"]
    with pytest.raises(ValueError):
        xbar_chart([("A", [])])


# ---- p-chart (SPEC 4d)

def test_p_chart_known_answer():
    r = p_chart([(2, 20)] * 5, [(7, 20)])
    assert r["pbar"] == pytest.approx(0.10)
    pt = r["points"][0]
    assert pt["ucl"] == pytest.approx(0.1 + 3 * math.sqrt(0.09 / 20))
    assert pt["ucl"] == pytest.approx(0.3012, abs=1e-4)
    assert pt["lcl"] == 0.0
    assert r["points"][-1]["out"] and r["points"][-1]["phase"] == "monitor"


def test_p_chart_degenerate():
    r = p_chart([(0, 20), (0, 20)])
    assert r["pbar"] == 0 and r["message"] and not any(p["out"] for p in r["points"])
    with pytest.raises(ValueError):
        p_chart([(0, 0)])


# ---- FMEA (SPEC 4e)

def test_rpn_known_answer_and_bounds():
    assert rpn(8, 5, 3) == 120
    with pytest.raises(ValueError):
        rpn(0, 5, 3)
    with pytest.raises(ValueError):
        rpn(11, 5, 3)


def test_occurrence_scale():
    assert occurrence_score(0.0) == 1
    assert occurrence_score(0.01) == 5
    assert occurrence_score(0.35) == 10
    with pytest.raises(ValueError):
        occurrence_score(1.5)


def test_pareto():
    p = pareto([("a", 20), ("b", 60), ("c", 20)])
    assert [r["name"] for r in p] == ["b", "a", "c"]
    assert p[0]["cum_pct"] == 60 and p[-1]["cum_pct"] == 100
    with pytest.raises(ValueError):
        pareto([("a", 0)])


# ---- reliability (SPEC 4f)

def test_reliability_known_answers():
    assert series(0.9, 0.8) == pytest.approx(0.72)
    assert parallel(0.9, 0.8) == pytest.approx(0.98)
    assert availability(95, 5) == pytest.approx(0.95)
    assert mtbf_mttr(100, [30, 90]) == (50, 1.0)


def test_reliability_degenerate():
    assert series(1, 1) == 1 and parallel(0, 0) == 0
    assert mtbf_mttr(100, []) == (None, None)
    with pytest.raises(ValueError):
        availability(0, 0)
    with pytest.raises(ValueError):
        series(1.2)


# ---- forecast

def test_forecast():
    assert forecast_bikes(5, 10, 0.5, 0.2) == (pytest.approx(2.0), None)
    assert forecast_bikes(4, 10, 0.5, 0.2) == (pytest.approx(1.0), "empty")  # within the 1-bike margin
    assert forecast_bikes(4, 20, 0.5, 0.4, margin=1) == (pytest.approx(2.0), None)
    assert forecast_bikes(2, 10, 0.5, 0.2) == (0.0, "empty")
    assert forecast_bikes(9, 10, 0.5, 0.8) == (10.0, "full")
    assert forecast_bikes(0, 0, 0.5, 0.5) == (None, None)


# ---- repeat offenders

def test_median_and_repeat_threshold():
    assert median([3, 1, 2]) == 2 and median([1, 2, 3, 4]) == 2.5
    assert repeat_offender_threshold([0, 1, 1, 2, 5]) == 3          # quiet week: the floor of 3
    assert repeat_offender_threshold([10, 12, 12, 14, 40]) == 24    # bad week: 2 x median 12
    with pytest.raises(ValueError):
        repeat_offender_threshold([])
