"""Recurring annual occasions (birthdays, work anniversaries).

Both are stored as a single historical date and observed every year after.
Feb 29 is observed on Feb 28 in non-leap years.
"""
from datetime import date


def _project(d: date, year: int) -> date:
    """Return d's month/day in the given year, folding Feb 29 onto Feb 28."""
    try:
        return d.replace(year=year)
    except ValueError:
        return d.replace(year=year, day=28)


def next_occurrence(d: date, today: date) -> date:
    """The first observance of d falling on or after today."""
    this_year = _project(d, today.year)
    if this_year >= today:
        return this_year
    return _project(d, today.year + 1)


def occurrences_in_range(d: date, start: date, end: date) -> list[date]:
    """Every observance of d falling within [start, end] inclusive.

    Unlike next_occurrence this looks both backwards and forwards, and handles
    a window spanning a year boundary (e.g. a Dec->Jan calendar view).
    """
    return [
        occurrence
        for year in range(start.year, end.year + 1)
        if start <= (occurrence := _project(d, year)) <= end
    ]
