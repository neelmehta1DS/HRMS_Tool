import json
from datetime import date
from pathlib import Path

_raw: list[dict] = json.loads((Path(__file__).parent.parent.parent / "holidays.json").read_text())

HOLIDAYS: list[dict] = _raw
HOLIDAY_DATES: frozenset[date] = frozenset(date.fromisoformat(h["date"]) for h in _raw)
