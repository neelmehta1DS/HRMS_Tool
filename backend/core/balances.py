from sqlalchemy.orm import Session

from core.workdays import count_weekdays
from models.leaves import Leave, LeaveBalance, LeaveStatus, balance_key


def recompute_balances(db: Session, user_id: int) -> None:
    """Rebuild every leave balance for a user from their approved leaves.

    The normal flow nudges `days_taken` up on approval and down on deletion. An
    admin can change a leave's dates, type and status in a single edit, so a
    delta is not recoverable — the balances are derived from scratch instead.

    Balances are attributed to the year a leave starts in, matching the rest of
    the app. Rows for a (type, year) that no longer has approved leaves are
    zeroed rather than deleted, so a year's history stays visible.
    """
    approved = (
        db.query(Leave)
        .filter(Leave.user_id == user_id, Leave.status == LeaveStatus.approved)
        .all()
    )

    totals: dict[tuple, int] = {}
    for leave in approved:
        # Sick and casual leaves both accumulate into the shared sick_and_casual row.
        key = (balance_key(leave.leave_type), leave.start_date.year)
        totals[key] = totals.get(key, 0) + count_weekdays(leave.start_date, leave.end_date)

    existing = {
        (b.leave_type, b.year): b
        for b in db.query(LeaveBalance).filter(LeaveBalance.user_id == user_id).all()
    }

    for key, days in totals.items():
        if key in existing:
            existing[key].days_taken = days
        else:
            leave_type, year = key
            db.add(LeaveBalance(user_id=user_id, leave_type=leave_type, year=year, days_taken=days))

    for key, balance in existing.items():
        if key not in totals:
            balance.days_taken = 0

    db.flush()
