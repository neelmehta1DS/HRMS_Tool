import json
from pathlib import Path

_JSON_PATH = Path(__file__).parent.parent.parent / "leave_policy.json"
LEAVE_POLICY: dict = json.loads(_JSON_PATH.read_text())

LEAVE_LIMITS: dict = LEAVE_POLICY["limits"]
LEAVE_RULES: dict = LEAVE_POLICY["rules"]


def persist_leave_limits() -> None:
    _JSON_PATH.write_text(json.dumps(LEAVE_POLICY, indent=2))


def get_earned_notice_days(duration: int, rules: list) -> int:
    """Return the required calendar-day notice for an earned leave of `duration` working days."""
    for rule in rules:
        lo = rule.get("min", 1)
        hi = rule.get("max")
        if duration >= lo and (hi is None or duration <= hi):
            return rule.get("notice", 0)
    return 0


# Keep old name as alias so any stale imports don't crash immediately
def get_notice_days(duration: int, rules) -> int:
    return get_earned_notice_days(duration, rules)
