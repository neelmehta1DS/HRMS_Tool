"""Status change logging.

Every accepted PATCH /users/me/status appends one StatusEvent snapshotting the
resulting live status. The nightly reset is housekeeping and logs nothing.
"""
from datetime import datetime, time
from unittest.mock import patch

from models.status_events import StatusEvent
from models.users import OfficeStatus


def events_for(db, user):
    return (
        db.query(StatusEvent)
        .filter(StatusEvent.user_id == user.id)
        .order_by(StatusEvent.occurred_at)
        .all()
    )


# ---------------------------------------------------------------------------
# Writing events
# ---------------------------------------------------------------------------

def test_setting_status_writes_one_event(db, ic, client_as):
    r = client_as(ic).patch("/users/me/status", json={"office_status": "IN"})

    assert r.status_code == 200
    events = events_for(db, ic)
    assert len(events) == 1
    assert events[0].office_status == OfficeStatus.IN
    assert events[0].late_arrive_eta is None


def test_event_snapshots_the_whole_resulting_status(db, ic, client_as):
    client_as(ic).patch("/users/me/status", json={
        "office_status": "WFH",
        "late_arrive_eta": "11:30",
        "stepping_out_from": "13:00",
        "stepping_out_to": "14:00",
    })

    e = events_for(db, ic)[0]
    assert e.office_status == OfficeStatus.WFH
    assert e.late_arrive_eta == time(11, 30)
    assert e.stepping_out_from == time(13, 0)
    assert e.stepping_out_to == time(14, 0)
    assert e.early_exit_eta is None


def test_each_update_appends_another_event(db, ic, client_as):
    client_as(ic).patch("/users/me/status", json={"office_status": "IN"})
    client_as(ic).patch("/users/me/status", json={"office_status": "WFH"})

    events = events_for(db, ic)
    assert [e.office_status for e in events] == [OfficeStatus.IN, OfficeStatus.WFH]


def test_eta_only_update_carries_the_existing_status(db, ic, client_as):
    client_as(ic).patch("/users/me/status", json={"office_status": "IN"})
    client_as(ic).patch("/users/me/status", json={"early_exit_eta": "16:00"})

    events = events_for(db, ic)
    assert len(events) == 2
    assert events[1].office_status == OfficeStatus.IN
    assert events[1].early_exit_eta == time(16, 0)


def test_events_are_never_shared_between_users(db, ic, manager, client_as):
    client_as(ic).patch("/users/me/status", json={"office_status": "IN"})

    assert len(events_for(db, ic)) == 1
    assert events_for(db, manager) == []


# ---------------------------------------------------------------------------
# Validation: no ETA without a status
# ---------------------------------------------------------------------------

def test_eta_without_any_status_is_rejected(db, ic, client_as):
    r = client_as(ic).patch("/users/me/status", json={"late_arrive_eta": "11:00"})

    assert r.status_code == 400
    assert events_for(db, ic) == []


def test_rejected_update_does_not_change_the_user(db, ic, client_as):
    client_as(ic).patch("/users/me/status", json={"late_arrive_eta": "11:00"})

    db.refresh(ic)
    assert ic.late_arrive_eta is None


def test_eta_alongside_status_in_one_request_is_accepted(db, ic, client_as):
    r = client_as(ic).patch("/users/me/status", json={
        "office_status": "IN",
        "late_arrive_eta": "11:00",
    })

    assert r.status_code == 200
    assert events_for(db, ic)[0].late_arrive_eta == time(11, 0)


def test_clearing_the_status_is_rejected(db, ic, client_as):
    client_as(ic).patch("/users/me/status", json={"office_status": "IN"})
    r = client_as(ic).patch("/users/me/status", json={"office_status": None})

    assert r.status_code == 400
    assert len(events_for(db, ic)) == 1


def test_empty_payload_is_rejected(db, ic, client_as):
    r = client_as(ic).patch("/users/me/status", json={})

    assert r.status_code == 400
    assert events_for(db, ic) == []


# ---------------------------------------------------------------------------
# The nightly reset is not a user action
# ---------------------------------------------------------------------------

def test_daily_reset_writes_no_events(db, ic, client_as):
    from sqlalchemy.orm import sessionmaker
    from core import scheduled_tasks

    client_as(ic).patch("/users/me/status", json={"office_status": "IN"})

    # reset_daily_statuses closes the session it opens, so hand it its own
    # against the same in-memory database rather than the test's.
    with patch.object(scheduled_tasks, "SessionLocal", sessionmaker(bind=db.get_bind())):
        scheduled_tasks.reset_daily_statuses()

    db.refresh(ic)
    assert ic.office_status is None
    assert len(events_for(db, ic)) == 1  # the PATCH, and nothing from the reset


# ---------------------------------------------------------------------------
# Business date is the IST calendar date
# ---------------------------------------------------------------------------

def test_business_date_is_the_ist_date_of_the_event(db, ic, client_as):
    late = datetime(2026, 3, 14, 23, 50)  # 23:50 IST, still the 14th

    with patch("routes.users.now_ist", return_value=late):
        client_as(ic).patch("/users/me/status", json={"office_status": "IN"})

    e = events_for(db, ic)[0]
    assert e.occurred_at == late
    assert e.business_date == late.date()


# ---------------------------------------------------------------------------
# GET /users/{user_id}/status-history
# ---------------------------------------------------------------------------

def _patch_at(client, moment, **body):
    with patch("routes.users.now_ist", return_value=moment):
        return client.patch("/users/me/status", json=body)


def test_history_groups_events_by_day(db, ic, client_as):
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 47), office_status="IN")
    _patch_at(client_as(ic), datetime(2026, 3, 10, 15, 5), office_status="WFH")
    _patch_at(client_as(ic), datetime(2026, 3, 11, 9, 12), office_status="WFH")

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 11).date()):
        r = client_as(ic).get(f"/users/{ic.id}/status-history")

    assert r.status_code == 200
    days = r.json()
    assert [d["business_date"] for d in days] == ["2026-03-11", "2026-03-10"]  # newest first
    assert len(days[1]["events"]) == 2


def test_history_reports_clock_in_and_final_status(db, ic, client_as):
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 47), office_status="IN")
    _patch_at(client_as(ic), datetime(2026, 3, 10, 15, 5), office_status="WFH")

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 10).date()):
        day = client_as(ic).get(f"/users/{ic.id}/status-history").json()[0]

    assert day["clocked_in_at"] == "2026-03-10T09:47:00"
    assert day["final_status"] == "WFH"


def test_history_orders_a_days_events_chronologically(db, ic, client_as):
    _patch_at(client_as(ic), datetime(2026, 3, 10, 15, 5), office_status="WFH")
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 47), office_status="IN")

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 10).date()):
        day = client_as(ic).get(f"/users/{ic.id}/status-history").json()[0]

    assert [e["office_status"] for e in day["events"]] == ["IN", "WFH"]


def test_history_omits_days_with_no_events(db, ic, client_as):
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 47), office_status="IN")

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 12).date()):
        days = client_as(ic).get(f"/users/{ic.id}/status-history").json()

    assert len(days) == 1  # the 11th never happened


def test_history_window_excludes_older_days(db, ic, client_as):
    _patch_at(client_as(ic), datetime(2026, 1, 1, 9, 0), office_status="IN")
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 0), office_status="IN")

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 10).date()):
        days = client_as(ic).get(f"/users/{ic.id}/status-history?days=30").json()

    assert [d["business_date"] for d in days] == ["2026-03-10"]


def test_history_window_boundary_is_inclusive(db, ic, client_as):
    # days=30 means today and the 29 days before it.
    _patch_at(client_as(ic), datetime(2026, 3, 10, 9, 0), office_status="IN")
    _patch_at(client_as(ic), datetime(2026, 2, 9, 9, 0), office_status="WFH")  # 29 days earlier

    with patch("core.status_history.today_ist", return_value=datetime(2026, 3, 10).date()):
        days = client_as(ic).get(f"/users/{ic.id}/status-history?days=30").json()

    assert [d["business_date"] for d in days] == ["2026-03-10", "2026-02-09"]


def test_history_is_readable_for_another_user(db, ic, manager, client_as):
    # Real clock on both sides, so the event lands inside the default window.
    client_as(manager).patch("/users/me/status", json={"office_status": "IN"})

    r = client_as(ic).get(f"/users/{manager.id}/status-history")

    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["final_status"] == "IN"


def test_history_for_unknown_user_is_404(db, ic, client_as):
    r = client_as(ic).get("/users/999999/status-history")

    assert r.status_code == 404


def test_history_for_a_user_with_no_events_is_empty(db, ic, manager, client_as):
    r = client_as(ic).get(f"/users/{manager.id}/status-history")

    assert r.status_code == 200
    assert r.json() == []


def test_history_rejects_a_nonsense_window(db, ic, client_as):
    assert client_as(ic).get(f"/users/{ic.id}/status-history?days=0").status_code == 422
    assert client_as(ic).get(f"/users/{ic.id}/status-history?days=99999").status_code == 422
