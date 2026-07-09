"""Shared helpers for tests. Fixtures live in conftest.py; plain functions here."""
from datetime import date, timedelta

from core.holidays import HOLIDAY_DATES


def next_working_day(d: date) -> date:
    """The first weekday on or after d that is not a company holiday."""
    while d.weekday() >= 5 or d in HOLIDAY_DATES:
        d += timedelta(days=1)
    return d


def future_working_date(days: int = 30) -> str:
    """A date at least `days` out, rolled forward to a working day.

    Leave balances count working days only (see count_weekdays in
    routes/leaves.py), so a one-day leave starting on a weekend or holiday
    consumes zero balance. Any test asserting on days_taken must anchor to a
    working day, or it fails on whichever days of the year today + `days`
    lands on a Saturday.

    Rolling forward never shortens the notice period, so advance-notice rules
    stay satisfied.
    """
    return str(next_working_day(date.today() + timedelta(days=days)))


def today_str() -> str:
    return str(date.today())
