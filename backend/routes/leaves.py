from typing import Annotated
from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, aliased
from schemas.leaves import LeaveCreate, LeaveResponse, LeaveRejectRequest
from models.leaves import Leave, LeaveType
from models.users import User
from core.security import get_current_user
from core.holidays import HOLIDAYS, HOLIDAY_DATES
from core.leave_limits import LEAVE_LIMITS
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


@router.get("/holidays")
def get_holidays():
    return HOLIDAYS


@router.get("/limits")
def get_leave_limits():
    return LEAVE_LIMITS


@router.get("", response_model=dict[str, list[LeaveResponse]])
def get_current_leaves(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = datetime.now().date()
    two_weeks_from_now = today + timedelta(weeks=2)

    current_leaves = db.query(Leave).where(
        Leave.start_date <= today,
        Leave.end_date >= today,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).all()

    upcoming_leaves = db.query(Leave).where(
        Leave.start_date > today,
        Leave.start_date < two_weeks_from_now,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
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

    # Not rejected, not fully approved, starts today or later
    pending = db.query(Leave).where(
        Leave.user_id == current_user.id,
        Leave.start_date >= today,
        Leave.approved_by_l1.isnot(False),
        Leave.approved_by_l2.isnot(False),
        or_(Leave.approved_by_l1.is_(None), Leave.approved_by_l2.is_(None)),
    ).all()

    # Fully approved, starts today or later (>= so today's leave isn't lost)
    upcoming = db.query(Leave).where(
        Leave.user_id == current_user.id,
        Leave.start_date >= today,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).all()

    # Rejected by either approver, starts today or later
    rejected = db.query(Leave).where(
        Leave.user_id == current_user.id,
        Leave.start_date >= today,
        or_(Leave.approved_by_l1 == False, Leave.approved_by_l2 == False),
    ).all()

    previous = db.query(Leave).where(
        Leave.user_id == current_user.id,
        Leave.end_date < today,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).all()

    return {"pending": pending, "upcoming": upcoming, "rejected": rejected, "previous": previous}


@router.get("/manager/me", response_model=list[LeaveResponse])
def get_my_leaves_as_manager(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = datetime.now().date()

    LeaveOwner = aliased(User)
    OwnerManager = aliased(User)

    # Direct reports with L1 approval pending (not yet decided, not already rejected)
    l1_pending = (
        db.query(Leave)
        .join(LeaveOwner, Leave.user_id == LeaveOwner.id)
        .where(
            LeaveOwner.manager_id == current_user.id,
            Leave.approved_by_l1.is_(None),
            Leave.approved_by_l2.isnot(False),
            Leave.start_date >= today,
        )
        .all()
    )

    # Skip-level reports with L1 approved, L2 pending
    l2_pending = (
        db.query(Leave)
        .join(LeaveOwner, Leave.user_id == LeaveOwner.id)
        .join(OwnerManager, LeaveOwner.manager_id == OwnerManager.id)
        .where(
            OwnerManager.manager_id == current_user.id,
            Leave.approved_by_l1 == True,
            Leave.approved_by_l2.is_(None),
            Leave.start_date >= today,
        )
        .all()
    )

    return l1_pending + l2_pending


@router.post("", response_model=LeaveResponse)
def create_leave(leave: LeaveCreate, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    today = date.today()
    effective_end = leave.end_date or leave.start_date

    if not leave.note or not leave.note.strip():
        raise HTTPException(status_code=422, detail="Note is required.")

    if effective_end < leave.start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")

    if leave.leave_type == LeaveType.sick:
        if leave.start_date != today or effective_end != today:
            raise HTTPException(status_code=422, detail="Sick leave can only be applied for today.")

    if leave.leave_type == LeaveType.casual:
        advance = (leave.start_date - today).days
        is_multi = (effective_end - leave.start_date).days >= 1
        min_advance = 5 if is_multi else 1
        if advance < min_advance:
            label = "multi-day" if is_multi else "single-day"
            earliest = today + timedelta(days=min_advance)
            raise HTTPException(status_code=422,
                detail=f"Casual leave ({label}) needs {min_advance} day(s) advance notice. Earliest start: {earliest}.")
    # L2 leads (no manager) are auto-approved for all leave types
    auto_approve = leave.leave_type == LeaveType.sick or not current_user.manager
    new_leave = Leave(
        user_id=current_user.id,
        leave_type=leave.leave_type,
        note=leave.note,
        start_date=leave.start_date,
        end_date=effective_end,
        approved_by_l1=True if auto_approve else None,
        approved_by_l2=True if auto_approve else None,
    )
    db.add(new_leave)
    db.flush()  # populate new_leave.id before Slack messages
    if auto_approve:
        days = count_weekdays(leave.start_date, effective_end)
        if leave.leave_type == LeaveType.sick:
            current_user.sick_leaves_taken += days
        elif leave.leave_type == LeaveType.casual:
            current_user.casual_leaves_taken += days
        if current_user.slack_user_id:
            date_str = str(new_leave.start_date) if new_leave.start_date == new_leave.end_date else f"{new_leave.start_date} → {new_leave.end_date}"
            type_label = str(leave.leave_type).capitalize()
            day_word = "day" if days == 1 else "days"
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} auto-approved.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":white_check_mark: *Leave #{new_leave.id} auto-approved & logged.*\n"
                            f"_{type_label} · {date_str} · {days} working {day_word}._"}}])
    else:
        days = count_weekdays(new_leave.start_date, new_leave.end_date)
        day_word = "day" if days == 1 else "days"
        date_str = str(new_leave.start_date) if new_leave.start_date == new_leave.end_date else f"{new_leave.start_date} → {new_leave.end_date}"
        l1 = current_user.manager
        l2 = l1.manager if l1 else None
        if current_user.slack_user_id:
            l1_name = l1.name if l1 else "(manager)"
            awaiting = f"*{l1_name}*" + (f", then *{l2.name}*." if l2 else ".")
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} submitted.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":hourglass_flowing_sand: *Leave #{new_leave.id} submitted* — {leave.leave_type} · {date_str} · {days} working {day_word}.\n"
                            f"Awaiting approval from {awaiting}"}}])
        if l1 and l1.slack_user_id:
            step = "Single approval" if not l1.manager_id else "Step 1 of 2"
            msg = slack.dm(l1.slack_user_id, **slack.approver_payload(new_leave, current_user, step, days))
            if msg:
                new_leave.slack_l1_channel = msg["channel"]
                new_leave.slack_l1_ts = msg["ts"]
    db.commit()
    db.refresh(new_leave)
    return new_leave


@router.patch("/{leave_id}/approve", response_model=LeaveResponse)
def approve_leave(leave_id: int, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    leave = db.query(Leave).where(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    user = leave.user
    is_direct_manager = user.manager_id == current_user.id
    is_skip_manager = bool(user.manager and user.manager.manager_id == current_user.id)

    was_fully_approved = leave.approved_by_l1 == True and leave.approved_by_l2 == True

    if is_direct_manager:
        if leave.approved_by_l1 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l1 = True
        # When the direct manager has no L2 above them (e.g. an L2 lead managing ICs directly),
        # there is no separate skip-level approval step — approve both fields in one action.
        if not user.manager or not user.manager.manager_id:
            leave.approved_by_l2 = True
    elif is_skip_manager:
        if leave.approved_by_l2 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l2 = True
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your leave request to approve")

    is_fully_approved = leave.approved_by_l1 == True and leave.approved_by_l2 == True
    if not was_fully_approved and is_fully_approved:
        days = count_weekdays(leave.start_date, leave.end_date)
        if leave.leave_type == LeaveType.sick:
            user.sick_leaves_taken += days
        elif leave.leave_type == LeaveType.casual:
            user.casual_leaves_taken += days

    # --- Slack ---
    days = count_weekdays(leave.start_date, leave.end_date)
    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"
    type_label = str(leave.leave_type).capitalize()

    if is_direct_manager:
        slack.delete_msg(leave.slack_l1_channel, leave.slack_l1_ts)
        leave.slack_l1_channel = None
        leave.slack_l1_ts = None
        if is_fully_approved:
            if user.slack_user_id:
                slack.dm(user.slack_user_id,
                    text=f"Leave #{leave.id} approved!",
                    blocks=[{"type": "section", "text": {"type": "mrkdwn",
                        "text": f":tada: *Leave #{leave.id} fully approved!*\n_{type_label} · {date_str} · {days} working day(s)._"}}])
        else:
            l2 = user.manager.manager if user.manager else None
            if user.slack_user_id:
                l2_name = l2.name if l2 else "your manager"
                slack.dm(user.slack_user_id,
                    text=f"Leave #{leave.id} update",
                    blocks=[{"type": "section", "text": {"type": "mrkdwn",
                        "text": f":arrow_forward: *Leave #{leave.id}* — {current_user.name} approved. Now awaiting *{l2_name}*."}}])
            if l2 and l2.slack_user_id:
                msg = slack.dm(l2.slack_user_id, **slack.approver_payload(leave, user, "Step 2 of 2", days))
                if msg:
                    leave.slack_l2_channel = msg["channel"]
                    leave.slack_l2_ts = msg["ts"]
    elif is_skip_manager:
        slack.delete_msg(leave.slack_l2_channel, leave.slack_l2_ts)
        leave.slack_l2_channel = None
        leave.slack_l2_ts = None
        if user.slack_user_id:
            slack.dm(user.slack_user_id,
                text=f"Leave #{leave.id} approved!",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":tada: *Leave #{leave.id} fully approved!*\n_{type_label} · {date_str} · {days} working day(s)._"}}])

    db.commit()
    db.refresh(leave)
    return leave


@router.patch("/{leave_id}/reject", response_model=LeaveResponse)
def reject_leave(leave_id: int, body: LeaveRejectRequest, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    leave = db.query(Leave).where(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    user = leave.user
    is_direct_manager = user.manager_id == current_user.id
    is_skip_manager = bool(user.manager and user.manager.manager_id == current_user.id)

    if is_direct_manager:
        if leave.approved_by_l1 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l1 = False
    elif is_skip_manager:
        if leave.approved_by_l2 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l2 = False
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your leave request to reject")

    leave.rejection_note = body.reason

    # --- Slack ---
    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"
    type_label = str(leave.leave_type).capitalize()

    if is_direct_manager:
        slack.delete_msg(leave.slack_l1_channel, leave.slack_l1_ts)
        leave.slack_l1_channel = None
        leave.slack_l1_ts = None
    else:
        slack.delete_msg(leave.slack_l2_channel, leave.slack_l2_ts)
        leave.slack_l2_channel = None
        leave.slack_l2_ts = None

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

    if leave.start_date <= datetime.now().date():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete a leave that has already started or passed")

    fully_approved = leave.approved_by_l1 is True and leave.approved_by_l2 is True
    if fully_approved:
        days = count_weekdays(leave.start_date, leave.end_date)
        if leave.leave_type == LeaveType.sick:
            current_user.sick_leaves_taken -= days
        elif leave.leave_type == LeaveType.casual:
            current_user.casual_leaves_taken -= days

    db.delete(leave)
    db.commit()
