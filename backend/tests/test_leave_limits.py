"""Limit enforcement: a leave that would push a user past their annual
allowance for that type is rejected outright."""
from datetime import date, timedelta

from models.leaves import Leave, LeaveBalance, LeaveType
from tests.helpers import future_working_date as _future, next_working_day


def _seed_balance(db, user, leave_type, days_taken, year=None):
    """Give `user` a starting balance so the next request lands over the limit."""
    year = year or date.today().year
    db.add(LeaveBalance(user_id=user.id, leave_type=leave_type,
                        year=year, days_taken=days_taken))
    db.commit()


def _span(working_days: int, out: int = 30) -> tuple[str, str]:
    """Return (start, end) ISO strings spanning exactly `working_days` working days."""
    start = date.fromisoformat(_future(out))
    end = start
    for _ in range(working_days - 1):
        end = next_working_day(end + timedelta(days=1))
    return str(start), str(end)


# ─── Pure predicate ───────────────────────────────────────────────────────────

def test_exceeds_limit_is_strictly_greater():
    from routes.leaves import exceeds_limit
    # earned limit is 18
    assert exceeds_limit(LeaveType.earned, taken=16, days=3) is True
    assert exceeds_limit(LeaveType.earned, taken=16, days=2) is False  # exactly 18


def test_exceeds_limit_never_true_for_unlimited_type():
    from routes.leaves import exceeds_limit
    assert exceeds_limit(LeaveType.lwp, taken=500, days=500) is False


def test_would_exceed_limit_reads_days_taken(db, ic):
    from routes.leaves import would_exceed_limit
    _seed_balance(db, ic, LeaveType.earned, 17)
    year = date.today().year
    assert would_exceed_limit(db, ic.id, LeaveType.earned, 2, year) is True
    assert would_exceed_limit(db, ic.id, LeaveType.earned, 1, year) is False


def test_would_exceed_limit_with_no_balance_row(db, ic):
    """A user who has taken nothing has a full allowance, not a missing one."""
    from routes.leaves import would_exceed_limit
    year = date.today().year
    assert would_exceed_limit(db, ic.id, LeaveType.earned, 18, year) is False
    assert would_exceed_limit(db, ic.id, LeaveType.earned, 19, year) is True


# ─── POST /leaves ─────────────────────────────────────────────────────────────

def test_over_limit_create_is_rejected(client_as, ic, db):
    _seed_balance(db, ic, LeaveType.earned, 17)
    start, end = _span(2)

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday",
        "start_date": start, "end_date": end,
    })

    assert resp.status_code == 422
    assert "limit exceeded" in resp.json()["detail"].lower()
    assert db.query(Leave).count() == 0


def test_create_landing_exactly_on_the_limit_succeeds(client_as, ic, db):
    _seed_balance(db, ic, LeaveType.earned, 16)
    start, end = _span(2)  # 16 + 2 == 18, the earned limit

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday",
        "start_date": start, "end_date": end,
    })

    assert resp.status_code == 200
    assert resp.json()["over_limit"] is False
    assert db.query(Leave).count() == 1


def test_admin_may_create_an_over_limit_leave(client_as, ic, db):
    ic.is_admin = True
    db.commit()
    _seed_balance(db, ic, LeaveType.earned, 17)
    start, end = _span(2)

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Approved by HR",
        "start_date": start, "end_date": end,
    })

    assert resp.status_code == 200
    # The soft warning survives for admins — approvers still see it.
    assert resp.json()["over_limit"] is True


def test_lwp_has_no_limit(client_as, ic, db):
    _seed_balance(db, ic, LeaveType.lwp, 200)
    start, end = _span(5)

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "lwp", "note": "Sabbatical",
        "start_date": start, "end_date": end,
    })

    assert resp.status_code == 200
    assert resp.json()["over_limit"] is False


def test_user_with_no_manager_is_still_blocked(client_as, skip_manager, db):
    """skip_manager has no manager, so they auto-approve and skip every other
    policy constraint. The limit is not one of them."""
    _seed_balance(db, skip_manager, LeaveType.earned, 17)
    start, end = _span(2)

    resp = client_as(skip_manager).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday",
        "start_date": start, "end_date": end,
    })

    assert resp.status_code == 422
    assert db.query(Leave).count() == 0


def test_exception_request_is_still_blocked(client_as, ic, db):
    """is_exception waives the notice period, not the limit."""
    _seed_balance(db, ic, LeaveType.earned, 17)
    start, end = _span(2, out=1)  # too soon for notice, but exception waives that

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Family emergency",
        "start_date": start, "end_date": end, "is_exception": True,
    })

    assert resp.status_code == 422
    assert "limit exceeded" in resp.json()["detail"].lower()
    assert db.query(Leave).count() == 0


# ─── PUT /leaves/{id} ─────────────────────────────────────────────────────────

def test_edit_that_lengthens_a_leave_past_the_limit_is_rejected(client_as, ic, db):
    _seed_balance(db, ic, LeaveType.earned, 16)
    start, end = _span(2)  # 16 + 2 == 18, allowed

    created = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday",
        "start_date": start, "end_date": end,
    }).json()

    _, longer_end = _span(4)  # would make it 16 + 4 == 20

    resp = client_as(ic).put(f"/leaves/{created['id']}", json={"end_date": longer_end})

    assert resp.status_code == 422
    assert "limit exceeded" in resp.json()["detail"].lower()

    db.expire_all()
    unchanged = db.query(Leave).filter_by(id=created["id"]).first()
    assert str(unchanged.end_date) == end


def test_edit_within_the_limit_still_works(client_as, ic, db):
    _seed_balance(db, ic, LeaveType.earned, 15)
    start, end = _span(2)

    created = client_as(ic).post("/leaves", json={
        "leave_type": "earned", "note": "Holiday",
        "start_date": start, "end_date": end,
    }).json()

    _, longer_end = _span(3)  # 15 + 3 == 18, exactly the limit

    resp = client_as(ic).put(f"/leaves/{created['id']}", json={"end_date": longer_end})

    assert resp.status_code == 200
