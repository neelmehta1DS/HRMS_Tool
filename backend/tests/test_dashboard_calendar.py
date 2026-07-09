from datetime import date, datetime, timedelta

import pytest

from models.catchups import Catchup
from models.leaves import Leave, LeaveStatus, LeaveType
from models.users import User


CAL = "/dashboard/calendar"


def fetch(client_as, user, start, end):
    return client_as(user).get(CAL, params={"start": start, "end": end})


def events_of(payload, kind):
    return [e for e in payload["events"] if e["type"] == kind]


def add_leave(db, user, start, end, status=LeaveStatus.approved, leave_type=LeaveType.earned):
    lv = Leave(user_id=user.id, leave_type=leave_type, start_date=start, end_date=end, status=status)
    db.add(lv)
    db.commit()
    return lv


def add_catchup(db, manager, employee, when, alternate_manager=None):
    c = Catchup(
        manager_id=manager.id,
        employee_id=employee.id,
        alternate_manager_id=alternate_manager.id if alternate_manager else None,
        notes_doc_link="https://docs.example/1",
        meeting_link="https://meet.example/1",
        date_and_time=when,
    )
    db.add(c)
    db.commit()
    return c


# ─── Birthdays ────────────────────────────────────────────────────────────────

def test_birthday_in_viewed_month_appears(db, ic, client_as):
    ic.birthday = date(1990, 7, 14)
    db.commit()

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert r.status_code == 200

    [b] = events_of(r.json(), "birthday")
    assert b["start_date"] == "2026-07-14"
    assert b["end_date"] == "2026-07-14"
    assert b["user_id"] == ic.id
    assert b["title"] == "IC User"


def test_birthday_outside_viewed_month_absent(db, ic, client_as):
    ic.birthday = date(1990, 9, 14)
    db.commit()

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "birthday") == []


def test_birthday_appears_when_viewing_a_past_month(db, ic, client_as):
    """The case `next_occurrence` alone gets wrong: it only looks forward."""
    ic.birthday = date(1990, 3, 5)
    db.commit()

    past_year = date.today().year - 2
    r = fetch(client_as, ic, f"{past_year}-03-01", f"{past_year}-03-31")

    [b] = events_of(r.json(), "birthday")
    assert b["start_date"] == f"{past_year}-03-05"


def test_feb_29_birthday_observed_on_feb_28_in_non_leap_year(db, ic, client_as):
    ic.birthday = date(1992, 2, 29)
    db.commit()

    r = fetch(client_as, ic, "2026-02-01", "2026-02-28")  # 2026 is not a leap year

    [b] = events_of(r.json(), "birthday")
    assert b["start_date"] == "2026-02-28"


def test_feb_29_birthday_observed_on_feb_29_in_leap_year(db, ic, client_as):
    ic.birthday = date(1992, 2, 29)
    db.commit()

    r = fetch(client_as, ic, "2028-02-01", "2028-02-29")  # 2028 is a leap year

    [b] = events_of(r.json(), "birthday")
    assert b["start_date"] == "2028-02-29"


def test_range_spanning_year_boundary_returns_both_years(db, ic, manager, client_as):
    ic.birthday = date(1990, 12, 20)
    manager.birthday = date(1985, 1, 8)
    db.commit()

    r = fetch(client_as, ic, "2026-12-15", "2027-01-15")

    days = sorted(e["start_date"] for e in events_of(r.json(), "birthday"))
    assert days == ["2026-12-20", "2027-01-08"]


def test_user_without_birthday_produces_no_event(db, ic, client_as):
    assert ic.birthday is None
    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "birthday") == []


# ─── Anniversaries ────────────────────────────────────────────────────────────

def test_anniversary_years_are_computed(db, ic, client_as):
    ic.joining_date = date(2021, 7, 14)
    db.commit()

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    [a] = events_of(r.json(), "anniversary")
    assert a["start_date"] == "2026-07-14"
    assert a["years"] == 5
    assert a["user_id"] == ic.id


def test_joining_month_itself_is_not_an_anniversary(db, ic, client_as):
    """Year zero is a start date, not an anniversary."""
    ic.joining_date = date(2026, 7, 14)
    db.commit()

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "anniversary") == []


def test_future_joiner_produces_no_anniversary(db, ic, client_as):
    ic.joining_date = date(2030, 7, 14)
    db.commit()

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "anniversary") == []


# ─── Leaves ───────────────────────────────────────────────────────────────────

def test_approved_leave_appears_with_full_span(db, ic, client_as):
    add_leave(db, ic, date(2026, 7, 6), date(2026, 7, 10))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    [lv] = events_of(r.json(), "leave")
    assert lv["start_date"] == "2026-07-06"
    assert lv["end_date"] == "2026-07-10"
    assert lv["leave_type"] == "earned"
    assert lv["user_name"] == "IC User"


@pytest.mark.parametrize("status", [LeaveStatus.pending, LeaveStatus.rejected])
def test_non_approved_leaves_are_excluded(db, ic, client_as, status):
    add_leave(db, ic, date(2026, 7, 6), date(2026, 7, 10), status=status)

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "leave") == []


def test_leave_fully_spanning_the_window_is_returned(db, ic, client_as):
    """Starts before the month and ends after it — overlaps but is contained by neither bound."""
    add_leave(db, ic, date(2026, 6, 20), date(2026, 8, 5))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    [lv] = events_of(r.json(), "leave")
    assert lv["start_date"] == "2026-06-20"
    assert lv["end_date"] == "2026-08-05"


def test_leave_ending_the_day_before_the_window_is_excluded(db, ic, client_as):
    add_leave(db, ic, date(2026, 6, 25), date(2026, 6, 30))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "leave") == []


def test_leaves_are_org_wide_not_just_own(db, ic, manager, skip_manager, client_as):
    add_leave(db, manager, date(2026, 7, 6), date(2026, 7, 7))
    add_leave(db, skip_manager, date(2026, 7, 8), date(2026, 7, 9))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    names = sorted(e["user_name"] for e in events_of(r.json(), "leave"))
    assert names == ["Manager", "Skip Manager"]


# ─── Catchups ─────────────────────────────────────────────────────────────────

def test_catchup_included_when_current_user_is_the_employee(db, ic, manager, client_as):
    add_catchup(db, manager, ic, datetime(2026, 7, 15, 16, 0))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    [c] = events_of(r.json(), "catchup")
    assert c["start_date"] == "2026-07-15"
    assert c["end_date"] == "2026-07-15"
    assert c["starts_at"] == "2026-07-15T16:00:00"
    assert c["meeting_link"] == "https://meet.example/1"


def test_catchup_included_when_current_user_is_the_manager(db, ic, manager, client_as):
    add_catchup(db, manager, ic, datetime(2026, 7, 15, 16, 0))

    r = fetch(client_as, manager, "2026-07-01", "2026-07-31")
    assert len(events_of(r.json(), "catchup")) == 1


def test_catchup_included_when_current_user_is_the_alternate_manager(db, ic, manager, skip_manager, client_as):
    add_catchup(db, manager, ic, datetime(2026, 7, 15, 16, 0), alternate_manager=skip_manager)

    r = fetch(client_as, skip_manager, "2026-07-01", "2026-07-31")
    assert len(events_of(r.json(), "catchup")) == 1


def test_other_peoples_catchups_are_excluded(db, ic, manager, skip_manager, client_as):
    add_catchup(db, skip_manager, manager, datetime(2026, 7, 15, 16, 0))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "catchup") == []


def test_catchup_late_on_the_last_day_is_included(db, ic, manager, client_as):
    """Boundary: a 23:30 catchup on the final day must not be cut off by a midnight bound."""
    add_catchup(db, manager, ic, datetime(2026, 7, 31, 23, 30))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert len(events_of(r.json(), "catchup")) == 1


def test_catchup_outside_window_excluded(db, ic, manager, client_as):
    add_catchup(db, manager, ic, datetime(2026, 8, 1, 9, 0))

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")
    assert events_of(r.json(), "catchup") == []


# ─── Holidays ─────────────────────────────────────────────────────────────────

def test_holidays_in_range_are_included(db, ic, client_as, monkeypatch):
    import routes.dashboard as dash
    monkeypatch.setattr(dash, "HOLIDAYS", [
        {"date": "2026-07-04", "name": "Independence Day"},
        {"date": "2026-09-01", "name": "Labour Day"},
    ])

    r = fetch(client_as, ic, "2026-07-01", "2026-07-31")

    [h] = events_of(r.json(), "holiday")
    assert h["start_date"] == "2026-07-04"
    assert h["title"] == "Independence Day"
    assert h["user_id"] is None


# ─── Range validation ─────────────────────────────────────────────────────────

def test_end_before_start_is_rejected(ic, client_as):
    r = fetch(client_as, ic, "2026-07-31", "2026-07-01")
    assert r.status_code == 400


def test_span_longer_than_92_days_is_rejected(ic, client_as):
    r = fetch(client_as, ic, "2026-01-01", "2026-12-31")
    assert r.status_code == 400


def test_92_day_span_is_accepted(ic, client_as):
    start = date(2026, 1, 1)
    r = fetch(client_as, ic, str(start), str(start + timedelta(days=91)))
    assert r.status_code == 200


def test_single_day_range_is_accepted(ic, client_as):
    r = fetch(client_as, ic, "2026-07-15", "2026-07-15")
    assert r.status_code == 200
