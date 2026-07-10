from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.security import get_current_user
from core.status_history import status_history
from core.time import now_ist
from db.database import get_db
from models.status_events import StatusEvent
from models.users import User
from schemas.status_events import StatusDayResponse
from schemas.users import UserResponse, UserStatusUpdate

router = APIRouter(prefix="/users", tags=["users"])

ETA_FIELDS = ("late_arrive_eta", "early_exit_eta", "stepping_out_from", "stepping_out_to")


@router.get("", response_model=list[UserResponse])
def get_all_users(current_user: Annotated[User, Depends(get_current_user)],db: Annotated[Session, Depends(get_db)],):
    return db.query(User).all()


@router.patch("/me/status", response_model=UserResponse)
def update_status(
    payload: UserStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No status fields were provided.")

    if "office_status" in data and data["office_status"] is None:
        raise HTTPException(status_code=400, detail="office_status cannot be cleared.")

    # An ETA describes a status, so there must be one — either arriving in this
    # request or already set. Without it the day's first event would not be a
    # clock-in, and the log could not answer when someone actually showed up.
    resulting_status = data.get("office_status", current_user.office_status)
    if any(f in data for f in ETA_FIELDS) and resulting_status is None:
        raise HTTPException(
            status_code=400,
            detail="Set an office status before setting an arrival or exit time.",
        )

    for field, value in data.items():
        setattr(current_user, field, value)

    occurred_at = now_ist()
    db.add(StatusEvent(
        user_id=current_user.id,
        occurred_at=occurred_at,
        business_date=occurred_at.date(),
        office_status=current_user.office_status,
        late_arrive_eta=current_user.late_arrive_eta,
        early_exit_eta=current_user.early_exit_eta,
        stepping_out_from=current_user.stepping_out_from,
        stepping_out_to=current_user.stepping_out_to,
    ))

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/{user_id}/status-history", response_model=list[StatusDayResponse])
def get_status_history(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
):
    """Status history for any user, newest day first.

    Readable by every authenticated user. That is deliberate for now — current
    status is already visible to everyone on the dashboard — but history invites
    inference that a live snapshot does not, so this is the guard to tighten if
    it ever needs to become manager-or-admin only.
    """
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found.")

    return status_history(db, user_id, days)
