"""Tests for the leave-hygiene score (core/leave_hygiene.py + routes)."""
from datetime import date, timedelta

from core import leave_hygiene
from models.leaves import Leave, LeaveType, LeaveStatus


TODAY = date(2026, 7, 15)


def _add_leave(db, user, *, start, days=1, status=LeaveStatus.approved,
               is_exception=False, created_by_admin=False, leave_type=LeaveType.earned):
    lv = Leave(
        user_id=user.id,
        leave_type=leave_type,
        start_date=start,
        end_date=start + timedelta(days=days - 1),
        status=status,
        is_exception=is_exception,
        created_by_admin=created_by_admin,
        note="x",
    )
    db.add(lv)
    db.commit()
    db.refresh(lv)
    return lv


def _months_before(months):
    return TODAY - timedelta(days=round(leave_hygiene.DAYS_PER_MONTH * months))


# ── Core computation ────────────────────────────────────────────────────────────

def test_worked_example_from_spec(db, ic):
    """total=6, approved exception 1mo ago, HoP-logged 5mo ago → score 65 (Fair)."""
    # 4 plain approved leaves so total leaves taken == 6 (with the two events below).
    for m in (2, 3, 4, 5):
        _add_leave(db, ic, start=_months_before(m))
    _add_leave(db, ic, start=_months_before(1), is_exception=True, status=LeaveStatus.approved)
    _add_leave(db, ic, start=_months_before(5), created_by_admin=True)

    result = leave_hygiene.compute(db, ic, today=TODAY)

    assert result.total_leaves == 6
    assert result.exceptions == 1
    assert result.hop_absences == 1
    assert result.score == 65
    assert result.band == "Fair"
    # HoP-logged absence leads the driver text.
    assert result.driver == "1 unapproved absence logged by HoP · 1 exception"


def test_clean_record_scores_100(db, ic):
    for m in (1, 2, 3):
        _add_leave(db, ic, start=_months_before(m))
    result = leave_hygiene.compute(db, ic, today=TODAY)
    assert result.score == 100
    assert result.band == "Excellent"
    assert result.driver == "All leaves planned and filed on time"


def test_declined_exception_weighs_more_than_approved(db, ic, manager, skip_manager):
    """A declined exception weighs more than an approved one (1.5 vs 1.0):
    asking to bypass notice and being refused is worse hygiene than being granted.

    Each subject has exactly one exception (total=1, denom = 1 + 4 = 5), so the
    only difference is the weight — approved → 1.0/5 penalty → 80; declined →
    1.5/5 penalty → 70.
    """
    _add_leave(db, ic, start=_months_before(1), is_exception=True, status=LeaveStatus.approved)
    approved = leave_hygiene.compute(db, ic, today=TODAY)

    # manager is also a managed user (reports to skip_manager), reuse as second subject
    _add_leave(db, manager, start=_months_before(1), is_exception=True, status=LeaveStatus.rejected)
    declined = leave_hygiene.compute(db, manager, today=TODAY)

    assert approved.score == 80
    assert declined.score == 70
    assert declined.score < approved.score


def test_rejected_leaves_count_toward_total(db, ic):
    """Both approved and rejected leaves feed the denominator; pending don't."""
    _add_leave(db, ic, start=_months_before(1), status=LeaveStatus.approved)
    _add_leave(db, ic, start=_months_before(2), status=LeaveStatus.rejected)
    _add_leave(db, ic, start=_months_before(3), status=LeaveStatus.rejected)
    _add_leave(db, ic, start=_months_before(4), status=LeaveStatus.pending)
    result = leave_hygiene.compute(db, ic, today=TODAY)
    assert result.total_leaves == 3  # 1 approved + 2 rejected, pending excluded


def test_events_past_12_months_drop_out(db, ic):
    _add_leave(db, ic, start=_months_before(13), is_exception=True, status=LeaveStatus.approved)
    result = leave_hygiene.compute(db, ic, today=TODAY)
    # The old exception is beyond the window: no penalty, no count.
    assert result.score == 100
    assert result.exceptions == 0


def test_decay_halves_weight_between_6_and_12_months(db, ic):
    # One HoP absence at 9 months → half of the 2.5 weight = 1.25, and it is the
    # only leave, so total=1, denom = 1 + 4 = 5. penalty = 1.25/5 = 0.25 → 75.
    _add_leave(db, ic, start=_months_before(9), created_by_admin=True)
    result = leave_hygiene.compute(db, ic, today=TODAY)
    assert result.score == 75
    assert result.band == "Good"


def test_l2_lead_has_no_score(db, skip_manager):
    """A user with no manager gets None — hygiene is not computed for L2 leads."""
    assert skip_manager.manager_id is None
    assert leave_hygiene.compute(db, skip_manager, today=TODAY) is None


# ── Endpoints ───────────────────────────────────────────────────────────────────

def test_me_hygiene_endpoint(client_as, ic, db):
    _add_leave(db, ic, start=_months_before(1), is_exception=True, status=LeaveStatus.approved)
    resp = client_as(ic).get("/leaves/me/hygiene")
    assert resp.status_code == 200
    data = resp.json()
    assert data["exceptions"] == 1
    assert 0 <= data["score"] <= 100


def test_me_hygiene_endpoint_null_for_l2(client_as, skip_manager):
    resp = client_as(skip_manager).get("/leaves/me/hygiene")
    assert resp.status_code == 200
    assert resp.json() is None


def test_user_hygiene_endpoint(client_as, manager, ic, db):
    _add_leave(db, ic, start=_months_before(2), created_by_admin=True)
    resp = client_as(manager).get(f"/leaves/{ic.id}/hygiene")
    assert resp.status_code == 200
    assert resp.json()["hop_absences"] == 1


def test_user_hygiene_endpoint_404(client_as, manager):
    resp = client_as(manager).get("/leaves/99999/hygiene")
    assert resp.status_code == 404
