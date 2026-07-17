from typing import Annotated
from core.time import now_ist

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.security import get_current_user
from core.loaders import user_rel_chain
from db.database import get_db
from services.catchup_resources import create_catchup_resources, delete_catchup_resources, recreate_catchup_resources, update_catchup_calendar_time

from schemas.catchups import CatchupCreate, CatchupUpdate, CatchupResponse
from models.catchups import Catchup
from models.users import User, RoleLevel

router = APIRouter(prefix="/catchups", tags=["catchups"])


def _find_l2(employee: User, db: Session) -> User | None:
    """Walk up the manager chain from employee to find the L2 lead by role_level."""
    current = employee.manager
    while current:
        if current.role_level == RoleLevel.l2_lead:
            return current
        current = db.query(User).filter(User.id == current.manager_id).first() if current.manager_id else None
    return None


@router.get("/me", response_model=dict[str, list[CatchupResponse]])
def get_my_catchups(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    now = now_ist()

    catchups = db.query(Catchup).options(
        user_rel_chain(Catchup.employee),
        user_rel_chain(Catchup.manager),
        user_rel_chain(Catchup.alternate_manager),
    ).where(
        Catchup.employee_id == current_user.id,
    ).all()

    upcoming = [c for c in catchups if c.date_and_time >= now]
    previous = [c for c in catchups if c.date_and_time < now]

    return {"upcoming": upcoming, "previous": previous}


@router.get("/manager/me", response_model=dict[str, list[CatchupResponse]])
def get_my_catchups_as_manager(current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    now = now_ist()

    catchups = db.query(Catchup).options(
        user_rel_chain(Catchup.employee),
        user_rel_chain(Catchup.manager),
        user_rel_chain(Catchup.alternate_manager),
    ).where(
        (Catchup.manager_id == current_user.id) | (Catchup.alternate_manager_id == current_user.id),
    ).all()

    upcoming = [c for c in catchups if c.date_and_time >= now]
    previous = [c for c in catchups if c.date_and_time < now]

    return {"upcoming": upcoming, "previous": previous}


@router.post("", response_model=CatchupResponse)
def create_catchup(catchup: CatchupCreate, background_tasks: BackgroundTasks, current_user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    employee = db.query(User).filter(User.id == catchup.employee_id).first()
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    is_direct_manager = current_user.id == employee.manager_id
    is_skip_manager = bool(employee.manager and current_user.id == employee.manager.manager_id)

    if not (is_direct_manager or is_skip_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only create catchups for your employees.")

    # The other manager in the chain becomes the alternate (may be None if no L2 above direct manager)
    alternate_manager_id = (employee.manager.manager_id if is_direct_manager else employee.manager_id)
    alternate_manager = db.query(User).filter(User.id == alternate_manager_id).first() if alternate_manager_id else None

    new_catchup = Catchup(
        manager_id=current_user.id,
        alternate_manager_id=alternate_manager_id,
        employee_id=catchup.employee_id,
        notes_doc_link="",
        meeting_link="",
        date_and_time=catchup.date_and_time,
    )

    db.add(new_catchup)
    db.commit()
    db.refresh(new_catchup)

    # L2 owns the Google Doc — find by role_level, not position.
    l2 = _find_l2(employee, db)

    # Collect everyone who needs doc access, excluding the L2 (they already own the file).
    share_emails = list({
        email for email in [
            current_user.email,
            alternate_manager.email if alternate_manager else None,
            employee.email,
        ]
        if email and email != (l2.email if l2 else None)
    })

    if current_user.refresh_token or (l2 and l2.refresh_token):
        background_tasks.add_task(
            create_catchup_resources,
            catchup_id=new_catchup.id,
            manager_refresh_token=current_user.refresh_token,
            l2_refresh_token=l2.refresh_token if l2 else None,
            employee_name=employee.name,
            employee_email=employee.email,
            manager_name=current_user.name,
            alternate_manager_email=alternate_manager.email if alternate_manager else None,
            emails_to_share=share_emails,
            date_and_time=catchup.date_and_time,
        )
    else:
        new_catchup.background_creation_finished = True
        db.commit()
        db.refresh(new_catchup)

    return new_catchup


@router.delete("/{catchup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catchup(
    catchup_id: int,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
    if not catchup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catchup not found")
    if current_user.id not in (catchup.manager_id, catchup.alternate_manager_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this catchup")

    doc_link = catchup.notes_doc_link
    calendar_event_id = catchup.calendar_event_id
    manager_refresh_token = catchup.manager.refresh_token

    employee = db.query(User).filter(User.id == catchup.employee_id).first()
    l2 = _find_l2(employee, db) if employee else None
    doc_owner_token = (l2.refresh_token if l2 else None) or manager_refresh_token

    db.delete(catchup)
    db.commit()

    background_tasks.add_task(
        delete_catchup_resources,
        doc_link=doc_link,
        doc_owner_token=doc_owner_token,
        calendar_event_id=calendar_event_id,
        manager_refresh_token=manager_refresh_token,
    )


@router.patch("/{catchup_id}", response_model=CatchupResponse)
def update_catchup(
    catchup_id: int,
    update: CatchupUpdate,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
    if not catchup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catchup not found")
    if current_user.id not in (catchup.manager_id, catchup.alternate_manager_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit this catchup")

    employee_changed = update.employee_id is not None and update.employee_id != catchup.employee_id
    date_changed = update.date_and_time is not None

    old_doc_link = catchup.notes_doc_link
    old_calendar_event_id = catchup.calendar_event_id

    if update.employee_id is not None:
        new_employee = db.query(User).filter(User.id == update.employee_id).first()
        if not new_employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
        catchup.employee_id = update.employee_id

    if update.date_and_time is not None:
        catchup.date_and_time = update.date_and_time

    if employee_changed:
        catchup.notes_doc_link = ""
        catchup.meeting_link = ""
        catchup.calendar_event_id = None
        catchup.background_creation_finished = False

    db.commit()
    db.refresh(catchup)

    if employee_changed:
        employee = db.query(User).filter(User.id == catchup.employee_id).first()
        alternate_manager = db.query(User).filter(User.id == catchup.alternate_manager_id).first() if catchup.alternate_manager_id else None
        l2 = _find_l2(employee, db)
        doc_owner_token = (l2.refresh_token if l2 else None) or current_user.refresh_token
        share_emails = list({
            email for email in [
                current_user.email,
                alternate_manager.email if alternate_manager else None,
                employee.email,
            ]
            if email and email != (l2.email if l2 else None)
        })
        background_tasks.add_task(
            recreate_catchup_resources,
            catchup_id=catchup.id,
            old_doc_link=old_doc_link,
            old_calendar_event_id=old_calendar_event_id,
            doc_owner_token=doc_owner_token,
            manager_refresh_token=current_user.refresh_token,
            employee_name=employee.name,
            employee_email=employee.email,
            manager_name=current_user.name,
            alternate_manager_email=alternate_manager.email if alternate_manager else None,
            emails_to_share=share_emails,
            date_and_time=catchup.date_and_time,
        )
    elif date_changed:
        background_tasks.add_task(
            update_catchup_calendar_time,
            catchup_id=catchup.id,
            calendar_event_id=old_calendar_event_id,
            manager_refresh_token=current_user.refresh_token,
            new_date_and_time=catchup.date_and_time,
        )

    return catchup
