from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.balances import recompute_balances
from core.security import get_current_user
from core.holidays import HOLIDAYS, _persist_and_reload
from core.leave_limits import LEAVE_LIMITS, LEAVE_RULES, persist_leave_limits
from core.status_history import status_history
from db.database import get_db
from models.catchups import Catchup
from models.leaves import Leave, LeaveApproval
from models.users import User
from schemas.admin import (
    AdminCatchupCreate,
    AdminCatchupUpdate,
    AdminLeaveCreate,
    AdminLeaveUpdate,
    AdminUserCreate,
    AdminUserUpdate,
    UserOverviewResponse,
)
from schemas.users import UserResponse
from routes.leaves import compute_balances
from services.admin_users import delete_user_and_records

router = APIRouter(prefix="/admin", tags=["admin"])

# Admin writes are deliberately silent: no Slack pings, no Google Calendar
# invites, no Docs. An admin is correcting records, not starting a workflow, and
# nobody should be paged about a leave from last March.


def require_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


# ─── Users ────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
def get_all_users(
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(User).order_by(User.name).all()


@router.post("/users", response_model=UserResponse, status_code=201)
def create_user(
    body: AdminUserCreate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Create a user by hand.

    They have no Google refresh token until they sign in for the first time, so
    catchup documents and calendar invites will not work for them until then.
    """
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=409, detail="A user with that email already exists")

    if body.manager_id is not None and not db.get(User, body.manager_id):
        raise HTTPException(status_code=400, detail="Manager not found")

    user = User(**body.model_dump())
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    update: AdminUserUpdate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if "manager_id" in update.model_fields_set:
        new_manager_id = update.manager_id
        if new_manager_id is not None:
            if new_manager_id == user_id:
                raise HTTPException(status_code=400, detail="A user cannot be their own manager")
            if not db.get(User, new_manager_id):
                raise HTTPException(status_code=400, detail="Manager not found")
            _check_no_cycle(user_id, new_manager_id, db)
        user.manager_id = new_manager_id

    if "email" in update.model_fields_set:
        clash = db.query(User).filter(User.email == update.email, User.id != user_id).first()
        if clash:
            raise HTTPException(status_code=409, detail="A user with that email already exists")

    for field in ("email", "name", "role", "phone_number", "slack_user_id", "is_admin", "birthday", "joining_date"):
        if field in update.model_fields_set:
            setattr(user, field, getattr(update, field))

    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    current_user: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Delete a user and every record pointing at them. Irreversible."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    delete_user_and_records(db, user)


def _check_no_cycle(user_id: int, new_manager_id: int, db: Session) -> None:
    """Walk new_manager_id's ancestor chain; raise if user_id appears (cycle)."""
    current_id = new_manager_id
    visited: set[int] = set()
    while current_id is not None:
        if current_id in visited:
            break
        visited.add(current_id)
        if current_id == user_id:
            raise HTTPException(
                status_code=400,
                detail="This assignment would create a cycle in the hierarchy",
            )
        row = db.query(User.manager_id).filter(User.id == current_id).first()
        current_id = row[0] if row else None


# ─── Leave limits ─────────────────────────────────────────────────────────────

class LeaveLimitsUpdate(BaseModel):
    earned: Optional[int] = None
    sick_and_casual: Optional[int] = None
    bereavement: Optional[int] = None
    marriage: Optional[int] = None
    maternity: Optional[int] = None
    paternity: Optional[int] = None
    lwp: Optional[int] = None


@router.put("/leaves/limits")
def update_limits(
    body: LeaveLimitsUpdate,
    _: Annotated[User, Depends(require_admin)],
):
    for field in ("earned", "sick_and_casual", "bereavement", "marriage", "maternity", "paternity", "lwp"):
        val = getattr(body, field)
        if val is not None:
            LEAVE_LIMITS[field] = val
    persist_leave_limits()
    return LEAVE_LIMITS


# ─── Leave rules ──────────────────────────────────────────────────────────────

class NoticeRule(BaseModel):
    min: int
    max: Optional[int] = None
    notice: int

class LeaveRulesUpdate(BaseModel):
    earned_advance_notice: Optional[list[NoticeRule]] = None
    casual_advance_notice: Optional[list[NoticeRule]] = None
    sick_cutoff_hour: Optional[int] = None
    sick_cutoff_min: Optional[int] = None


@router.put("/leaves/rules")
def update_rules(
    body: LeaveRulesUpdate,
    _: Annotated[User, Depends(require_admin)],
):
    for ladder in ("earned_advance_notice", "casual_advance_notice"):
        rules = getattr(body, ladder)
        if rules is not None:
            LEAVE_RULES[ladder] = [r.model_dump(exclude_none=True) for r in rules]

    for field in ("sick_cutoff_hour", "sick_cutoff_min"):
        val = getattr(body, field)
        if val is not None:
            LEAVE_RULES[field] = val

    persist_leave_limits()
    return LEAVE_RULES


# ─── Holidays ─────────────────────────────────────────────────────────────────

class HolidayCreate(BaseModel):
    date: str
    name: str


class HolidayUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None


@router.post("/leaves/holidays", status_code=201)
def add_holiday(body: HolidayCreate, _: Annotated[User, Depends(require_admin)]):
    if any(h["date"] == body.date for h in HOLIDAYS):
        raise HTTPException(status_code=409, detail="A holiday already exists on that date")
    HOLIDAYS.append({"date": body.date, "name": body.name})
    _persist_and_reload()
    return HOLIDAYS


@router.put("/leaves/holidays/{holiday_date}")
def update_holiday(
    holiday_date: str,
    body: HolidayUpdate,
    _: Annotated[User, Depends(require_admin)],
):
    idx = next((i for i, h in enumerate(HOLIDAYS) if h["date"] == holiday_date), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Holiday not found")
    if body.date is not None and body.date != holiday_date:
        if any(h["date"] == body.date for i, h in enumerate(HOLIDAYS) if i != idx):
            raise HTTPException(status_code=409, detail="A holiday already exists on that date")
        HOLIDAYS[idx]["date"] = body.date
    if body.name is not None:
        HOLIDAYS[idx]["name"] = body.name
    _persist_and_reload()
    return HOLIDAYS


@router.delete("/leaves/holidays/{holiday_date}", status_code=204)
def delete_holiday(holiday_date: str, _: Annotated[User, Depends(require_admin)]):
    idx = next((i for i, h in enumerate(HOLIDAYS) if h["date"] == holiday_date), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Holiday not found")
    HOLIDAYS.pop(idx)
    _persist_and_reload()


# ─── One-shot user overview ───────────────────────────────────────────────────

@router.get("/users/{user_id}/overview", response_model=UserOverviewResponse)
def get_user_overview(
    user_id: int,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    status_days: Annotated[int, Query(ge=1, le=365)] = 90,
):
    """Everything about one person in a single request.

    `status_days` defaults to 90 so the page can offer both a one-month and a
    three-month view of the check-in log without a second round trip.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    leaves = (
        db.query(Leave)
        .filter(Leave.user_id == user_id)
        .order_by(Leave.start_date.desc())
        .all()
    )
    catchups = (
        db.query(Catchup)
        .filter(Catchup.employee_id == user_id)
        .order_by(Catchup.date_and_time.desc())
        .all()
    )

    return UserOverviewResponse(
        user=user,
        balances=compute_balances(db, user_id, datetime.now().year),
        leaves=leaves,
        catchups=catchups,
        status_days=status_history(db, user_id, status_days),
    )


# ─── Leaves ───────────────────────────────────────────────────────────────────
#
# No notice periods, no overlap checks, no limits, no approval chain. Balances
# are still recomputed from the leaves themselves, so "remaining" can go
# negative — an over-drawn balance is exactly what an admin needs to see.

def _require_leave(db: Session, leave_id: int) -> Leave:
    leave = db.get(Leave, leave_id)
    if not leave:
        raise HTTPException(status_code=404, detail="Leave not found")
    return leave


def _validate_dates(start, end) -> None:
    if end < start:
        raise HTTPException(status_code=422, detail="End date cannot be before start date")


@router.post("/users/{user_id}/leaves", status_code=201)
def create_leave_for_user(
    user_id: int,
    body: AdminLeaveCreate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    _validate_dates(body.start_date, body.end_date)

    leave = Leave(user_id=user_id, **body.model_dump())
    db.add(leave)
    db.flush()
    recompute_balances(db, user_id)
    db.commit()
    db.refresh(leave)
    return {"id": leave.id}


@router.put("/leaves/{leave_id}")
def update_leave_as_admin(
    leave_id: int,
    body: AdminLeaveUpdate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Edit any leave, at any age, in any status."""
    leave = _require_leave(db, leave_id)

    for field in ("leave_type", "start_date", "end_date", "note", "status", "is_exception"):
        if field in body.model_fields_set:
            setattr(leave, field, getattr(body, field))

    _validate_dates(leave.start_date, leave.end_date)

    db.flush()
    recompute_balances(db, leave.user_id)
    db.commit()
    return {"id": leave.id}


@router.delete("/leaves/{leave_id}", status_code=204)
def delete_leave_as_admin(
    leave_id: int,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    leave = _require_leave(db, leave_id)
    user_id = leave.user_id

    db.query(LeaveApproval).filter(LeaveApproval.leave_id == leave_id).delete(synchronize_session=False)
    db.delete(leave)
    db.flush()
    recompute_balances(db, user_id)
    db.commit()


# ─── Catchups ─────────────────────────────────────────────────────────────────
#
# Created straight in the database. No Google Doc, no calendar event: those are
# made with the manager's own credentials, which an admin acting on their behalf
# does not have. background_creation_finished is set so the UI does not wait for
# resources that will never arrive.

@router.post("/users/{user_id}/catchups", status_code=201)
def create_catchup_for_user(
    user_id: int,
    body: AdminCatchupCreate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    if not db.get(User, body.manager_id):
        raise HTTPException(status_code=400, detail="Manager not found")
    if body.alternate_manager_id is not None and not db.get(User, body.alternate_manager_id):
        raise HTTPException(status_code=400, detail="Alternate manager not found")

    catchup = Catchup(
        employee_id=user_id,
        background_creation_finished=True,
        **body.model_dump(),
    )
    db.add(catchup)
    db.commit()
    db.refresh(catchup)
    return {"id": catchup.id}


@router.patch("/catchups/{catchup_id}")
def update_catchup_as_admin(
    catchup_id: int,
    body: AdminCatchupUpdate,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    catchup = db.get(Catchup, catchup_id)
    if not catchup:
        raise HTTPException(status_code=404, detail="Catchup not found")

    for field in ("employee_id", "manager_id", "alternate_manager_id"):
        if field in body.model_fields_set:
            value = getattr(body, field)
            if value is not None and not db.get(User, value):
                raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').capitalize()} not found")

    for field in ("employee_id", "manager_id", "alternate_manager_id", "date_and_time",
                  "notes_doc_link", "meeting_link"):
        if field in body.model_fields_set:
            setattr(catchup, field, getattr(body, field))

    db.commit()
    return {"id": catchup.id}


@router.delete("/catchups/{catchup_id}", status_code=204)
def delete_catchup_as_admin(
    catchup_id: int,
    _: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Removes the row only. Any Google Calendar event it had stays behind."""
    catchup = db.get(Catchup, catchup_id)
    if not catchup:
        raise HTTPException(status_code=404, detail="Catchup not found")
    db.delete(catchup)
    db.commit()
