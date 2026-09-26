"""Daily movement counts and a non-diagnostic "activity lower than usual" flag. Owned by Person B.

Pure: motion times, now, and the timezone in; an answer out. The flag compares a resident
with their own recent past (last 7 full days against the 21 before), never with other people,
and it only ever says activity is lower than usual. It is a nudge for a wellness visit, not a
health judgment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

TREND_DAYS = 30
RECENT_DAYS = 7
PRIOR_DAYS = 21
# The recent daily average has to fall below this share of the prior one to be flagged.
DROP_RATIO = 0.6
# Below this many prior movements a day there isn't enough history to compare against.
MIN_PRIOR_DAILY = 3.0


@dataclass
class Trend:
    # Oldest first; the last entry is today, which is still in progress.
    days: list[dict] = field(default_factory=list)
    recent_daily_average: float | None = None
    prior_daily_average: float | None = None
    lower_than_usual: bool = False
    note: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def daily_counts(
    motion_times: list[datetime], now: datetime, timezone: str, days: int = TREND_DAYS
) -> list[tuple[date, int]]:
    """Movement events per local calendar day, for the `days` days ending today."""
    if now.tzinfo is None:
        raise ValueError("Expected a timezone-aware now")
    zone = ZoneInfo(timezone)
    today = now.astimezone(zone).date()
    first = today - timedelta(days=days - 1)
    counts = {first + timedelta(days=i): 0 for i in range(days)}
    for moment in motion_times:
        if moment > now:
            continue
        day = moment.astimezone(zone).date()
        if day in counts:
            counts[day] += 1
    return sorted(counts.items())


def _average(values: list[int]) -> float:
    return round(sum(values) / len(values), 1)


def activity_trend(
    motion_times: list[datetime], now: datetime, timezone: str, days: int = TREND_DAYS
) -> Trend:
    counts = daily_counts(motion_times, now, timezone, days)
    trend = Trend(days=[{"date": d.isoformat(), "count": c} for d, c in counts])
    # Today is partial, so compare full days only.
    full = [c for _, c in counts[:-1]]
    if len(full) < RECENT_DAYS + PRIOR_DAYS:
        return trend
    recent = full[-RECENT_DAYS:]
    prior = full[-(RECENT_DAYS + PRIOR_DAYS) : -RECENT_DAYS]
    trend.recent_daily_average = _average(recent)
    trend.prior_daily_average = _average(prior)
    if trend.prior_daily_average >= MIN_PRIOR_DAILY:
        drop = trend.recent_daily_average < DROP_RATIO * trend.prior_daily_average
        trend.lower_than_usual = drop
        if drop:
            trend.note = (
                f"Activity lower than usual: about {trend.recent_daily_average:g} movements a "
                f"day this week, compared with {trend.prior_daily_average:g} over the three "
                "weeks before."
            )
    return trend
