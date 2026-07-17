"""Runtime-editable config (leave limits, notice rules, holidays) lives in the
database so it survives redeploys and stays consistent across instances.

The in-memory globals in core.holidays and core.leave_limits remain the read
path — nothing on the hot path grows a DB round-trip. This module keeps those
globals in sync with the DB:

  • at import, the globals hold the JSON bootstrap defaults;
  • on startup, `bootstrap()` seeds the DB from those defaults if the row is
    absent, then loads the DB's values into the globals;
  • a scheduled `reload()` every 60s lets an instance pick up an edit made on
    another instance;
  • an admin write mutates the globals in place and calls `save()`, so the
    instance that served the edit is correct immediately and the rest converge
    within the reload interval.
"""
from __future__ import annotations

import copy
from datetime import date

from sqlalchemy.orm import Session

from core import holidays as _h
from core import leave_limits as _ll
from db.database import SessionLocal
from models.app_config import AppConfig

# The config lives in a single, fixed row.
_CONFIG_ID = 1


def _snapshot() -> dict:
    """The current in-memory config as a fresh, JSON-serialisable blob.

    Copied (not aliased) so the value handed to the ORM can't drift when the
    globals are later mutated in place.
    """
    return {
        "limits": dict(_ll.LEAVE_LIMITS),
        "rules": copy.deepcopy(_ll.LEAVE_RULES),
        "holidays": [dict(h) for h in _h.HOLIDAYS],
    }


def _apply(blob: dict) -> None:
    """Overwrite the in-memory globals in place from a config blob.

    In-place (clear/update) rather than rebinding, so existing
    `from core.x import Y` references keep pointing at the live values.
    """
    _ll.LEAVE_LIMITS.clear()
    _ll.LEAVE_LIMITS.update(blob.get("limits", {}))
    _ll.LEAVE_RULES.clear()
    _ll.LEAVE_RULES.update(blob.get("rules", {}))

    _h.HOLIDAYS.clear()
    _h.HOLIDAYS.extend(blob.get("holidays", []))
    _h.reindex()


def seed_if_empty(db: Session) -> None:
    """Create the config row from the current in-memory defaults if none exists."""
    if db.get(AppConfig, _CONFIG_ID) is None:
        db.add(AppConfig(id=_CONFIG_ID, config=_snapshot()))
        db.commit()


def load_from_db(db: Session) -> None:
    """Apply the DB's stored config to the globals; no-op if the row is absent."""
    row = db.get(AppConfig, _CONFIG_ID)
    if row is not None:
        _apply(row.config)


def save(db: Session) -> None:
    """Persist the current in-memory config to the DB (call after an admin edit)."""
    row = db.get(AppConfig, _CONFIG_ID)
    if row is None:
        db.add(AppConfig(id=_CONFIG_ID, config=_snapshot()))
    else:
        # Reassigning the attribute (with a fresh dict) is what flags the JSON
        # column dirty for the UPDATE.
        row.config = _snapshot()
    db.commit()


def bootstrap(db: Session) -> None:
    """Startup: seed defaults if needed, then load the DB's values into memory."""
    seed_if_empty(db)
    load_from_db(db)


def reload() -> None:
    """Refresh the globals from the DB on a fresh session (scheduled job)."""
    db = SessionLocal()
    try:
        load_from_db(db)
    finally:
        db.close()
