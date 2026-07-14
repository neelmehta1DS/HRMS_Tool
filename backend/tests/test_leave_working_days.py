"""A leave must contain at least one working day.

Weekends and company holidays consume no balance (see count_weekdays), so a
leave made up entirely of them is a no-op that still spams approvers.
"""
from datetime import date, timedelta

import pytest

from core.holidays import HOLIDAYS
from models.leaves import Leave, LeaveStatus
from tests.helpers import future_working_date


def _next_weekday_holiday() -> date:
    """The next company holiday that falls on a weekday (so weekends aren't the cause)."""
    today = date.today()
    for h in HOLIDAYS:
        d = date.fromisoformat(h["date"])
        if d > today and d.weekday() < 5:
            return d
    pytest.skip("no upcoming weekday holiday in holidays.json")


def _next_saturday() -> date:
    d = date.today() + timedelta(days=1)
    while d.weekday() != 5:
        d += timedelta(days=1)
    return d


# ─── POST /leaves ─────────────────────────────────────────────────────────────

def test_earned_leave_on_a_saturday_is_rejected(client_as, ic):
    sat = _next_saturday()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Weekend", "start_date": str(sat),
    })

    assert resp.status_code == 422
    assert "working day" in resp.json()["detail"].lower()


def test_earned_leave_spanning_only_a_weekend_is_rejected(client_as, ic):
    sat = _next_saturday()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Weekend",
        "start_date": str(sat), "end_date": str(sat + timedelta(days=1)),
    })

    assert resp.status_code == 422


def test_sick_leave_on_a_saturday_is_rejected(client_as, ic):
    sat = _next_saturday()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "sick", "note": "Sick", "start_date": str(sat),
    })

    # The working-day check runs before the type's own rules, so this is rejected
    # for containing no working day — not for failing sick's must-start-today.
    assert resp.status_code == 422
    assert "at least one working day" in resp.json()["detail"]


def test_leave_on_a_public_holiday_is_rejected(client_as, ic):
    holiday = _next_weekday_holiday()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday", "start_date": str(holiday),
    })

    assert resp.status_code == 422
    assert "working day" in resp.json()["detail"].lower()


def test_rejected_weekend_leave_creates_no_row(client_as, ic, db):
    sat = _next_saturday()

    client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Weekend", "start_date": str(sat),
    })

    assert db.query(Leave).count() == 0


def test_managers_without_a_manager_are_also_rejected(client_as, skip_manager):
    """L2 leads bypass notice and overlap rules, but not this one."""
    sat = _next_saturday()

    resp = client_as(skip_manager).post("/leaves", json={
        "leave_type": "earned", "note": "Weekend", "start_date": str(sat),
    })

    assert resp.status_code == 422


def test_leave_spanning_a_weekend_but_containing_weekdays_is_allowed(client_as, ic):
    """Control: a Fri→Mon leave has two working days and must still be accepted."""
    friday = date.fromisoformat(future_working_date(30))
    while friday.weekday() != 4:  # roll forward to a Friday
        friday += timedelta(days=1)

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Long weekend",
        "start_date": str(friday), "end_date": str(friday + timedelta(days=3)),
    })

    assert resp.status_code == 200, resp.json()
    assert resp.json()["status"] == "pending"


def test_ordinary_single_working_day_leave_still_works(client_as, ic):
    """Control: the happy path must not regress."""
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Day off", "start_date": future_working_date(30),
    })

    assert resp.status_code == 200


# ─── PUT /leaves/{id} ─────────────────────────────────────────────────────────

def test_editing_a_leave_onto_a_weekend_is_rejected(client_as, ic, db):
    created = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Day off", "start_date": future_working_date(30),
    }).json()
    sat = _next_saturday()

    resp = client_as(ic).put(f"/leaves/{created['id']}", json={
        "start_date": str(sat), "end_date": str(sat),
    })

    assert resp.status_code == 422
    assert "working day" in resp.json()["detail"].lower()

    db.expire_all()
    unchanged = db.query(Leave).filter_by(id=created["id"]).first()
    assert str(unchanged.start_date) == created["start_date"]


# ─── POST /bot/leaves ─────────────────────────────────────────────────────────

def test_bot_leave_on_a_weekend_is_rejected(client_as, ic, manager, db, monkeypatch):
    from core.config import settings
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-key")

    ic.slack_user_id = "U123"
    db.commit()
    sat = _next_saturday()

    resp = client_as(ic).post(
        "/bot/leaves",
        headers={"x-internal-key": "test-key"},
        json={
            "slack_user_id": "U123", "leave_type": "earned", "note": "Weekend",
            "start_date": str(sat), "end_date": str(sat),
        },
    )

    assert resp.status_code == 422
    assert "working day" in resp.json()["detail"].lower()
    assert db.query(Leave).count() == 0
