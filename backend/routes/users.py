from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.security import get_current_user
from db.database import get_db
from models.users import User
from schemas.users import UserResponse, UserStatusUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
def get_all_users(current_user: Annotated[User, Depends(get_current_user)],db: Annotated[Session, Depends(get_db)],):
    return db.query(User).all()


@router.patch("/me/status", response_model=UserResponse)
def update_status(
    payload: UserStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user