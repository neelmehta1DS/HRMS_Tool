from contextlib import contextmanager
from datetime import date, timedelta
from unittest.mock import patch, MagicMock

from models.leaves import Leave, LeaveApproval, LeaveBalance, LeaveType, LeaveStatus, ApprovalStatus
from tests.helpers import future_working_date as _future, next_working_day

# Sick leave must start "today", and a leave with no working days is rejected.
# Pin the route's notion of today to a working day so these tests don't fail
# on weekends and holidays.
WORKING_TODAY = next_working_day(date.today())


def _today():
    return str(WORKING_TODAY)


def _future_date(days=30) -> date:
    """Same day as _future(days), as a date object for seeding rows directly."""
    return date.fromisoformat(_future(days))


def _mock_before_cutoff():
    """Return a mock datetime.now() that reports 9:00 AM (before 10 AM cutoff)."""
    m = MagicMock()
    m.hour = 9
    m.minute = 0
    return m


@contextmanager
def _before_cutoff_on_a_working_day():
    """Freeze the route at 9:00 AM on WORKING_TODAY."""
    with patch("routes.leaves.datetime") as mock_dt, patch("routes.leaves.date") as mock_date:
        mock_dt.now.return_value = _mock_before_cutoff()
        mock_date.today.return_value = WORKING_TODAY
        yield


# ---------------------------------------------------------------------------
# Sick leave
# ---------------------------------------------------------------------------

def test_sick_auto_approved(client_as, ic):
    with _before_cutoff_on_a_working_day():
        resp = client_as(ic).post("/leaves", json={
            "leave_type": "sick",
            "note": "Not feeling well",
            "start_date": _today(),
        })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["approvals"] == []


def test_sick_increments_the_shared_balance(client_as, ic, db):
    with _before_cutoff_on_a_working_day():
        client_as(ic).post("/leaves", json={
            "leave_type": "sick",
            "note": "Sick day",
            "start_date": _today(),
        })

    # Charged to the shared pool, not to a `sick` row of its own.
    bal = db.query(LeaveBalance).filter_by(
        user_id=ic.id,
        leave_type=LeaveType.sick_and_casual,
        year=WORKING_TODAY.year,
    ).first()
    assert bal is not None
    assert bal.days_taken == 1
    assert db.query(LeaveBalance).filter_by(user_id=ic.id, leave_type=LeaveType.sick).count() == 0


def test_sick_must_start_today(client_as, ic):
    with _before_cutoff_on_a_working_day():
        resp = client_as(ic).post("/leaves", json={
            "leave_type": "sick",
            "note": "Planning to fall ill",
            "start_date": _future(10),
        })
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Sick leave must start today."


def test_sick_after_cutoff_needs_approval(client_as, ic):
    """The cutoff gates auto-approval only; the request itself stays valid."""
    with patch("routes.leaves.datetime") as mock_dt, patch("routes.leaves.date") as mock_date:
        mock_dt.now.return_value = MagicMock(hour=11, minute=30)
        mock_date.today.return_value = WORKING_TODAY
        resp = client_as(ic).post("/leaves", json={
            "leave_type": "sick",
            "note": "Woke up ill, late",
            "start_date": _today(),
        })
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


# ---------------------------------------------------------------------------
# Casual leave — the notice ladder itself is unit-tested in test_leave_policy.py;
# these cover its wiring through the route.
# ---------------------------------------------------------------------------

def test_casual_with_enough_notice_is_pending(client_as, ic):
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Long weekend",
        "start_date": _future(10),
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


def test_casual_does_not_inherit_the_sick_cutoff_auto_approval(client_as, ic):
    with _before_cutoff_on_a_working_day():
        resp = client_as(ic).post("/leaves", json={
            "leave_type": "casual",
            "note": "Errand",
            "start_date": _future(30),
        })
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"


def test_casual_same_day_is_rejected_for_lack_of_notice(client_as, ic):
    with _before_cutoff_on_a_working_day():
        resp = client_as(ic).post("/leaves", json={
            "leave_type": "casual",
            "note": "Errand",
            "start_date": _today(),
        })
    assert resp.status_code == 422
    assert "3 working days notice" in resp.json()["detail"]


def test_casual_increments_the_shared_balance(client_as, skip_manager, db):
    """skip_manager has no manager, so their leave auto-approves and charges the pool."""
    start = _future_date(10)
    resp = client_as(skip_manager).post("/leaves", json={
        "leave_type": "casual", "note": "Trip", "start_date": str(start),
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    bal = db.query(LeaveBalance).filter_by(
        user_id=skip_manager.id, leave_type=LeaveType.sick_and_casual, year=start.year,
    ).first()
    assert bal is not None
    assert bal.days_taken == 1
    assert db.query(LeaveBalance).filter_by(
        user_id=skip_manager.id, leave_type=LeaveType.casual).count() == 0


# ---------------------------------------------------------------------------
# Sick and casual share one annual allowance
# ---------------------------------------------------------------------------

def test_sick_and_casual_draw_from_one_shared_pool(client_as, ic, db):
    """Fails if balance_key is missed at any lookup site.

    The pool is 12 days. Bank 11 sick days, then a 2-day casual request must be
    refused — even though not one casual day has ever been taken.
    """
    start = _future_date(10)
    db.add(LeaveBalance(
        user_id=ic.id, leave_type=LeaveType.sick_and_casual,
        year=start.year, days_taken=11,
    ))
    db.commit()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Two days off",
        "start_date": str(start),
        "end_date": str(next_working_day(start + timedelta(days=1))),
    })
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "Sick & Casual leave limit exceeded" in detail
    assert "only 1 of 12 days remaining" in detail


def test_sick_and_casual_is_not_a_requestable_type(client_as, ic):
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "sick_and_casual",
        "note": "Which one is it?",
        "start_date": _today(),
    })
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Earned leave — approval row creation
# ---------------------------------------------------------------------------

def test_earned_two_level_chain_creates_two_approval_rows(client_as, ic, manager, skip_manager):
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned",
        "note": "Holiday",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    approvals = data["approvals"]
    assert len(approvals) == 2
    assert approvals[0]["step"] == 1
    assert approvals[0]["approver"]["id"] == manager.id
    assert approvals[0]["status"] == "pending"
    assert approvals[1]["step"] == 2
    assert approvals[1]["approver"]["id"] == skip_manager.id
    assert approvals[1]["status"] == "pending"


def test_earned_single_manager_creates_one_approval_row(client_as, manager, skip_manager):
    resp = client_as(manager).post("/leaves", json={
        "leave_type": "earned",
        "note": "Day off",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 1
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


def test_earned_no_manager_auto_approved(client_as, skip_manager):
    resp = client_as(skip_manager).post("/leaves", json={
        "leave_type": "earned",
        "note": "Vacation",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["approvals"] == []


# ---------------------------------------------------------------------------
# Exception leaves
# ---------------------------------------------------------------------------

def test_exception_with_skip_manager_routes_to_step2_only(client_as, ic, skip_manager):
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned",
        "note": "Emergency",
        "start_date": _future(5),
        "is_exception": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 2
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


def test_exception_without_skip_manager_falls_back_to_direct_manager(client_as, manager, skip_manager):
    resp = client_as(manager).post("/leaves", json={
        "leave_type": "earned",
        "note": "Emergency",
        "start_date": _future(5),
        "is_exception": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 1
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


# ---------------------------------------------------------------------------
# Overlap check
# ---------------------------------------------------------------------------

def test_rejected_leave_does_not_block_new_request(client_as, ic, db):
    db.add(Leave(
        user_id=ic.id,
        leave_type=LeaveType.earned,
        note="old",
        start_date=_future_date(30),
        end_date=_future_date(30),
        status=LeaveStatus.rejected,
    ))
    db.commit()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned",
        "note": "Try again",
        "start_date": _future(30),
    })
    assert resp.status_code == 200


def test_pending_leave_blocks_overlapping_request(client_as, ic, manager, db):
    existing = Leave(
        user_id=ic.id,
        leave_type=LeaveType.earned,
        note="existing",
        start_date=_future_date(30),
        end_date=_future_date(30),
        status=LeaveStatus.pending,
    )
    db.add(existing)
    db.flush()
    db.add(LeaveApproval(leave_id=existing.id, approver_id=manager.id, step=1))
    db.commit()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned",
        "note": "Duplicate",
        "start_date": _future(30),
    })
    assert resp.status_code == 422
