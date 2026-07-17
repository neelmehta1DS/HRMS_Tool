import json
from datetime import date
from pathlib import Path

# holidays.json is the *bootstrap default*, loaded once at import so tests and a
# fresh boot always have values. At runtime the database is the source of truth:
# core/config_store.py seeds the DB from these defaults and then keeps HOLIDAYS /
# HOLIDAY_DATES in sync with it. Both are mutable containers updated in place, so
# `from core.holidays import HOLIDAYS` bindings keep seeing the current values.
_JSON_PATH = Path(__file__).parent.parent.parent / "holidays.json"
_raw: list[dict] = json.loads(_JSON_PATH.read_text())

HOLIDAYS: list[dict] = _raw
HOLIDAY_DATES: set[date] = set(date.fromisoformat(h["date"]) for h in _raw)


def reindex() -> None:
    """Re-sort HOLIDAYS by date and rebuild HOLIDAY_DATES in place.

    Called after an in-memory edit. Persistence is the caller's job — see
    core/config_store.py.
    """
    HOLIDAYS.sort(key=lambda h: h["date"])
    HOLIDAY_DATES.clear()
    HOLIDAY_DATES.update(date.fromisoformat(h["date"]) for h in HOLIDAYS)
