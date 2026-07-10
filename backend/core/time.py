"""Everyone in the company is in IST, so the app has exactly one timezone.

Timestamps are stored naive, already converted to IST. Note that SQLite's
CURRENT_TIMESTAMP (which `server_default=func.now()` compiles to) is UTC, so any
column that needs IST must default in Python instead.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now_ist() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def today_ist() -> date:
    return now_ist().date()
