"""Unit tests for core.leave_policy.evaluate — the leave rules, no DB, no HTTP.

Boundary tests live here rather than against the route because `evaluate` takes
`today` and `working_days` as plain arguments. At the route level a start date of
"today + 3" lands on a weekend two times in seven and the working-day check fires
first, which would make the notice boundaries untestable without heavy patching.
"""
from datetime import date, datetime, timedelta

import pytest

from core.leave_policy import evaluate
from core.workdays import add_working_days
from models.leaves import LeaveType

# A Monday, so `today + n` for small n stays clear of weekend edge cases in the
# few tests below that care. The ladder maths itself is calendar-day, not
# working-day, so the weekday only matters for readability.
TODAY = date(2026, 7, 6)

BEFORE_CUTOFF = datetime(2026, 7, 6, 9, 0)
AT_CUTOFF = datetime(2026, 7, 6, 10, 0)
AFTER_CUTOFF = datetime(2026, 7, 6, 10, 1)


def _eval(leave_type, start, working_days=1, now=BEFORE_CUTOFF, unconstrained=False, is_exception=False):
    return evaluate(
        leave_type, start, working_days, now, TODAY,
        unconstrained=unconstrained, is_exception=is_exception,
    )


# ---------------------------------------------------------------------------
# Sick
# ---------------------------------------------------------------------------

def test_sick_today_before_cutoff_auto_approves():
    d = _eval(LeaveType.sick, TODAY, now=BEFORE_CUTOFF)
    assert d.error is None
    assert d.auto_approve is True


def test_sick_multi_day_today_before_cutoff_auto_approves():
    """A multi-day sick leave starting today still auto-approves.

    The old sick_and_casual rule required end == today, so this never used to.
    """
    d = _eval(LeaveType.sick, TODAY, working_days=3, now=BEFORE_CUTOFF)
    assert d.error is None
    assert d.auto_approve is True


def test_sick_at_cutoff_needs_approval():
    d = _eval(LeaveType.sick, TODAY, now=AT_CUTOFF)
    assert d.error is None
    assert d.auto_approve is False


def test_sick_after_cutoff_needs_approval():
    d = _eval(LeaveType.sick, TODAY, now=AFTER_CUTOFF)
    assert d.error is None
    assert d.auto_approve is False


def test_sick_tomorrow_is_rejected():
    d = _eval(LeaveType.sick, TODAY + timedelta(days=1))
    assert d.error == "Sick leave must start today."


def test_sick_yesterday_is_rejected():
    d = _eval(LeaveType.sick, TODAY - timedelta(days=1))
    assert d.error == "Sick leave must start today."


def test_sick_unconstrained_may_start_any_day():
    d = _eval(LeaveType.sick, TODAY + timedelta(days=5), unconstrained=True)
    assert d.error is None


# ---------------------------------------------------------------------------
# Casual — the notice ladder: 1d→3, 2d→7, 3d→14, 4+d→30 working days
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("working_days,required", [(1, 3), (2, 7), (3, 14), (4, 30), (5, 30), (9, 30)])
def test_casual_accepted_exactly_at_the_notice_boundary(working_days, required):
    d = _eval(LeaveType.casual, add_working_days(TODAY, required), working_days=working_days)
    assert d.error is None
    assert d.auto_approve is False


@pytest.mark.parametrize("working_days,required", [(1, 3), (2, 7), (3, 14), (4, 30), (5, 30), (9, 30)])
def test_casual_rejected_one_day_short_of_the_boundary(working_days, required):
    d = _eval(LeaveType.casual, add_working_days(TODAY, required - 1), working_days=working_days)
    assert d.error is not None
    assert f"requires {required} working days notice" in d.error
    assert str(add_working_days(TODAY, required)) in d.error


def test_casual_same_day_is_rejected():
    d = _eval(LeaveType.casual, TODAY)
    assert d.error is not None
    assert "3 working days notice" in d.error


def test_casual_never_auto_approves_however_far_out():
    d = _eval(LeaveType.casual, TODAY + timedelta(days=365))
    assert d.error is None
    assert d.auto_approve is False


def test_casual_exception_waives_the_notice_ladder():
    d = _eval(LeaveType.casual, TODAY, is_exception=True)
    assert d.error is None
    assert d.auto_approve is False


def test_casual_unconstrained_waives_the_notice_ladder():
    d = _eval(LeaveType.casual, TODAY, unconstrained=True)
    assert d.error is None
    # Still False — the caller ORs in `unconstrained` to force approval.
    assert d.auto_approve is False


def test_casual_singular_day_wording():
    d = _eval(LeaveType.casual, TODAY, working_days=1)
    assert "(1 working day)" in d.error


def test_casual_plural_day_wording():
    d = _eval(LeaveType.casual, TODAY, working_days=2)
    assert "(2 working days)" in d.error


# ---------------------------------------------------------------------------
# Earned — unchanged behaviour, routed through the same module
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("working_days,required", [(1, 14), (2, 14), (3, 21), (4, 21), (5, 30), (20, 30)])
def test_earned_notice_ladder_boundaries(working_days, required):
    ok = _eval(LeaveType.earned, TODAY + timedelta(days=required), working_days=working_days)
    assert ok.error is None
    assert ok.auto_approve is False

    short = _eval(LeaveType.earned, TODAY + timedelta(days=required - 1), working_days=working_days)
    assert short.error is not None
    assert f"requires {required} calendar days notice" in short.error


def test_earned_exception_waives_notice():
    assert _eval(LeaveType.earned, TODAY, is_exception=True).error is None


# ---------------------------------------------------------------------------
# Special types have no date rule and never auto-approve
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("leave_type", [
    LeaveType.bereavement, LeaveType.marriage, LeaveType.maternity,
    LeaveType.paternity, LeaveType.lwp,
])
def test_special_types_have_no_date_rule(leave_type):
    d = _eval(leave_type, TODAY)
    assert d.error is None
    assert d.auto_approve is False
