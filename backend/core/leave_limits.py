import json
from pathlib import Path

_JSON_PATH = Path(__file__).parent.parent.parent / "leave_limits.json"
LEAVE_LIMITS: dict = json.loads(_JSON_PATH.read_text())


def persist_leave_limits() -> None:
    """Write current LEAVE_LIMITS dict to disk."""
    _JSON_PATH.write_text(json.dumps(LEAVE_LIMITS, indent=2))
