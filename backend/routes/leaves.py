from typing import Annotated
from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, and_
from sqlalchemy.orm import Session
from schemas.leaves import LeaveCreate, LeaveUpdate, LeaveResponse, LeaveRejectRequest, LeaveBalanceEntry, LeaveSummaryResponse
from models.leaves import Leave, LeaveApproval, LeaveBalance, LeaveType, LeaveStatus, ApprovalStatus, SPECIAL_LEAVE_TYPES
from models.users import User, RoleLevel
from core.security import get_current_user
from core.holidays import HOLIDAYS, HOLIDAY_DATES
from core.leave_limits import LEAVE_LIMITS, LEAVE_RULES, get_earned_notice_days
from core.workdays import count_weekdays
from core import slack
from db.database import get_db

router = APIRouter(prefix="/leaves", tags=["leaves"])


# ─── Date helpers ─────────────────────────────────────────────────────────────

def ensure_working_days(start: date, end: date) -> int:
    """Return the leave's working-day count, rejecting leaves that contain none.

    Balances only ever count working days, so a leave made entirely of weekends
    and holidays would deduct nothing while still routing an approval request
    to the user's managers.
    """
    days = count_weekdays(start, end)
    if days == 0:
        raise HTTPException(
            status_code=422,
            detail="Leave must include at least one working day. Weekends and company holidays don't count.",
        )
    return days


def add_working_days(from_date: date, days: int) -> date:
    """Return the date that is `days` working days after from_date."""
    current = from_date
    count = 0
    while count < days:
        current += timedelta(days=1)
        if current.weekday() < 5 and current not in HOLIDAY_DATES:
            count += 1
    return current


def earliest_earned_start(today: date, notice_days: int) -> date:
    """Return the earliest calendar date that satisfies the notice requirement."""
    return today + timedelta(days=notice_days)


# ─── Balance helpers ───────────────────────────────────────────────────────────

def get_or_create_balance(db: Session, user_id: int, leave_type: LeaveType, year: int) -> LeaveBalance:
    bal = db.query(LeaveBalance).filter_by(user_id=user_id, leave_type=leave_type, year=year).first()
    if bal is None:
        bal = LeaveBalance(user_id=user_id, leave_type=leave_type, year=year, days_taken=0)
        db.add(bal)
        db.flush()
    return bal


def get_days_taken(db: Session, user_id: int, leave_type: LeaveType, year: int) -> int:
    bal = db.query(LeaveBalance).filter_by(user_id=user_id, leave_type=leave_type, year=year).first()
    return bal.days_taken if bal else 0


# ─── Limit helpers ─────────────────────────────────────────────────────────────

def exceeds_limit(leave_type: LeaveType, taken: int, days: int) -> bool:
    """True if `days` more working days would push `taken` past the annual limit.

    The single definition of "over limit". A null limit (LWP) never exceeds, and
    landing exactly on the limit is allowed.
    """
    limit = LEAVE_LIMITS.get(str(leave_type))
    return limit is not None and (taken + days) > limit


def would_exceed_limit(db: Session, user_id: int, leave_type: LeaveType, days: int, year: int) -> bool:
    return exceeds_limit(leave_type, get_days_taken(db, user_id, leave_type, year), days)


def enforce_leave_limit(db: Session, user_id: int, leave_type: LeaveType, days: int, year: int) -> None:
    """Reject a leave that would take the user past their annual allowance.

    Callers are responsible for exempting admins — the rule is the same for
    everyone else, including users with no manager and exception requests.
    """
    taken = get_days_taken(db, user_id, leave_type, year)
    if not exceeds_limit(leave_type, taken, days):
        return

    limit = LEAVE_LIMITS[str(leave_type)]
    remaining = max(0, limit - taken)
    label = str(leave_type).replace("_", " ").title()
    day_word = "day" if days == 1 else "days"
    raise HTTPException(
        status_code=422,
        detail=(
            f"{label} leave limit exceeded: this request is {days} working {day_word}, "
            f"but you have only {remaining} of {limit} days remaining for {year}."
        ),
    )


# ─── Info endpoints ────────────────────────────────────────────────────────────

@router.get("/holidays")
def get_holidays():
    return HOLIDAYS


@router.get("/limits")
def get_leave_limits():
    return LEAVE_LIMITS


@router.get("/rules")
def get_leave_rules():
    return LEAVE_RULES


# ─── My balances ──────────────────────────────────────────────────────────────

def compute_balances(db: Session, user_id: int, year: int) -> dict[str, LeaveBalanceEntry]:
    rows = (
        db.query(LeaveBalance.leave_type, LeaveBalance.days_taken)
        .filter_by(user_id=user_id, year=year)
        .all()
    )
    taken_by_type = {str(lt): days for lt, days in rows}

    result = {}
    for lt in LeaveType:
        taken = taken_by_type.get(str(lt), 0)
        limit = LEAVE_LIMITS.get(str(lt))
        remaining = (limit - taken) if limit is not None else None
        result[str(lt)] = LeaveBalanceEntry(taken=taken, limit=limit, remaining=remaining)
    return result


@router.get("/me/balances")
def get_my_balances(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, LeaveBalanceEntry]:
    return compute_balances(db, current_user.id, datetime.now().year)


# Must stay below /me/balances: declared first, "me" would be coerced into
# user_id and 422.
@router.get("/{user_id}/balances")
def get_user_balances(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, LeaveBalanceEntry]:
    if not db.get(User, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return compute_balances(db, user_id, datetime.now().year)


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


# Must stay below /me/... for the same reason as /{user_id}/balances above.
@router.get("/{user_id}/summary", response_model=LeaveSummaryResponse)
def get_user_leave_summary(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=365)] = 28,
):
    """Upcoming leaves, and the leave days falling inside the last `days` days.

    A check-in log needs both: a past day is either a status the person set, or a
    leave they took, and only the leave explains an otherwise empty square.
    Pending leaves are excluded — they have not been granted, so they are not
    upcoming, and they never coloured a past day.
    """
    if not db.get(User, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    today = datetime.now().date()
    window_start = today - timedelta(days=days - 1)

    upcoming = (
        db.query(Leave)
        .where(
            Leave.user_id == user_id,
            Leave.status == LeaveStatus.approved,
            Leave.start_date >= today,
        )
        .order_by(Leave.start_date)
        .all()
    )

    # Any approved leave that overlaps the window at all, clipped to it.
    overlapping = db.query(Leave).where(
        Leave.user_id == user_id,
        Leave.status == LeaveStatus.approved,
        Leave.start_date <= today,
        Leave.end_date >= window_start,
    ).all()

    leave_dates = sorted({
        day
        for leave in overlapping
        for day in days_between(max(leave.start_date, window_start), min(leave.end_date, today))
    })

    return LeaveSummaryResponse(upcoming=upcoming, leave_dates=leave_dates)


# ─── Current / upcoming leaves (dashboard) ────────────────────────────────────

@router.get("", response_model=dict[str, list[LeaveResponse]])
def get_current_leaves(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
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


# ─── My leaves ────────────────────────────────────────────────────────────────

@router.get("/me", response_model=dict[str, list[LeaveResponse]])
def get_my_leaves(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
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


# ─── Team leaves (whole org, managers only) ───────────────────────────────────

@router.get("/team", response_model=dict[str, list[LeaveResponse]])
def get_team_leaves(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if current_user.role_level == RoleLevel.ic:
        raise HTTPException(status_code=403, detail="Managers only")

    today = datetime.now().date()
    year = today.year

    pending = db.query(Leave).where(
        Leave.status == LeaveStatus.pending,
        Leave.start_date >= today,
    ).all()

    upcoming = db.query(Leave).where(
        Leave.status == LeaveStatus.approved,
        Leave.start_date >= today,
    ).all()

    rejected = db.query(Leave).where(
        Leave.status == LeaveStatus.rejected,
        Leave.start_date >= today,
    ).all()

    previous = db.query(Leave).where(
        Leave.status == LeaveStatus.approved,
        Leave.end_date < today,
    ).all()

    balance_cache: dict[int, dict[str, LeaveBalanceEntry]] = {}

    def enrich(leaves: list[Leave]) -> list[LeaveResponse]:
        out = []
        for leave in leaves:
            r = LeaveResponse.model_validate(leave)
            if leave.user_id not in balance_cache:
                balance_cache[leave.user_id] = compute_balances(db, leave.user_id, year)
            r.user_balances = balance_cache[leave.user_id]
            days = count_weekdays(leave.start_date, leave.end_date)
            entry = r.user_balances.get(str(leave.leave_type))
            taken = entry.taken if entry else 0
            r.over_limit = exceeds_limit(leave.leave_type, taken, days)
            out.append(r)
        return out

    return {
        "pending":  enrich(pending),
        "upcoming": enrich(upcoming),
        "rejected": enrich(rejected),
        "previous": enrich(previous),
    }


# ─── Manager view ─────────────────────────────────────────────────────────────

@router.get("/manager/me", response_model=list[LeaveResponse])
def get_my_leaves_as_manager(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    today = datetime.now().date()

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
        year = leave.start_date.year
        days = count_weekdays(leave.start_date, leave.end_date)
        r.over_limit = would_exceed_limit(db, leave.user_id, leave.leave_type, days, year)
        r.user_balances = compute_balances(db, leave.user_id, year)
        return r

    return [with_over_limit(l) for l in pending_leaves]


# ─── Create leave ─────────────────────────────────────────────────────────────

@router.post("", response_model=LeaveResponse)
def create_leave(
    leave: LeaveCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    today = date.today()
    now = datetime.now()
    effective_end = leave.end_date or leave.start_date
    is_admin = current_user.is_admin
    # Users with no manager (L2 leads) auto-approve their own leaves, so no policy
    # constraints (notice period, cutoffs, exceptions) apply to them.
    unconstrained = is_admin or current_user.manager is None

    if not is_admin and (not leave.note or not leave.note.strip()):
        raise HTTPException(status_code=422, detail="Note is required.")

    if effective_end < leave.start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before start date.")

    # Applies to every leave type, and to unconstrained users too: an empty
    # leave is meaningless regardless of who requests it.
    days = ensure_working_days(leave.start_date, effective_end)

    # ── Sick & Casual ──────────────────────────────────────────────────────────
    if leave.leave_type == LeaveType.sick_and_casual:
        cutoff_hour = LEAVE_RULES.get("sick_and_casual_cutoff_hour", 10)
        cutoff_min = LEAVE_RULES.get("sick_and_casual_cutoff_min", 0)
        is_today = (leave.start_date == today and effective_end == today)
        before_cutoff = (now.hour * 60 + now.minute) < (cutoff_hour * 60 + cutoff_min)
        auto_approve = is_admin or (is_today and before_cutoff)

    # ── Earned ────────────────────────────────────────────────────────────────
    elif leave.leave_type == LeaveType.earned:
        if not unconstrained and not leave.is_exception:
            duration = days
            notice_rules = LEAVE_RULES.get("earned_advance_notice", [])
            required_notice = get_earned_notice_days(duration, notice_rules)
            calendar_days_ahead = (leave.start_date - today).days
            if calendar_days_ahead < required_notice:
                earliest = today + timedelta(days=required_notice)
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Earned leave ({duration} working day{'s' if duration != 1 else ''}) requires "
                        f"{required_notice} calendar days notice. Earliest start: {earliest}."
                    ),
                )
        auto_approve = False

    # ── Special types ─────────────────────────────────────────────────────────
    else:
        auto_approve = False

    # ── Overlap check ─────────────────────────────────────────────────────────
    overlap = db.query(Leave).filter(
        Leave.user_id == current_user.id,
        Leave.start_date <= effective_end,
        Leave.end_date >= leave.start_date,
        Leave.status != LeaveStatus.rejected,
    ).first()
    if not unconstrained and overlap:
        raise HTTPException(
            status_code=422,
            detail=f"You already have a leave request covering that period ({overlap.start_date} – {overlap.end_date}).",
        )

    # ── Limit check ───────────────────────────────────────────────────────────
    # Admins may record over-limit leave; everyone else is hard-blocked, including
    # users with no manager and exception requests.
    year = leave.start_date.year
    if not is_admin:
        enforce_leave_limit(db, current_user.id, leave.leave_type, days, year)
    over_limit = would_exceed_limit(db, current_user.id, leave.leave_type, days, year)

    # ── Build approval chain ──────────────────────────────────────────────────
    manager = current_user.manager
    skip = manager.manager if manager else None

    if not manager:
        auto_approve = True  # no manager = auto-approve regardless of type

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

    approval_rows: list[LeaveApproval] = []
    if not auto_approve:
        if leave.is_exception and skip:
            # Exception → only skip manager approves
            approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=skip.id, step=2))
        else:
            # Normal: direct manager first
            approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=manager.id, step=1))
            if skip and not leave.is_exception:
                approval_rows.append(LeaveApproval(leave_id=new_leave.id, approver_id=skip.id, step=2))

    for ar in approval_rows:
        db.add(ar)
    db.flush()

    # ── Update balance if auto-approved ───────────────────────────────────────
    if auto_approve:
        bal = get_or_create_balance(db, current_user.id, leave.leave_type, year)
        bal.days_taken += days

    # ── Slack notifications ───────────────────────────────────────────────────
    date_str = (
        str(new_leave.start_date)
        if new_leave.start_date == new_leave.end_date
        else f"{new_leave.start_date} → {new_leave.end_date}"
    )
    type_label = str(leave.leave_type).replace("_", " ").title()
    day_word = "day" if days == 1 else "days"

    if auto_approve:
        if current_user.slack_user_id:
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} auto-approved.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":white_check_mark: *Leave #{new_leave.id} auto-approved & logged.*\n"
                            f"_{type_label} · {date_str} · {days} working {day_word}._"}}])
    elif leave.is_exception and skip:
        step2_row = approval_rows[0]
        if current_user.slack_user_id:
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} submitted as exception.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":hourglass_flowing_sand: *Leave #{new_leave.id} submitted as an exception* — "
                            f"{type_label} · {date_str} · {days} working {day_word}.\n"
                            f"Awaiting approval from *{skip.name}* (notice rules waived)."}}])
        if skip.slack_user_id:
            msg = slack.dm(skip.slack_user_id, **slack.approver_payload(new_leave, current_user, "Exception — direct approval", days, over_limit))
            if msg:
                step2_row.slack_channel = msg["channel"]
                step2_row.slack_ts = msg["ts"]
    else:
        step1_row = approval_rows[0]
        if current_user.slack_user_id:
            awaiting = f"*{manager.name}*" + (f", then *{skip.name}*." if skip else ".")
            slack.dm(current_user.slack_user_id,
                text=f"Leave #{new_leave.id} submitted.",
                blocks=[{"type": "section", "text": {"type": "mrkdwn",
                    "text": f":hourglass_flowing_sand: *Leave #{new_leave.id} submitted* — "
                            f"{type_label} · {date_str} · {days} working {day_word}.\n"
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


# ─── Approve leave ────────────────────────────────────────────────────────────

@router.patch("/{leave_id}/approve", response_model=LeaveResponse)
def approve_leave(
    leave_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your leave request to approve")

    approval_step.status = ApprovalStatus.approved
    approval_step.decided_at = datetime.utcnow()
    db.flush()

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
        year = leave.start_date.year
        bal = get_or_create_balance(db, user.id, leave.leave_type, year)
        bal.days_taken += days

    date_str = str(leave.start_date) if leave.start_date == leave.end_date else f"{leave.start_date} → {leave.end_date}"
    type_label = str(leave.leave_type).replace("_", " ").title()

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


# ─── Reject leave ─────────────────────────────────────────────────────────────

@router.patch("/{leave_id}/reject", response_model=LeaveResponse)
def reject_leave(
    leave_id: int,
    body: LeaveRejectRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
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
    type_label = str(leave.leave_type).replace("_", " ").title()

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


# ─── Delete / withdraw leave ──────────────────────────────────────────────────

@router.put("/{leave_id}", response_model=LeaveResponse)
def update_leave(
    leave_id: int,
    body: LeaveUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    leave = db.query(Leave).filter(Leave.id == leave_id, Leave.user_id == current_user.id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    if leave.status != LeaveStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending leaves can be edited")

    today = date.today()
    new_start = body.start_date or leave.start_date
    new_end = body.end_date or leave.end_date

    if new_end < new_start:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")

    # Runs whenever either date moves, not just the start date.
    duration = ensure_working_days(new_start, new_end)

    # Re-validate notice for earned leave if dates changed
    if leave.leave_type == LeaveType.earned and not leave.is_exception and body.start_date is not None:
        notice_rules = LEAVE_RULES.get("earned_advance_notice", [])
        required_notice = get_earned_notice_days(duration, notice_rules)
        if (new_start - today).days < required_notice:
            earliest = today + timedelta(days=required_notice)
            raise HTTPException(
                status_code=422,
                detail=f"Earned leave requires {required_notice} calendar days notice. Earliest start: {earliest}.",
            )

    # Overlap check excluding self
    overlap = db.query(Leave).filter(
        Leave.user_id == current_user.id,
        Leave.id != leave_id,
        Leave.start_date <= new_end,
        Leave.end_date >= new_start,
        Leave.status != LeaveStatus.rejected,
    ).first()
    if overlap:
        raise HTTPException(
            status_code=422,
            detail=f"Overlaps with another leave ({overlap.start_date} – {overlap.end_date})",
        )

    # The edited leave is pending, so its own days are not in days_taken yet and
    # must not be subtracted from the new duration.
    if not current_user.is_admin:
        enforce_leave_limit(db, current_user.id, leave.leave_type, duration, new_start.year)

    if body.note is not None:
        leave.note = body.note
    leave.start_date = new_start
    leave.end_date = new_end

    db.commit()
    db.refresh(leave)
    return leave


@router.delete("/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_leave(
    leave_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    leave = db.query(Leave).where(Leave.id == leave_id, Leave.user_id == current_user.id).first()
    if not leave:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found")

    if not current_user.is_admin and leave.start_date <= datetime.now().date():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete a leave that has already started or passed")

    if leave.status == LeaveStatus.approved:
        year = leave.start_date.year
        days = count_weekdays(leave.start_date, leave.end_date)
        bal = get_or_create_balance(db, current_user.id, leave.leave_type, year)
        bal.days_taken = max(0, bal.days_taken - days)

    pending_approvals = [a for a in leave.approvals if a.status == ApprovalStatus.pending]
    slack_msgs = [(a.slack_channel, a.slack_ts) for a in pending_approvals if a.slack_channel]
    approver_slack_ids = [a.approver.slack_user_id for a in pending_approvals if a.approver.slack_user_id]

    type_label = str(leave.leave_type).replace("_", " ").title()
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
