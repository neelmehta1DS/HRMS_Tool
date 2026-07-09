"""GET /leaves/{user_id}/balances — any authenticated user may read any user's balances."""
from datetime import datetime

from models.leaves import LeaveBalance, LeaveType


def test_returns_another_users_balances(db, ic, manager, client_as):
    db.add(LeaveBalance(user_id=manager.id, leave_type=LeaveType.earned,
                        year=datetime.now().year, days_taken=5))
    db.commit()

    r = client_as(ic).get(f"/leaves/{manager.id}/balances")

    assert r.status_code == 200
    assert r.json()["earned"] == {"taken": 5, "limit": 18, "remaining": 13}


def test_user_with_no_balance_rows_reads_as_zero_taken(db, ic, manager, client_as):
    r = client_as(ic).get(f"/leaves/{manager.id}/balances")

    assert r.status_code == 200
    assert r.json()["earned"]["taken"] == 0


def test_unlimited_type_has_null_limit(db, ic, manager, client_as):
    r = client_as(ic).get(f"/leaves/{manager.id}/balances")

    assert r.json()["lwp"] == {"taken": 0, "limit": None, "remaining": None}


def test_unknown_user_id_is_404(db, ic, client_as):
    r = client_as(ic).get("/leaves/999999/balances")

    assert r.status_code == 404


def test_me_balances_still_resolves(db, ic, client_as):
    """Regression guard on route ordering.

    /{user_id}/balances must be declared after /me/balances. Declared first,
    FastAPI tries to coerce "me" into user_id: int and returns 422.
    """
    r = client_as(ic).get("/leaves/me/balances")

    assert r.status_code == 200
