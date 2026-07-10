"""GET /leaves/{user_id}/summary — what the profile sidebar needs."""
from datetime import date, timedelta

from models.leaves import Leave, LeaveStatus, LeaveType

TODAY = date.today()


def add_leave(db, user, start, end, status=LeaveStatus.approved, leave_type=LeaveType.earned):
    leave = Leave(user_id=user.id, leave_type=leave_type, start_date=start, end_date=end, status=status)
    db.add(leave)
    db.commit()
    return leave


def test_upcoming_lists_approved_future_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY + timedelta(days=5), TODAY + timedelta(days=7))

    r = client_as(ic).get(f"/leaves/{ic.id}/summary")

    assert r.status_code == 200
    assert len(r.json()["upcoming"]) == 1


def test_upcoming_excludes_pending_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY + timedelta(days=5), TODAY + timedelta(days=5), status=LeaveStatus.pending)

    assert client_as(ic).get(f"/leaves/{ic.id}/summary").json()["upcoming"] == []


def test_upcoming_excludes_rejected_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY + timedelta(days=5), TODAY + timedelta(days=5), status=LeaveStatus.rejected)

    assert client_as(ic).get(f"/leaves/{ic.id}/summary").json()["upcoming"] == []


def test_upcoming_excludes_past_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=10), TODAY - timedelta(days=8))

    assert client_as(ic).get(f"/leaves/{ic.id}/summary").json()["upcoming"] == []


def test_upcoming_is_ordered_by_start_date(db, ic, client_as):
    add_leave(db, ic, TODAY + timedelta(days=20), TODAY + timedelta(days=20))
    add_leave(db, ic, TODAY + timedelta(days=3), TODAY + timedelta(days=3))

    starts = [u["start_date"] for u in client_as(ic).get(f"/leaves/{ic.id}/summary").json()["upcoming"]]
    assert starts == sorted(starts)


def test_leave_dates_expands_a_multi_day_leave(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=3), TODAY - timedelta(days=1))

    dates = client_as(ic).get(f"/leaves/{ic.id}/summary").json()["leave_dates"]
    assert dates == [(TODAY - timedelta(days=d)).isoformat() for d in (3, 2, 1)]


def test_leave_dates_clips_a_leave_that_starts_before_the_window(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=40), TODAY - timedelta(days=26))

    dates = client_as(ic).get(f"/leaves/{ic.id}/summary?days=28").json()["leave_dates"]
    assert dates == [(TODAY - timedelta(days=d)).isoformat() for d in (27, 26)]


def test_leave_dates_clips_a_leave_running_past_today(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=1), TODAY + timedelta(days=3))

    dates = client_as(ic).get(f"/leaves/{ic.id}/summary").json()["leave_dates"]
    assert dates == [(TODAY - timedelta(days=1)).isoformat(), TODAY.isoformat()]


def test_leave_dates_excludes_leaves_wholly_outside_the_window(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=60), TODAY - timedelta(days=50))

    assert client_as(ic).get(f"/leaves/{ic.id}/summary?days=28").json()["leave_dates"] == []


def test_leave_dates_excludes_pending_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=2), TODAY - timedelta(days=2), status=LeaveStatus.pending)

    assert client_as(ic).get(f"/leaves/{ic.id}/summary").json()["leave_dates"] == []


def test_leave_dates_deduplicates_overlapping_leaves(db, ic, client_as):
    add_leave(db, ic, TODAY - timedelta(days=3), TODAY - timedelta(days=1))
    add_leave(db, ic, TODAY - timedelta(days=2), TODAY, leave_type=LeaveType.sick_and_casual)

    dates = client_as(ic).get(f"/leaves/{ic.id}/summary").json()["leave_dates"]
    assert len(dates) == len(set(dates)) == 4


def test_summary_is_readable_for_another_user(db, ic, manager, client_as):
    add_leave(db, manager, TODAY + timedelta(days=2), TODAY + timedelta(days=2))

    r = client_as(ic).get(f"/leaves/{manager.id}/summary")

    assert r.status_code == 200
    assert len(r.json()["upcoming"]) == 1


def test_summary_never_leaks_another_users_leaves(db, ic, manager, client_as):
    add_leave(db, manager, TODAY + timedelta(days=2), TODAY + timedelta(days=2))

    assert client_as(ic).get(f"/leaves/{ic.id}/summary").json()["upcoming"] == []


def test_summary_for_unknown_user_is_404(db, ic, client_as):
    assert client_as(ic).get("/leaves/999999/summary").status_code == 404


def test_summary_rejects_a_nonsense_window(db, ic, client_as):
    assert client_as(ic).get(f"/leaves/{ic.id}/summary?days=0").status_code == 422
    assert client_as(ic).get(f"/leaves/{ic.id}/summary?days=9999").status_code == 422


def test_me_balances_still_resolves(db, ic, client_as):
    """Route-ordering guard: /{user_id}/summary must not swallow /me/balances."""
    assert client_as(ic).get("/leaves/me/balances").status_code == 200
