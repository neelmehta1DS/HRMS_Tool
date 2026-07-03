import json
from datetime import date
from pathlib import Path

_JSON_PATH = Path(__file__).parent.parent.parent / "holidays.json"
_raw: list[dict] = json.loads(_JSON_PATH.read_text())

HOLIDAYS: list[dict] = _raw
# Mutable set so in-place updates are visible to all importers
HOLIDAY_DATES: set[date] = set(date.fromisoformat(h["date"]) for h in _raw)


def _persist_and_reload() -> None:
    """Write HOLIDAYS to disk sorted by date, and rebuild HOLIDAY_DATES in-place."""
    sorted_holidays = sorted(HOLIDAYS, key=lambda h: h["date"])
    HOLIDAYS.clear()
    HOLIDAYS.extend(sorted_holidays)
    _JSON_PATH.write_text(json.dumps(HOLIDAYS, indent=2))
    HOLIDAY_DATES.clear()
    HOLIDAY_DATES.update(date.fromisoformat(h["date"]) for h in HOLIDAYS)
