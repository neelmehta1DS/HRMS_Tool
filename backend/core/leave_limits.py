import json
from pathlib import Path

# leave_policy.json is the *bootstrap default*, loaded once at import so tests and
# a fresh boot always have values. At runtime the database is the source of truth:
# core/config_store.py seeds the DB from these defaults and then keeps LEAVE_LIMITS
# / LEAVE_RULES in sync. Both are mutated in place so existing imports keep seeing
# the current values.
_JSON_PATH = Path(__file__).parent.parent.parent / "leave_policy.json"
LEAVE_POLICY: dict = json.loads(_JSON_PATH.read_text())

LEAVE_LIMITS: dict = LEAVE_POLICY["limits"]
LEAVE_RULES: dict = LEAVE_POLICY["rules"]


def get_notice_days(duration: int, rules: list) -> int:
    """Required calendar-day notice for a leave of `duration` working days.

    Ladder-agnostic: `rules` is any list of {min, max?, notice} rungs, so earned
    and casual share this. A rung with no `max` is open-ended and matches every
    duration at or above its `min`.
    """
    for rule in rules:
        lo = rule.get("min", 1)
        hi = rule.get("max")
        if duration >= lo and (hi is None or duration <= hi):
            return rule.get("notice", 0)
    return 0
