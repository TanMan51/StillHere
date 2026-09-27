"""Tests for the learned routine. Owner: Person B.

Run from the backend folder:  python -m pytest tests/test_routine.py
Tests cover the fixed fallback, learning, countdowns, and daylight saving time.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from app.routine import Baseline, compute_baseline, evaluate, generate_week, next_alert_time
from app.routine.baseline import SURPRISE_LIMIT, describe_duration

UTC = timezone.utc
NOW = datetime(2026, 9, 26, 14, 15, tzinfo=UTC)
TZ = "America/New_York"
LIMIT = 720


def test_empty_history_is_not_ready() -> None:
    baseline = compute_baseline([], NOW, TZ)
    assert baseline.ready is False
    assert len(baseline.hourly_activity) == 24
    assert len(baseline.hourly_threshold_minutes) == 24


def test_baseline_dict_matches_contract_fields() -> None:
    fields = set(compute_baseline([], NOW, TZ).to_dict())
    assert fields == {
        "ready",
        "days_of_data",
        "timezone",
        "hourly_activity",
        "hourly_threshold_minutes",
    }


def test_gap_past_fixed_limit_is_flagged() -> None:
    baseline = compute_baseline([], NOW, TZ)
    verdict = evaluate(baseline, NOW - timedelta(hours=13), NOW, LIMIT, "Mom's fridge")
    assert verdict.irregular is True
    assert verdict.reason == "fixed_limit"


def test_recent_motion_is_not_flagged() -> None:
    baseline = compute_baseline([], NOW, TZ)
    verdict = evaluate(baseline, NOW - timedelta(minutes=20), NOW, LIMIT, "Mom's fridge")
    assert verdict.irregular is False


def test_no_motion_ever_is_not_flagged() -> None:
    baseline = compute_baseline([], NOW, TZ)
    assert evaluate(baseline, None, NOW, LIMIT, "Mom's fridge").irregular is False
    assert next_alert_time(baseline, None, NOW, LIMIT) is None


def test_next_alert_uses_fixed_limit_when_not_ready() -> None:
    baseline = compute_baseline([], NOW, TZ)
    last = NOW - timedelta(hours=1)
    assert next_alert_time(baseline, last, NOW, LIMIT) == last + timedelta(minutes=LIMIT)


def test_generate_week_is_sorted_and_not_in_future() -> None:
    times = generate_week(NOW, TZ)
    assert times == sorted(times)
    assert all(t <= NOW for t in times)


def test_normal_morning_is_not_flagged() -> None:
    morning = NOW.replace(hour=12, minute=30)
    times = generate_week(morning, TZ)
    baseline = compute_baseline(times, morning, TZ)
    assert baseline.ready
    assert not evaluate(baseline, times[-1], morning, LIMIT, "Fridge").irregular


def test_missed_breakfast_is_flagged() -> None:
    today = NOW.astimezone(ZoneInfo(TZ)).date()
    history = [t for t in generate_week(NOW, TZ) if t.astimezone(ZoneInfo(TZ)).date() < today]
    baseline = compute_baseline(history, NOW, TZ)
    verdict = evaluate(baseline, history[-1], NOW, 1440, "Fridge")
    assert verdict.irregular and verdict.reason == "learned"
    assert "around 10 AM" in verdict.note
    assert "minutes" not in verdict.note


@pytest.mark.parametrize(
    ("minutes", "text"),
    [
        (0.5, "1 minute"),
        (45, "45 minutes"),
        (75, "about an hour"),
        (675, "about 11 hours"),
        (2880, "about 2 days"),
    ],
)
def test_durations_read_naturally(minutes: float, text: str) -> None:
    assert describe_duration(minutes) == text


def test_normal_overnight_gap_is_not_flagged() -> None:
    overnight = NOW.replace(hour=9, minute=0)
    times = generate_week(overnight, TZ)
    baseline = compute_baseline(times, overnight, TZ)
    assert baseline.ready
    assert not evaluate(baseline, times[-1], overnight, LIMIT, "Fridge").irregular


def test_short_history_is_not_ready() -> None:
    assert not compute_baseline(generate_week(NOW, TZ, days=4), NOW, TZ).ready


def test_future_and_duplicate_events_do_not_change_baseline() -> None:
    history = generate_week(NOW, TZ)
    assert compute_baseline(history, NOW, TZ) == compute_baseline(
        history + history + [NOW + timedelta(days=1)], NOW, TZ
    )


def test_synthetic_week_is_nonempty_deterministic_and_bounded() -> None:
    times = generate_week(NOW, TZ)
    assert len(times) >= 60
    assert times == generate_week(NOW, TZ)
    assert all(NOW - timedelta(days=7) <= t <= NOW for t in times)


def test_next_alert_finds_when_a_busy_hour_makes_silence_unlikely() -> None:
    rates = [0.0] * 24
    rates[10] = 6.0  # six visits an hour are expected from 10 to 11
    baseline = Baseline(True, 7, "UTC", [1] * 24, [720] * 24, rates)
    now = NOW.replace(hour=9, minute=50, second=0)
    last = now.replace(hour=7, minute=0)
    expected = now.replace(hour=10, minute=0) + timedelta(hours=SURPRISE_LIMIT / 6)
    alert_at = next_alert_time(baseline, last, now, 1440)
    assert abs((alert_at - expected).total_seconds()) < 0.001
    assert not evaluate(baseline, last, alert_at - timedelta(seconds=1), 1440, "Fridge").irregular
    assert evaluate(baseline, last, alert_at, 1440, "Fridge").reason == "learned"


def test_quiet_stretch_after_breakfast_is_not_flagged() -> None:
    before_lunch = NOW.replace(hour=15, minute=55)  # 11:55 AM in New York
    history = generate_week(before_lunch, TZ)
    baseline = compute_baseline(history, before_lunch, TZ)
    assert not evaluate(baseline, history[-1], before_lunch, LIMIT, "Fridge").irregular


def test_learned_note_gives_the_chance() -> None:
    today = NOW.astimezone(ZoneInfo(TZ)).date()
    history = [t for t in generate_week(NOW, TZ) if t.astimezone(ZoneInfo(TZ)).date() < today]
    verdict = evaluate(compute_baseline(history, NOW, TZ), history[-1], NOW, 1440, "Fridge")
    assert "% chance" in verdict.note


def test_a_burst_of_motion_counts_as_one_visit() -> None:
    history = generate_week(NOW, TZ)
    burst = [t + timedelta(seconds=s) for t in history for s in (0, 20, 40)]
    assert (
        compute_baseline(burst, NOW, TZ).hourly_rate
        == compute_baseline(history, NOW, TZ).hourly_rate
    )


def test_model_learns_a_rate_for_each_hour() -> None:
    baseline = compute_baseline(generate_week(NOW, TZ), NOW, TZ)
    assert len(baseline.hourly_rate) == 24
    assert baseline.hourly_rate[7] > baseline.hourly_rate[3]  # breakfast vs the middle of the night


def test_fixed_limit_caps_learned_threshold() -> None:
    baseline = Baseline(True, 7, TZ, [1] * 24, [2000] * 24)
    verdict = evaluate(baseline, NOW - timedelta(minutes=720), NOW, 720, "Fridge")
    assert verdict.irregular and verdict.reason == "fixed_limit"


def test_naive_dates_are_rejected() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        compute_baseline([], NOW.replace(tzinfo=None), TZ)


def test_dst_history_and_next_alert_are_consistent() -> None:
    end = datetime(2026, 11, 1, 8, tzinfo=UTC)
    history = generate_week(end, TZ)
    baseline = compute_baseline(history, end, TZ)
    assert baseline.ready
    alert_at = next_alert_time(baseline, history[-1], end, LIMIT)
    assert alert_at >= end
    assert evaluate(baseline, history[-1], alert_at, LIMIT, "Fridge").irregular


# --- Wellness trends (routine/trends.py) ---

TREND_NOW = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)


def _daily(per_day: list[int]) -> list[datetime]:
    """per_day[0] is 29 days ago, per_day[-1] today; events at local noon-ish."""
    zone = ZoneInfo("America/New_York")
    today = TREND_NOW.astimezone(zone).date()
    times = []
    for offset, count in enumerate(per_day):
        day = today - timedelta(days=len(per_day) - 1 - offset)
        for i in range(count):
            local = datetime(day.year, day.month, day.day, 8, tzinfo=zone) + timedelta(minutes=i)
            times.append(local.astimezone(timezone.utc))
    return times


def test_daily_counts_cover_thirty_local_days():
    from app.routine import daily_counts

    counts = daily_counts(_daily([2] * 30), TREND_NOW, "America/New_York")
    assert len(counts) == 30
    assert all(c == 2 for _, c in counts)


def test_steady_activity_is_not_flagged():
    from app.routine import activity_trend

    trend = activity_trend(_daily([10] * 30), TREND_NOW, "America/New_York")
    assert trend.recent_daily_average == 10 and trend.prior_daily_average == 10
    assert not trend.lower_than_usual and trend.note is None


def test_drop_against_own_average_is_flagged_without_medical_wording():
    from app.routine import activity_trend

    trend = activity_trend(_daily([10] * 22 + [3] * 7 + [1]), TREND_NOW, "America/New_York")
    assert trend.lower_than_usual
    assert trend.note.startswith("Activity lower than usual")
    for word in ("health", "sick", "decline", "diagnos", "ill"):
        assert word not in trend.note.lower()


def test_too_little_history_is_never_flagged():
    from app.routine import activity_trend

    trend = activity_trend(_daily([1] * 23 + [0] * 7), TREND_NOW, "America/New_York")
    assert not trend.lower_than_usual  # prior average below the minimum to compare against
    assert activity_trend([], TREND_NOW, "America/New_York").recent_daily_average == 0


# --- "Watch it learn" replay (routine/learning.py) ---


def test_replay_learns_day_by_day_and_becomes_ready():
    from app.routine import generate_week, learning_replay

    now = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
    times = generate_week(now, "America/New_York", days=10, object_type="fridge")
    replay = learning_replay(times, now, "America/New_York")
    frames = replay["frames"]
    assert len(frames) == 11  # the first partial day through today
    assert [f["days_of_data"] for f in frames] == sorted(f["days_of_data"] for f in frames)
    assert not frames[0]["ready"] and frames[-1]["ready"]
    first_ready = next(i for i, f in enumerate(frames) if f["ready"])
    assert frames[first_ready]["days_of_data"] == replay["days_needed"]
    # The learned rates peak around the fridge's meal times, not at night.
    rates = frames[-1]["hourly_rate"]
    assert rates[12] > rates[3] and rates[18] > rates[3]
    assert all(0 <= minute < 1440 for f in frames for minute in f["visits"])


def test_replay_judges_the_current_quiet_stretch():
    from app.routine import generate_week, learning_replay

    now = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)  # 11 AM in New York
    times = generate_week(now, "America/New_York", days=14, object_type="fridge")
    recent = learning_replay(times, now, "America/New_York")["now"]
    assert 0 < recent["chance_of_quiet"] <= 1
    quiet = [t for t in times if t <= now - timedelta(hours=16)]
    long_gap = learning_replay(quiet, now, "America/New_York")["now"]
    assert long_gap["unusual"] and long_gap["chance_of_quiet"] < 0.05
    what_if = learning_replay(times, now, "America/New_York")["what_if"]
    assert what_if[0]["quiet_minutes"] == 30 and not what_if[0]["unusual"]
    assert any(step["unusual"] for step in what_if)


def test_replay_without_history():
    from app.routine import learning_replay

    now = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
    replay = learning_replay([], now, "America/New_York")
    assert replay["frames"] == [] and replay["now"]["chance_of_quiet"] is None
