from typing import Annotated
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.security import get_current_user
from db.database import get_db

from schemas.catchups import CatchupCreate, CatchupResponse
from models.catchups import Catchup
from models.users import User

router = APIRouter(prefix="/catchups", tags=["catchups"])


@router.get("/me", response_model=dict[str, list[CatchupResponse]])
def get_my_catchups(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    now = datetime.now()

    upcoming = db.query(Catchup).where(
        Catchup.employee_id == current_user.id,
        Catchup.date_and_time >= now,
    ).all()

    previous = db.query(Catchup).where(
        Catchup.employee_id == current_user.id,
        Catchup.date_and_time < now,
    ).all()

    return {"upcoming": upcoming, "previous": previous}


@router.get("/manager/me", response_model=dict[str, list[CatchupResponse]])
def get_my_catchups_as_manager(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    now = datetime.now()

    upcoming = db.query(Catchup).where(
        (Catchup.manager_id == current_user.id) | (Catchup.alternate_manager_id == current_user.id),
        Catchup.date_and_time >= now,
    ).all()

    previous = db.query(Catchup).where(
        (Catchup.manager_id == current_user.id) | (Catchup.alternate_manager_id == current_user.id),
        Catchup.date_and_time < now,
    ).all()

    return {"upcoming": upcoming, "previous": previous}


@router.post("", response_model=CatchupResponse)
def create_catchup(catchup: CatchupCreate, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    employee = db.query(User).filter(User.id == catchup.employee_id).first()
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    is_direct_manager = current_user.id == employee.manager_id
    is_skip_manager = bool(employee.manager and current_user.id == employee.manager.manager_id)

    if not (is_direct_manager or is_skip_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only create catchups for your employees.")

    # The other manager in the chain becomes the alternate (may be None if no L2 above direct manager)
    alternate_manager_id = (employee.manager.manager_id if is_direct_manager else employee.manager_id)

    new_catchup = Catchup(
        manager_id=current_user.id,
        alternate_manager_id=alternate_manager_id,
        employee_id=catchup.employee_id,
        notes_doc_link="dummy_link",
        meeting_link="dummy_link",
        date_and_time=catchup.date_and_time,
    )

    db.add(new_catchup)
    db.commit()
    db.refresh(new_catchup)
    return new_catchup
