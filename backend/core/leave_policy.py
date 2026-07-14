"""The one place that decides whether a leave request is valid and pre-approved.

Three call sites need this — the web create route, the admin edit re-validation,
and the Slack bot. They used to carry three copies of the rules, which is how
they drifted (the bot's sick branch never honoured the admin bypass).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from core.leave_limits import LEAVE_RULES, get_notice_days
from core.workdays import add_working_days
from models.leaves import LeaveType


@dataclass(frozen=True)
class Decision:
    """auto_approve reports only what the leave type's own rule grants.

    Callers OR it with `unconstrained` — admins and managerless users have their
    leave approved on arrival regardless of type, which is the caller's business,
    not the policy's.
    """
    auto_approve: bool
    error: str | None = None


def _plural(n: int) -> str:
    return "" if n == 1 else "s"


def sick_cutoff() -> tuple[int, int]:
    return LEAVE_RULES.get("sick_cutoff_hour", 10), LEAVE_RULES.get("sick_cutoff_min", 0)


def _before_sick_cutoff(now: datetime) -> bool:
    hour, minute = sick_cutoff()
    return (now.hour * 60 + now.minute) < (hour * 60 + minute)


def _notice_error(
    label: str, rules_key: str, working_days: int, start: date, today: date, *, working_notice: bool
) -> str | None:
    """Notice is measured in working days for casual leave, calendar days for earned."""
    required = get_notice_days(working_days, LEAVE_RULES.get(rules_key, []))
    earliest = add_working_days(today, required) if working_notice else today + timedelta(days=required)
    if start >= earliest:
        return None
    unit = "working" if working_notice else "calendar"
    return (
        f"{label} leave ({working_days} working day{_plural(working_days)}) requires "
        f"{required} {unit} days notice. Earliest start: {earliest}."
    )


def evaluate(
    leave_type: LeaveType,
    start: date,
    working_days: int,
    now: datetime,
    today: date,
    *,
    unconstrained: bool,
    is_exception: bool,
) -> Decision:
    """Validate a leave request and say whether its type auto-approves it.

    `unconstrained` (admin or managerless) waives validation here; it separately
    forces approval back in the caller.
    """
    if leave_type == LeaveType.sick:
        if not unconstrained and start != today:
            return Decision(auto_approve=False, error="Sick leave must start today.")
        return Decision(auto_approve=_before_sick_cutoff(now))

    if leave_type == LeaveType.casual:
        if not unconstrained and not is_exception:
            error = _notice_error("Casual", "casual_advance_notice", working_days, start, today, working_notice=True)
            if error:
                return Decision(auto_approve=False, error=error)
        return Decision(auto_approve=False)

    if leave_type == LeaveType.earned:
        if not unconstrained and not is_exception:
            error = _notice_error("Earned", "earned_advance_notice", working_days, start, today, working_notice=False)
            if error:
                return Decision(auto_approve=False, error=error)
        return Decision(auto_approve=False)

    return Decision(auto_approve=False)
