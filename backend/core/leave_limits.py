import json
from pathlib import Path

_JSON_PATH = Path(__file__).parent.parent.parent / "leave_policy.json"
LEAVE_POLICY: dict = json.loads(_JSON_PATH.read_text())

# Aliases kept so existing importers don't need to change
LEAVE_LIMITS: dict = LEAVE_POLICY["limits"]
LEAVE_RULES: dict = LEAVE_POLICY["rules"]


def persist_leave_limits() -> None:
    _JSON_PATH.write_text(json.dumps(LEAVE_POLICY, indent=2))


def get_notice_days(duration: int, rules) -> int:
    if isinstance(rules, dict):
        return rules.get(str(duration), rules.get("default", 1))
    for rule in rules:
        lo = rule.get("min", 1)
        hi = rule.get("max")
        if duration >= lo and (hi is None or duration <= hi):
            return rule.get("notice", 1)
    return 1
