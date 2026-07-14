from typing import Annotated
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from schemas.slack_bot import (
    BotUserResponse, BotManagerInfo,
    BotLeaveCreate, BotApproveRequest, BotRejectRequest, BotSetMessageRequest,
)
from schemas.leaves import LeaveResponse
from models.leaves import Leave, LeaveApproval, LeaveType, LeaveStatus, ApprovalStatus
from models.users import User
from core.config import settings
from db.database import get_db
from routes.leaves import (
    count_weekdays, add_working_days, ensure_working_days,
    get_or_create_balance, enforce_leave_limit,
)
from core.leave_policy import evaluate as evaluate_policy

router = APIRouter(prefix="/bot", tags=["slack-bot"])


def verify_bot_key(x_internal_key: Annotated[str, Header()]):
    if not settings.INTERNAL_API_KEY or x_internal_key != settings.INTERNAL_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal key")


def _manager_info(user: User | None) -> BotManagerInfo | None:
    if not user:
        return None
    return BotManagerInfo(id=user.id, name=user.name, role=user.role, slack_user_id=user.slack_user_id)


def _bot_user_response(user: User) -> BotUserResponse:
    l1 = user.manager
    l2 = l1.manager if l1 else None
    return BotUserResponse(
        id=user.id,
        name=user.name,
        role=user.role,
        role_level=user.role_level,
        slack_user_id=user.slack_user_id,
        l1_manager=_manager_info(l1),
        l2_manager=_manager_info(l2),
    )


@router.get("/user/{slack_user_id}", response_model=BotUserResponse)
def get_user_by_slack_id(
    slack_user_id: str,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    user = db.query(User).filter(User.slack_user_id == slack_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user with that Slack ID")
    return _bot_user_response(user)


@router.post("/leaves", response_model=LeaveResponse)
def create_leave_for_user(
    body: BotLeaveCreate,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    user = db.query(User).filter(User.slack_user_id == body.slack_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user with that Slack ID")

    try:
        start = date.fromisoformat(body.start_date)
        end = date.fromisoformat(body.end_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date format, expected YYYY-MM-DD")

    if end < start:
        raise HTTPException(status_code=422, detail="end_date cannot be before start_date")

    days = ensure_working_days(start, end)

    today = date.today()
    now = datetime.now()

    unconstrained = user.is_admin or user.manager is None

    decision = evaluate_policy(
        body.leave_type,
        start,
        days,
        now,
        today,
        unconstrained=unconstrained,
        is_exception=False,  # the bot has no exception path
    )
    if decision.error:
        raise HTTPException(status_code=422, detail=decision.error)
    auto_approve = decision.auto_approve or unconstrained

    if not user.is_admin:
        enforce_leave_limit(db, user.id, body.leave_type, days, start.year)

    manager = user.manager
    skip = manager.manager if manager else None

    leave = Leave(
        user_id=user.id,
        leave_type=body.leave_type,
        note=body.note,
        start_date=start,
        end_date=end,
        status=LeaveStatus.approved if auto_approve else LeaveStatus.pending,
    )
    db.add(leave)
    db.flush()

    if not auto_approve:
        db.add(LeaveApproval(leave_id=leave.id, approver_id=manager.id, step=1))
        if skip:
            db.add(LeaveApproval(leave_id=leave.id, approver_id=skip.id, step=2))

    if auto_approve:
        year = start.year
        bal = get_or_create_balance(db, user.id, body.leave_type, year)
        bal.days_taken += days

    db.commit()
    db.refresh(leave)
    return leave


@router.get("/leaves/{leave_id}", response_model=LeaveResponse)
def get_leave(
    leave_id: int,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    return leave


@router.patch("/leaves/{leave_id}/approve", response_model=LeaveResponse)
def approve_leave(
    leave_id: int,
    body: BotApproveRequest,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")

    approver = db.query(User).filter(User.slack_user_id == body.slack_user_id).first()
    if not approver:
        raise HTTPException(status_code=404, detail="Approver not found — set their Slack ID in the HRMS tool")

    approval_step = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .order_by(LeaveApproval.step)
        .first()
    )

    if not approval_step:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Leave is already fully approved or rejected")
    if approval_step.approver_id != approver.id:
        raise HTTPException(status_code=403, detail="Not your leave to approve")

    approval_step.status = ApprovalStatus.approved
    approval_step.decided_at = datetime.utcnow()
    db.flush()

    remaining = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .count()
    )
    if remaining == 0:
        leave.status = LeaveStatus.approved
        days = count_weekdays(leave.start_date, leave.end_date)
        year = leave.start_date.year
        bal = get_or_create_balance(db, leave.user_id, leave.leave_type, year)
        bal.days_taken += days

    db.commit()
    db.refresh(leave)
    return leave


@router.patch("/leaves/{leave_id}/reject", response_model=LeaveResponse)
def reject_leave(
    leave_id: int,
    body: BotRejectRequest,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")

    approver = db.query(User).filter(User.slack_user_id == body.slack_user_id).first()
    if not approver:
        raise HTTPException(status_code=404, detail="Approver not found — set their Slack ID in the HRMS tool")

    approval_step = (
        db.query(LeaveApproval)
        .where(LeaveApproval.leave_id == leave_id, LeaveApproval.status == ApprovalStatus.pending)
        .order_by(LeaveApproval.step)
        .first()
    )

    if not approval_step:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Leave is already fully approved or rejected")
    if approval_step.approver_id != approver.id:
        raise HTTPException(status_code=403, detail="Not your leave to reject")

    approval_step.status = ApprovalStatus.rejected
    approval_step.decided_at = datetime.utcnow()
    approval_step.rejection_note = body.reason or ""
    leave.status = LeaveStatus.rejected

    db.commit()
    db.refresh(leave)
    return leave


@router.get("/team-availability")
def get_team_availability(
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    today = date.today()

    on_leave_records = db.query(Leave).filter(
        Leave.start_date <= today,
        Leave.end_date >= today,
        Leave.status == LeaveStatus.approved,
    ).all()

    on_leave_user_ids = {l.user_id for l in on_leave_records}

    on_leave = [
        {
            "name": l.user.name,
            "leave_type": str(l.leave_type).replace("_", " ").title(),
            "end_date": str(l.end_date),
        }
        for l in on_leave_records
    ]

    all_users = db.query(User).order_by(User.name).all()
    available = [
        {
            "name": u.name,
            "status": "WFH" if u.office_status == "WFH" else ("In Office" if u.office_status == "IN" else "Out of Office"),
        }
        for u in all_users if u.id not in on_leave_user_ids
    ]

    return {"on_leave": on_leave, "available": available}


@router.patch("/leave-approvals/{approval_id}/message")
def set_approval_message(
    approval_id: int,
    body: BotSetMessageRequest,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    approval = db.query(LeaveApproval).filter(LeaveApproval.id == approval_id).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval step not found")
    approval.slack_channel = body.channel
    approval.slack_ts = body.ts
    db.commit()
    return {"ok": True}
