from typing import Annotated
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from schemas.slack_bot import (
    BotUserResponse, BotManagerInfo,
    BotLeaveCreate, BotApproveRequest, BotRejectRequest, BotSetMessageRequest,
)
from schemas.leaves import LeaveResponse
from models.leaves import Leave, LeaveType
from models.users import User
from core.config import settings
from db.database import get_db
from routes.leaves import count_weekdays

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
        sick_taken=user.sick_leaves_taken,
        casual_taken=user.casual_leaves_taken,
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

    today = date.today()
    if body.leave_type == LeaveType.sick:
        if start != today or end != today:
            raise HTTPException(status_code=422, detail="Sick leave can only be applied for today.")
    elif body.leave_type == LeaveType.casual:
        advance = (start - today).days
        is_multi = (end - start).days >= 1
        min_advance = 5 if is_multi else 1
        if advance < min_advance:
            label = "multi-day" if is_multi else "single-day"
            earliest = today + timedelta(days=min_advance)
            raise HTTPException(status_code=422,
                detail=f"Casual leave ({label}) needs {min_advance} day(s) advance notice. Earliest start: {earliest}.")

    auto_approve = body.leave_type == LeaveType.sick or not user.manager
    leave = Leave(
        user_id=user.id,
        leave_type=body.leave_type,
        note=body.note,
        start_date=start,
        end_date=end,
        approved_by_l1=True if auto_approve else None,
        approved_by_l2=True if auto_approve else None,
    )
    db.add(leave)
    if auto_approve:
        days = count_weekdays(start, end)
        if body.leave_type == LeaveType.sick:
            user.sick_leaves_taken += days
        elif body.leave_type == LeaveType.casual:
            user.casual_leaves_taken += days
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

    leave_user = leave.user
    is_direct_manager = leave_user.manager_id == approver.id
    is_skip_manager = bool(leave_user.manager and leave_user.manager.manager_id == approver.id)

    if not is_direct_manager and not is_skip_manager:
        raise HTTPException(status_code=403, detail="Not your leave to approve")

    was_fully_approved = leave.approved_by_l1 is True and leave.approved_by_l2 is True

    if is_direct_manager:
        if leave.approved_by_l1 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l1 = True
        if not leave_user.manager or not leave_user.manager.manager_id:
            leave.approved_by_l2 = True
    else:
        if leave.approved_by_l2 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l2 = True

    is_fully_approved = leave.approved_by_l1 is True and leave.approved_by_l2 is True
    if not was_fully_approved and is_fully_approved:
        days = count_weekdays(leave.start_date, leave.end_date)
        if leave.leave_type == LeaveType.sick:
            leave_user.sick_leaves_taken += days
        elif leave.leave_type == LeaveType.casual:
            leave_user.casual_leaves_taken += days

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

    leave_user = leave.user
    is_direct_manager = leave_user.manager_id == approver.id
    is_skip_manager = bool(leave_user.manager and leave_user.manager.manager_id == approver.id)

    if not is_direct_manager and not is_skip_manager:
        raise HTTPException(status_code=403, detail="Not your leave to reject")

    if is_direct_manager:
        if leave.approved_by_l1 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l1 = False
    else:
        if leave.approved_by_l2 is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You have already acted on this leave request")
        leave.approved_by_l2 = False

    leave.rejection_note = body.reason or ""
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
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).all()

    on_leave_user_ids = {l.user_id for l in on_leave_records}

    on_leave = [
        {
            "name": l.user.name,
            "leave_type": str(l.leave_type).capitalize(),
            "end_date": str(l.end_date),
        }
        for l in on_leave_records
    ]

    all_users = db.query(User).order_by(User.name).all()
    available = [
        {
            "name": u.name,
            "status": "WFH" if u.wfh else ("In Office" if u.in_office else "Out of Office"),
        }
        for u in all_users if u.id not in on_leave_user_ids
    ]

    return {"on_leave": on_leave, "available": available}


@router.patch("/leaves/{leave_id}/message")
def set_leave_message(
    leave_id: int,
    body: BotSetMessageRequest,
    db: Annotated[Session, Depends(get_db)],
    _=Depends(verify_bot_key),
):
    leave = db.query(Leave).filter(Leave.id == leave_id).first()
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    if body.level == "l1":
        leave.slack_l1_channel = body.channel
        leave.slack_l1_ts = body.ts
    elif body.level == "l2":
        leave.slack_l2_channel = body.channel
        leave.slack_l2_ts = body.ts
    db.commit()
    return {"ok": True}
