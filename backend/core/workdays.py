from datetime import date, timedelta

from core.holidays import HOLIDAY_DATES


def count_weekdays(start: date, end: date) -> int:
    """Working days in an inclusive range: weekends and company holidays excluded.

    Leave balances only ever count these, so this is the one definition of what a
    leave costs someone.
    """
    count = 0
    current = start
    while current <= end:
        if current.weekday() < 5 and current not in HOLIDAY_DATES:
            count += 1
        current += timedelta(days=1)
    return count
