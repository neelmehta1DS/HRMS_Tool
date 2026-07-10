"""Admin user management: one-shot overview, and unconstrained CRUD.

Admin writes bypass policy (notice periods, overlaps, limits, approval chains)
but never bookkeeping: balances are recomputed from the leaves themselves.
"""
from datetime import date, datetime, timedelta

import pytest

from models.catchups import Catchup
from models.leaves import Leave, LeaveApproval, LeaveBalance, LeaveStatus, LeaveType
from models.status_events import StatusEvent
from models.users import OfficeStatus, User

TODAY = date.today()


@pytest.fixture
def admin(db):
    u = User(email="admin@test.com", name="Admin", role="Ops", is_admin=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def add_leave(db, user, start, end, status=LeaveStatus.approved, leave_type=LeaveType.earned):
    leave = Leave(user_id=user.id, leave_type=leave_type, start_date=start, end_date=end, status=status)
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave


def balance(db, user, leave_type=LeaveType.earned, year=None):
    row = db.query(LeaveBalance).filter_by(
        user_id=user.id, leave_type=leave_type, year=year or TODAY.year
    ).first()
    return row.days_taken if row else 0


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------

def test_overview_requires_admin(db, ic, client_as):
    assert client_as(ic).get(f"/admin/users/{ic.id}/overview").status_code == 403


def test_every_admin_write_requires_admin(db, ic, client_as):
    c = client_as(ic)
    assert c.post("/admin/users", json={"email": "x@y.com", "name": "X", "role": "R"}).status_code == 403
    assert c.delete(f"/admin/users/{ic.id}").status_code == 403
    assert c.post(f"/admin/users/{ic.id}/leaves", json={}).status_code == 403
    assert c.post(f"/admin/users/{ic.id}/catchups", json={}).status_code == 403


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

def test_overview_returns_everything_about_one_user(db, admin, ic, manager, client_as):
    add_leave(db, ic, TODAY + timedelta(days=3), TODAY + timedelta(days=4))
    db.add(Catchup(manager_id=manager.id, employee_id=ic.id, notes_doc_link="", meeting_link="",
                   date_and_time=datetime.now()))
    db.add(StatusEvent(user_id=ic.id, occurred_at=datetime.now(), business_date=TODAY,
                       office_status=OfficeStatus.IN))
    db.commit()

    body = client_as(admin).get(f"/admin/users/{ic.id}/overview").json()

    assert body["user"]["id"] == ic.id
    assert len(body["leaves"]) == 1
    assert len(body["catchups"]) == 1
    assert len(body["status_days"]) == 1
    assert body["balances"]["earned"]["limit"] == 18


def test_overview_never_mixes_in_another_users_records(db, admin, ic, manager, client_as):
    add_leave(db, manager, TODAY, TODAY)

    body = client_as(admin).get(f"/admin/users/{ic.id}/overview").json()
    assert body["leaves"] == []


def test_overview_orders_leaves_newest_first(db, admin, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=30), TODAY - timedelta(days=30))
    add_leave(db, ic, TODAY + timedelta(days=30), TODAY + timedelta(days=30))

    starts = [l["start_date"] for l in client_as(admin).get(f"/admin/users/{ic.id}/overview").json()["leaves"]]
    assert starts == sorted(starts, reverse=True)


def test_overview_for_unknown_user_is_404(db, admin, client_as):
    assert client_as(admin).get("/admin/users/999999/overview").status_code == 404


# ---------------------------------------------------------------------------
# Users: create, edit, delete
# ---------------------------------------------------------------------------

def test_admin_creates_a_user(db, admin, manager, client_as):
    r = client_as(admin).post("/admin/users", json={
        "email": "new@test.com", "name": "New Hire", "role": "Engineer",
        "manager_id": manager.id, "joining_date": str(TODAY),
    })

    assert r.status_code == 201
    assert db.query(User).filter_by(email="new@test.com").first() is not None


def test_creating_a_duplicate_email_is_409(db, admin, ic, client_as):
    r = client_as(admin).post("/admin/users", json={"email": ic.email, "name": "X", "role": "R"})
    assert r.status_code == 409


def test_creating_with_an_unknown_manager_is_400(db, admin, client_as):
    r = client_as(admin).post("/admin/users", json={
        "email": "x@test.com", "name": "X", "role": "R", "manager_id": 999999,
    })
    assert r.status_code == 400


def test_admin_edits_birthday_and_joining_date(db, admin, ic, client_as):
    r = client_as(admin).patch(f"/admin/users/{ic.id}", json={
        "birthday": "1995-03-14", "joining_date": "2022-06-01",
    })

    assert r.status_code == 200
    db.refresh(ic)
    assert ic.birthday == date(1995, 3, 14)
    assert ic.joining_date == date(2022, 6, 1)


def test_editing_email_to_an_existing_one_is_409(db, admin, ic, manager, client_as):
    r = client_as(admin).patch(f"/admin/users/{ic.id}", json={"email": manager.email})
    assert r.status_code == 409
    db.refresh(ic)
    assert ic.email == "ic@test.com"


def test_cycle_prevention_still_holds(db, admin, ic, manager, client_as):
    r = client_as(admin).patch(f"/admin/users/{manager.id}", json={"manager_id": ic.id})
    assert r.status_code == 400


def test_admin_cannot_delete_themselves(db, admin, client_as):
    assert client_as(admin).delete(f"/admin/users/{admin.id}").status_code == 400


def test_deleting_a_user_removes_all_their_records(db, admin, ic, manager, client_as):
    leave = add_leave(db, ic, TODAY, TODAY)
    db.add(LeaveApproval(leave_id=leave.id, approver_id=manager.id, step=1))
    db.add(Catchup(manager_id=manager.id, employee_id=ic.id, notes_doc_link="", meeting_link="",
                   date_and_time=datetime.now()))
    db.add(StatusEvent(user_id=ic.id, occurred_at=datetime.now(), business_date=TODAY,
                       office_status=OfficeStatus.IN))
    db.commit()
    # Read the ids out now: after the delete these instances are gone.
    ic_id, leave_id = ic.id, leave.id

    assert client_as(admin).delete(f"/admin/users/{ic_id}").status_code == 204
    db.expire_all()

    assert db.query(User).filter_by(id=ic_id).first() is None
    assert db.query(Leave).filter_by(user_id=ic_id).count() == 0
    assert db.query(LeaveApproval).filter_by(leave_id=leave_id).count() == 0
    assert db.query(Catchup).filter_by(employee_id=ic_id).count() == 0
    assert db.query(StatusEvent).filter_by(user_id=ic_id).count() == 0
    assert db.query(LeaveBalance).filter_by(user_id=ic_id).count() == 0


def test_deleting_a_manager_reparents_their_reports(db, admin, ic, manager, skip_manager, client_as):
    ic_id, manager_id, skip_id = ic.id, manager.id, skip_manager.id

    client_as(admin).delete(f"/admin/users/{manager_id}")
    db.expire_all()

    reparented = db.query(User).filter_by(id=ic_id).first()
    assert reparented.manager_id == skip_id  # not orphaned at the root


def test_deleting_a_user_removes_approvals_they_owed_others(db, admin, ic, manager, client_as):
    leave = add_leave(db, ic, TODAY, TODAY, status=LeaveStatus.pending)
    db.add(LeaveApproval(leave_id=leave.id, approver_id=manager.id, step=1))
    db.commit()
    leave_id, manager_id = leave.id, manager.id

    client_as(admin).delete(f"/admin/users/{manager_id}")
    db.expire_all()

    assert db.query(LeaveApproval).filter_by(approver_id=manager_id).count() == 0
    assert db.query(Leave).filter_by(id=leave_id).first() is not None  # the leave itself survives


def test_deleting_an_unknown_user_is_404(db, admin, client_as):
    assert client_as(admin).delete("/admin/users/999999").status_code == 404


# ---------------------------------------------------------------------------
# Leaves: unconstrained, but balances stay true
# ---------------------------------------------------------------------------

def test_admin_creates_an_approved_leave_and_the_balance_moves(db, admin, ic, client_as):
    monday = date(2026, 3, 9)
    r = client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(monday), "end_date": str(monday + timedelta(days=2)),
    })

    assert r.status_code == 201
    assert balance(db, ic, year=2026) == 3


def test_admin_leave_bypasses_the_notice_period(db, admin, ic, client_as):
    # Earned leave normally needs 14+ days notice. Starting tomorrow is fine here.
    r = client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(TODAY + timedelta(days=1)),
        "end_date": str(TODAY + timedelta(days=1)),
    })
    assert r.status_code == 201


def test_admin_leave_bypasses_the_limit_and_the_balance_goes_negative(db, admin, ic, client_as):
    # Earned limit is 18 days; book 30 working days across six weeks.
    start = date(2026, 3, 2)
    client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(start), "end_date": str(start + timedelta(days=41)),
    })

    taken = balance(db, ic, year=2026)
    assert taken > 18  # over-drawn, and visible as such


def test_admin_leave_bypasses_the_overlap_check(db, admin, ic, client_as):
    day = date(2026, 3, 9)
    body = {"leave_type": "earned", "start_date": str(day), "end_date": str(day)}
    assert client_as(admin).post(f"/admin/users/{ic.id}/leaves", json=body).status_code == 201
    assert client_as(admin).post(f"/admin/users/{ic.id}/leaves", json=body).status_code == 201


def test_a_pending_admin_leave_does_not_touch_the_balance(db, admin, ic, client_as):
    client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(date(2026, 3, 9)),
        "end_date": str(date(2026, 3, 9)), "status": "pending",
    })
    assert balance(db, ic, year=2026) == 0


def test_end_before_start_is_rejected(db, admin, ic, client_as):
    r = client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(TODAY), "end_date": str(TODAY - timedelta(days=1)),
    })
    assert r.status_code == 422


def test_admin_edits_an_old_approved_leave(db, admin, ic, client_as):
    leave = add_leave(db, ic, date(2026, 3, 9), date(2026, 3, 11))  # Mon–Wed, 3 days
    db.commit()

    r = client_as(admin).put(f"/admin/leaves/{leave.id}", json={"end_date": str(date(2026, 3, 10))})

    assert r.status_code == 200
    assert balance(db, ic, year=2026) == 2  # recomputed, not nudged


def test_approving_a_pending_leave_moves_the_balance(db, admin, ic, client_as):
    leave = add_leave(db, ic, date(2026, 3, 9), date(2026, 3, 9), status=LeaveStatus.pending)
    assert balance(db, ic, year=2026) == 0

    client_as(admin).put(f"/admin/leaves/{leave.id}", json={"status": "approved"})
    assert balance(db, ic, year=2026) == 1


def test_unapproving_a_leave_returns_the_balance(db, admin, ic, client_as):
    leave_id = client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": "2026-03-09", "end_date": "2026-03-09",
    }).json()["id"]
    assert balance(db, ic, year=2026) == 1
    leave = db.get(Leave, leave_id)

    client_as(admin).put(f"/admin/leaves/{leave.id}", json={"status": "rejected"})
    assert balance(db, ic, year=2026) == 0


def test_changing_a_leaves_type_moves_the_balance_between_types(db, admin, ic, client_as):
    leave = add_leave(db, ic, date(2026, 3, 9), date(2026, 3, 9))

    client_as(admin).put(f"/admin/leaves/{leave.id}", json={"leave_type": "sick_and_casual"})

    assert balance(db, ic, LeaveType.earned, 2026) == 0
    assert balance(db, ic, LeaveType.sick_and_casual, 2026) == 1


def test_deleting_a_leave_returns_the_balance(db, admin, ic, client_as):
    leave_id = client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": "2026-03-09", "end_date": "2026-03-09",
    }).json()["id"]
    assert balance(db, ic, year=2026) == 1

    assert client_as(admin).delete(f"/admin/leaves/{leave_id}").status_code == 204
    db.expire_all()
    assert balance(db, ic, year=2026) == 0
    assert db.query(Leave).filter_by(id=leave_id).first() is None


def test_deleting_a_leave_removes_its_approvals(db, admin, ic, manager, client_as):
    leave = add_leave(db, ic, TODAY, TODAY, status=LeaveStatus.pending)
    db.add(LeaveApproval(leave_id=leave.id, approver_id=manager.id, step=1))
    db.commit()

    client_as(admin).delete(f"/admin/leaves/{leave.id}")
    assert db.query(LeaveApproval).filter_by(leave_id=leave.id).count() == 0


def test_weekend_only_leave_costs_nothing(db, admin, ic, client_as):
    saturday = date(2026, 3, 7)
    client_as(admin).post(f"/admin/users/{ic.id}/leaves", json={
        "leave_type": "earned", "start_date": str(saturday), "end_date": str(saturday + timedelta(days=1)),
    })
    assert balance(db, ic, year=2026) == 0


def test_editing_an_unknown_leave_is_404(db, admin, client_as):
    assert client_as(admin).put("/admin/leaves/999999", json={"note": "x"}).status_code == 404


# ---------------------------------------------------------------------------
# Catchups: created straight in the database
# ---------------------------------------------------------------------------

def test_admin_creates_a_catchup_without_google_resources(db, admin, ic, manager, client_as):
    r = client_as(admin).post(f"/admin/users/{ic.id}/catchups", json={
        "manager_id": manager.id, "date_and_time": "2026-03-09T10:00:00",
    })

    assert r.status_code == 201
    catchup = db.query(Catchup).filter_by(employee_id=ic.id).first()
    assert catchup.calendar_event_id is None
    assert catchup.background_creation_finished is True


def test_creating_a_catchup_with_an_unknown_manager_is_400(db, admin, ic, client_as):
    r = client_as(admin).post(f"/admin/users/{ic.id}/catchups", json={
        "manager_id": 999999, "date_and_time": "2026-03-09T10:00:00",
    })
    assert r.status_code == 400


def test_admin_reschedules_a_catchup(db, admin, ic, manager, client_as):
    catchup = Catchup(manager_id=manager.id, employee_id=ic.id, notes_doc_link="", meeting_link="",
                      date_and_time=datetime(2026, 3, 9, 10, 0))
    db.add(catchup)
    db.commit()

    r = client_as(admin).patch(f"/admin/catchups/{catchup.id}", json={"date_and_time": "2026-03-10T14:30:00"})

    assert r.status_code == 200
    db.refresh(catchup)
    assert catchup.date_and_time == datetime(2026, 3, 10, 14, 30)


def test_admin_deletes_a_catchup(db, admin, ic, manager, client_as):
    catchup = Catchup(manager_id=manager.id, employee_id=ic.id, notes_doc_link="", meeting_link="",
                      date_and_time=datetime.now())
    db.add(catchup)
    db.commit()
    catchup_id = catchup.id

    assert client_as(admin).delete(f"/admin/catchups/{catchup_id}").status_code == 204
    db.expire_all()
    assert db.query(Catchup).filter_by(id=catchup_id).first() is None


def test_editing_an_unknown_catchup_is_404(db, admin, client_as):
    assert client_as(admin).patch("/admin/catchups/999999", json={}).status_code == 404
