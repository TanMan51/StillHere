"""Tests for the learned routine. Owner: Person B.

Run from the backend folder:  python -m pytest tests/test_routine.py
These tests pass on the stub. Add learned-routine tests as the real logic lands.
"""

from datetime import datetime, timedelta, timezone

from app.routine import compute_baseline, evaluate, generate_week, next_alert_time

UTC = timezone.utc
NOW = datetime(2026, 9, 26, 14, 15, tzinfo=UTC)
TZ = "America/New_York"
LIMIT = 720


def test_empty_history_is_not_ready():
    baseline = compute_baseline([], NOW, TZ)
    assert baseline.ready is False
    assert len(baseline.hourly_activity) == 24
    assert len(baseline.hourly_threshold_minutes) == 24


def test_baseline_dict_matches_contract_fields():
    fields = set(compute_baseline([], NOW, TZ).to_dict())
    assert fields == {
        "ready",
        "days_of_data",
        "timezone",
        "hourly_activity",
        "hourly_threshold_minutes",
    }


def test_gap_past_fixed_limit_is_flagged():
    baseline = compute_baseline([], NOW, TZ)
    verdict = evaluate(baseline, NOW - timedelta(hours=13), NOW, LIMIT, "Mom's fridge")
    assert verdict.irregular is True
    assert verdict.reason == "fixed_limit"


def test_recent_motion_is_not_flagged():
    baseline = compute_baseline([], NOW, TZ)
    verdict = evaluate(baseline, NOW - timedelta(minutes=20), NOW, LIMIT, "Mom's fridge")
    assert verdict.irregular is False


def test_no_motion_ever_is_not_flagged():
    baseline = compute_baseline([], NOW, TZ)
    assert evaluate(baseline, None, NOW, LIMIT, "Mom's fridge").irregular is False
    assert next_alert_time(baseline, None, NOW, LIMIT) is None


def test_next_alert_uses_fixed_limit_when_not_ready():
    baseline = compute_baseline([], NOW, TZ)
    last = NOW - timedelta(hours=1)
    assert next_alert_time(baseline, last, NOW, LIMIT) == last + timedelta(minutes=LIMIT)


def test_generate_week_is_sorted_and_not_in_future():
    times = generate_week(NOW, TZ)
    assert times == sorted(times)
    assert all(t <= NOW for t in times)
