from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.security import get_current_user
from core.holidays import HOLIDAYS, _persist_and_reload
from core.leave_limits import LEAVE_LIMITS, persist_leave_limits
from db.database import get_db
from models.users import User, RoleLevel
from schemas.users import UserResponse

router = APIRouter(prefix="/admin", tags=["admin"])


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


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    role_level: Optional[RoleLevel] = None
    manager_id: Optional[int] = None
    slack_user_id: Optional[str] = None
    is_admin: Optional[bool] = None


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    update: UserUpdate,
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
            _check_no_cycle(user_id, new_manager_id, db)
        user.manager_id = new_manager_id

    for field in ("name", "role", "role_level", "slack_user_id", "is_admin"):
        if field in update.model_fields_set:
            setattr(user, field, getattr(update, field))

    db.commit()
    db.refresh(user)
    return user


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
    sick: Optional[int] = None
    casual: Optional[int] = None


@router.put("/leaves/limits")
def update_limits(
    body: LeaveLimitsUpdate,
    _: Annotated[User, Depends(require_admin)],
):
    if body.sick is not None:
        LEAVE_LIMITS["sick"] = body.sick
    if body.casual is not None:
        LEAVE_LIMITS["casual"] = body.casual
    persist_leave_limits()
    return LEAVE_LIMITS


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
