from typing import Annotated
from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, and_
from sqlalchemy.orm import Session
from schemas.leaves import LeaveCreate, LeaveResponse, LeaveRejectRequest
from models.leaves import Leave, LeaveApproval, LeaveType, LeaveStatus, ApprovalStatus
from models.users import User
from core.security import get_current_user
from core.holidays import HOLIDAYS, HOLIDAY_DATES
from core.leave_limits import LEAVE_LIMITS, LEAVE_RULES, get_notice_days
from core import slack
from db.database import get_db

router = APIRouter(prefix="/leaves", tags=["leaves"])


def count_weekdays(start: date, end: date) -> int:
    count = 0
    current = start
    while current <= end:
        if current.weekday() < 5 and current not in HOLIDAY_DATES:
            count += 1
        current += timedelta(days=1)
    return count


def working_days_until(from_date: date, to_date: date) -> int:
    """Working days strictly between from_date (inclusive) and to_date (exclusive)."""
    if to_date <= from_date:
        return 0
    return count_weekdays(from_date, to_date - timedelta(days=1))


def add_working_days(from_date: date, days: int) -> date:
    """Return the date that is `days` working days after from_date."""
    current = from_date
    count = 0
    while count < days:
        current += timedelta(days=1)
        if current.weekday() < 5 and current not in HOLIDAY_DATES:
            count += 1
    return current


@router.get("/holidays")
def get_holidays():
    return HOLIDAYS


@router.get("/limits")
def get_leave_limits():
    return LEAVE_LIMITS


@router.get("/rules")
def get_leave_rules():
    return LEAVE_RULES


@router.get("", response_model=dict[str, list[LeaveResponse]])
def get_current_leaves(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = datetime.now().date()
    two_weeks_from_now = today + timedelta(weeks=2)

    current_leaves = db.query(Leave).where(
        Leave.start_date <= today,
        Leave.end_date >= today,
        Leave.status == LeaveStatus.approved,
    ).all()

    upcoming_leaves = db.query(Leave).where(
        Leave.start_date > today,
        Leave.start_date < two_weeks_from_now,
        Leave.status == LeaveStatus.approved,
    ).all()

    return {"current": current_leaves, "upcoming": upcoming_leaves}


@router.get("/me/balance")
def get_my_leave_balance(current_user: Annotated[User, Depends(get_current_user)]):
    return {
        "sick_taken": current_user.sick_leaves_taken,
        "casual_taken": current_user.casual_leaves_taken,
    }


@router.get("/me", response_model=dict[str, list[LeaveResponse]])
def get_my_leaves(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = datetime.now().date()
    uid = current_user.id

    pending = db.query(Leave).where(
        Leave.user_id == uid,
        Leave.status == LeaveStatus.pending,
        Leave.start_date >= today,
    ).all()

    upcoming = db.query(Leave).where(
        Leave.user_id == uid,
        Leave.status == LeaveStatus.approved,
        Leave.start_date >= today,
    ).all()

    rejected = db.query(Leave).where(
        Leave.user_id == uid,
        Leave.status == LeaveStatus.rejected,
        Leave.start_date >= today,
    ).all()

    previous = db.query(Leave).where(
        Leave.user_id == uid,
        Leave.status == LeaveStatus.approved,
        Leave.end_date < today,
    ).all()

    return {"pending": pending, "upcoming": upcoming, "rejected": rejected, "previous": previous}


@router.get("/manager/me", response_model=list[LeaveResponse])
def get_my_leaves_as_manager(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = datetime.now().date()

    # For each pending leave, find the lowest pending step number.
    # Only surface a leave to a manager if their approval row IS that lowest step —
    # this prevents skip managers from seeing step-2 rows before step-1 is resolved.
    min_pending = (
        db.query(
            LeaveApproval.leave_id,
            func.min(LeaveApproval.step).label("min_step"),
        )
        .where(LeaveApproval.status == ApprovalStatus.pending)
        .group_by(LeaveApproval.leave_id)
        .subquery()
    )

    pending_leaves = (
        db.query(Leave)
        .join(LeaveApproval, LeaveApproval.leave_id == Leave.id)
        .join(min_pending, and_(
            min_pending.c.leave_id == Leave.id,
            LeaveApproval.step == min_pending.c.min_step,
        ))
        .where(
            LeaveApproval.approver_id == current_user.id,
            LeaveApproval.status == ApprovalStatus.pending,
            Leave.status == LeaveStatus.pending,
            Leave.start_date >= today,
        )
        .all()
    )

    def with_over_limit(leave: Leave) -> LeaveResponse:
        r = LeaveResponse.model_validate(leave)
        d = count_weekdays(leave.start_date, leave.end_date)
        lim = LEAVE_LIMITS.get(str(leave.leave_type))
        taken = leave.user.sick_leaves_taken if leave.leave_type == LeaveType.sick else leave.user.casual_leaves_taken
        r.over_limit = lim is not None and (taken + d) > lim
        return r

    return [with_over_limit(l) for l in pending_leaves]


@router.post("", response_model=LeaveResponse)
def create_leave(leave: LeaveCreate, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = date.today()
    effective_end = leave.end_date or leave.start_date
    is_admin = current_user.is_admin

    if not is_admin and (not leave.note or not leave.note.strip()):
        raise HTTPException(status_code=422, detail="Note is required.")

    if effective_end < leave.start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")

    if not is_admin and leave.leave_type == LeaveType.sick:
        if leave.start_date != today or effective_end != today:
            raise HTTPException(status_code=422, detail="Sick leave can only be applied for today.")

    if leave.leave_type == LeaveType.casual and not is_admin and not leave.is_exception:
        advance = working_days_until(today, leave.start_date)
        duration = count_weekdays(leave.start_date, effective_end)
        notice_rules = LEAVE_RULES.get("casual_advance_notice", [])
        min_advance = get_notice_days(duration, notice_rules)
        if advance < min_advance:
            earliest = add_working_days(today, min_advance)
            raise HTTPException(status_code=422,
                detail=f"Casual leave ({duration} working day{'s' if duration > 1 else ''}) requires {min_advance} working day{'s' if min_advance > 1 else ''} advance notice. Earliest start: {earliest}.")

    # Overlap check — reject if any non-rejected leave already covers any day in the requested range
    overlap = db.query(Leave).filter(
        Leave.user_id == current_user.id,
        Leave.start_date <= effective_end,
        Leave.end_date >= leave.start_date,
        Leave.status != LeaveStatus.rejected,
    ).first()
    if not is_admin and overlap:
        raise HTTPException(
            status_code=422,
            detail=f"You already have a leave request covering that period ({overlap.start_date} – {overlap.end_date})."
        )

    days = count_weekdays(leave.start_date, effective_end)
    limit = LEAVE_LIMITS.get(str(leave.leave_type))
    current_taken = current_user.sick_leaves_taken if leave.leave_type == LeaveType.sick else current_user.casual_leaves_taken
    over_limit = limit is not None and (current_taken + days) > limit

    manager = current_user.manager
    skip = manager.manager if manager else None
    auto_approve = leave.leave_type == LeaveType.sick or not manager

    new_leave = Leave(
        user_id=current_user.id,
        leave_type=leave.leave_type,
        note=leave.note,
        start_date=leave.start_date,
        end_date=effective_end,
        is_exception=leave.is_exception,
        status=LeaveStatus.approved if auto_approve else LeaveStatus.pending,
    )
    db.add(new_leave)
    db.flush()

    # Build approval rows (all upfront; manager view filters to lowest pending step)
    approval_rows: list[LeaveApproval] = []
    if not auto_approve:
        if leave.is_exception and skip:
            # Exception with skip manager → only skip manager approves
            approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=skip.id, step=2))
        else:
            # Normal casual (or exception without a skip manager) → direct manager first
            approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=manager.id, step=1))
            if skip and not leave.is_exception:
                approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=skip.id, step=2))

    for ar in approval_rows:
        db.add(ar)
    db.flush()

    date_str = str(new_leave.start_date) if new_leave.start_date == new_leave.end_date else f"{new_leave.start_date} → {new_leave.end_date}"
    type_label = str(leave.leave_type).capitalize()
    day_word = "day" if days == 1 else "days"

    if auto_approve:
        if leave.leave_type == LeaveType.sick:
            current_user.sick_leaves_taken += days
        elif leave.leave_type == LeaveType.casual:
            current_user.casual_leaves_taken += days
        if current_user.slack_user_id:
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} auto-approved.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":white_check_mark: *Leave #{new_leave.id} auto-approved & logged.*\n"
                            f"_{type_label} · {date_str} · {days} working {day_word}._"}}])
    elif leave.is_exception and skip:
        # Exception: notify user, DM skip manager
        step2_row = approval_rows[0]
        if current_user.slack_user_id:
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} submitted as exception.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":hourglass_flowing_sand: *Leave #{new_leave.id} submitted as an exception* — {leave.leave_type} · {date_str} · {days} working {day_word}.\n"
                            f"Awaiting approval from *{skip.name}* (notice rules waived)."}}])
        if skip.slack_user_id:
            msg = slack.dm(skip.slack_user_id, **slack.approver_payload(new_leave, current_user, "Exception — direct approval", days, over_limit))
            if msg:
                step2_row.slack_channel = msg["channel"]
                step2_row.slack_ts = msg["ts"]
    else:
        # Normal casual (or exception falling back to direct manager)
        step1_row = approval_rows[0]
        if current_user.slack_user_id:
            awaiting = f"*{manager.name}*" + (f", then *{skip.name}*." if skip else ".")
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} submitted.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":hourglass_flowing_sand: *Leave #{new_leave.id} submitted* — {leave.leave_type} · {date_str} · {days} working {day_word}.\n"
                            f"Awaiting approval from {awaiting}"}}])
        if manager.slack_user_id:
            step_label = "Single approval" if not skip else "Step 1 of 2"
            msg = slack.dm(manager.slack_user_id, **slack.approver_payload(new_leave, current_user, step_label, days, over_limit))
            if msg:
                step1_row.slack_channel = msg["channel"]
                step1_row.slack_ts = msg["ts"]

    db.commit()
    db.refresh(new_leave)
    response = LeaveResponse.model_validate(new_leave)
    response.over_limit = over_limit
    return response


@router.patch("/{leave_id}/approve", response_model=LeaveResponse)
def approve_leave(leave_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    leave = db.query(Leave).where(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    # The next actionable step is always the lowest-numbered pending one
    approval_step = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .order_by(LeaveApproval.step)
        .first()
    )

    if not approval_step:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Leave is already fully approved or rejected")
    if approval_step.approver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your leave request to approve")

    approval_step.status = ApprovalStatus.approved
    approval_step.decided_at = datetime.utcnow()
    db.flush()  # write the status change before counting remaining pending steps

    remaining = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .count()
    )
    is_fully_approved = remaining == 0

    user = leave.user
    days = count_weekdays(leave.start_date, leave.end_date)

    if is_fully_approved:
        leave.status = LeaveStatus.approved
        if leave.leave_type == LeaveType.sick:
            user.sick_leaves_taken += days
        else:
            user.casual_leaves_taken += days

    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"
    type_label = str(leave.leave_type).capitalize()

    slack.delete_msg(approval_step.slack_channel, approval_step.slack_ts)
    approval_step.slack_channel = None
    approval_step.slack_ts = None

    if is_fully_approved:
        if user.slack_user_id:
            slack.dm(user.slack_user_id,
                text=f"Leave #{leave.id} approved!",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":tada: *Leave #{leave.id} fully approved!*\n_{type_label} · {date_str} · {days} working day(s)._"}}])
    else:
        next_step = (
            db.query(LeaveApproval)
            .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
            .order_by(LeaveApproval.step)
            .first()
        )
        if user.slack_user_id:
            next_name = next_step.approver.name if next_step else "your manager"
            slack.dm(user.slack_user_id,
                text=f"Leave #{leave.id} update",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":arrow_forward: *Leave #{leave.id}* — {current_user.name} approved. Now awaiting *{next_name}*."}}])
        if next_step and next_step.approver.slack_user_id:
            msg = slack.dm(next_step.approver.slack_user_id, **slack.approver_payload(leave, user, "Step 2 of 2", days))
            if msg:
                next_step.slack_channel = msg["channel"]
                next_step.slack_ts = msg["ts"]

    db.commit()
    db.refresh(leave)
    return leave


@router.patch("/{leave_id}/reject", response_model=LeaveResponse)
def reject_leave(leave_id: int, body: LeaveRejectRequest, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    leave = db.query(Leave).where(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    approval_step = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .order_by(LeaveApproval.step)
        .first()
    )

    if not approval_step:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Leave is already fully approved or rejected")
    if approval_step.approver_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your leave request to reject")

    approval_step.status = ApprovalStatus.rejected
    approval_step.decided_at = datetime.utcnow()
    approval_step.rejection_note = body.reason
    leave.status = LeaveStatus.rejected

    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"
    type_label = str(leave.leave_type).capitalize()

    slack.delete_msg(approval_step.slack_channel, approval_step.slack_ts)
    approval_step.slack_channel = None
    approval_step.slack_ts = None

    user = leave.user
    if user.slack_user_id:
        slack.dm(user.slack_user_id,
            text=f"Leave #{leave.id} rejected.",
            blocks=[{"type": "section", "text": {"type": "mrkdwn",
                "text": f":x: *Leave #{leave.id} was rejected* by {current_user.name}.\n"
                        f"_{type_label} leave · {date_str}_\n"
                        f"_Reason:_ {body.reason}"}}])

    db.commit()
    db.refresh(leave)
    return leave


@router.delete("/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_leave(leave_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    leave = db.query(Leave).where(Leave.id == leave_id, Leave.user_id == current_user.id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    if not current_user.is_admin and leave.start_date <= datetime.now().date():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete a leave that has already started or passed")

    if leave.status == LeaveStatus.approved:
        days = count_weekdays(leave.start_date, leave.end_date)
        if leave.leave_type == LeaveType.sick:
            current_user.sick_leaves_taken = max(0, current_user.sick_leaves_taken - days)
        else:
            current_user.casual_leaves_taken = max(0, current_user.casual_leaves_taken - days)

    # Snapshot Slack info from pending approval rows before the cascade delete
    pending_approvals = [a for a in leave.approvals if a.status == ApprovalStatus.pending]
    slack_msgs = [(a.slack_channel, a.slack_ts) for a in pending_approvals if a.slack_channel]
    approver_slack_ids = [a.approver.slack_user_id for a in pending_approvals if a.approver.slack_user_id]

    type_label = str(leave.leave_type).capitalize()
    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"

    db.delete(leave)
    db.commit()

    for ch, ts in slack_msgs:
        slack.delete_msg(ch, ts)

    withdrawal_note = (
        f":x: *Leave request withdrawn* by {current_user.name}.\n"
        f"_{type_label} · {date_str}_"
    )
    for slack_id in approver_slack_ids:
        slack.dm(slack_id, text=withdrawal_note, blocks=[
            {"type": "section", "text": {"type": "mrkdwn", "text": withdrawal_note}}
        ])

    if current_user.slack_user_id:
        slack.dm(current_user.slack_user_id,
            text="Leave request withdrawn.",
            blocks=[{"type": "section", "text": {"type": "mrkdwn",
                "text": f":white_check_mark: Your *{type_label}* leave request ({date_str}) has been successfully withdrawn."
            }}]
        )
