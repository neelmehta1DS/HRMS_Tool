import json
from pathlib import Path

LEAVE_LIMITS: dict = json.loads((Path(__file__).parent.parent.parent / "leave_limits.json").read_text())
