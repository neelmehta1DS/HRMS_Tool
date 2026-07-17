"""The DB-backed runtime config store: seeding, loading, and persistence."""
import copy

import pytest

from core import config_store
from core import holidays as h
from core import leave_limits as ll
from models.app_config import AppConfig


@pytest.fixture(autouse=True)
def restore_config_globals():
    """These globals are process-wide; snapshot and restore them in place so a
    test that edits config can't leak into the rest of the suite."""
    saved = (
        copy.deepcopy(ll.LEAVE_LIMITS),
        copy.deepcopy(ll.LEAVE_RULES),
        copy.deepcopy(h.HOLIDAYS),
        copy.deepcopy(h.HOLIDAY_DATES),
    )
    yield
    for live, snap in zip((ll.LEAVE_LIMITS, ll.LEAVE_RULES, h.HOLIDAYS, h.HOLIDAY_DATES), saved):
        live.clear()
        live.extend(snap) if isinstance(live, list) else live.update(snap)


def test_seed_if_empty_creates_row_from_current_values(db):
    """First boot seeds the DB row from the in-memory JSON defaults."""
    assert db.get(AppConfig, 1) is None

    config_store.seed_if_empty(db)

    row = db.get(AppConfig, 1)
    assert row is not None
    # The seeded blob mirrors exactly what's loaded from the JSON defaults.
    assert row.config["limits"] == ll.LEAVE_LIMITS
    assert row.config["rules"] == ll.LEAVE_RULES
    assert row.config["holidays"] == h.HOLIDAYS


def test_seed_if_empty_is_idempotent(db):
    config_store.seed_if_empty(db)
    config_store.seed_if_empty(db)
    assert db.query(AppConfig).count() == 1


def test_save_then_load_round_trips_an_edit(db):
    """An admin-style edit persists and re-loads into the globals."""
    config_store.seed_if_empty(db)

    ll.LEAVE_LIMITS["earned"] = 99
    h.HOLIDAYS.append({"date": "2099-12-31", "name": "Test Day"})
    h.reindex()
    config_store.save(db)

    # Wipe the globals to prove load repopulates them from the DB.
    ll.LEAVE_LIMITS.clear()
    h.HOLIDAYS.clear()
    h.HOLIDAY_DATES.clear()

    config_store.load_from_db(db)

    assert ll.LEAVE_LIMITS["earned"] == 99
    assert {"date": "2099-12-31", "name": "Test Day"} in h.HOLIDAYS
    from datetime import date
    assert date(2099, 12, 31) in h.HOLIDAY_DATES


def test_bootstrap_seeds_then_loads(db):
    config_store.bootstrap(db)
    assert db.get(AppConfig, 1) is not None
    assert ll.LEAVE_LIMITS  # populated
