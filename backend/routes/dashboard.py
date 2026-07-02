from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session, aliased

from core.security import get_current_user
from db.database import get_db
from models.catchups import Catchup
from models.leaves import Leave
from models.users import User
from schemas.catchups import CatchupResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class UpcomingBirthday(BaseModel):
    user_id: int
    name: str
    role: str
    birthday: date
    days_until: int


class UpcomingAnniversary(BaseModel):
    user_id: int
    name: str
    role: str
    anniversary_date: date
    years: int
    days_until: int


class TeamLeaveItem(BaseModel):
    user_id: int
    name: str
    leave_type: str
    start_date: date
    end_date: date


class DashboardSummary(BaseModel):
    birthdays_upcoming: list[UpcomingBirthday]
    anniversaries_upcoming: list[UpcomingAnniversary]
    team_on_leave_today: list[TeamLeaveItem]
    team_leaves_upcoming: list[TeamLeaveItem]
    my_catchups_upcoming: list[CatchupResponse]
    pending_approvals_count: int
    upcoming_catchups_as_manager: list[CatchupResponse]


def _next_occurrence(d: date, today: date) -> date:
    try:
        this_year = d.replace(year=today.year)
    except ValueError:
        this_year = d.replace(year=today.year, day=28)
    if this_year >= today:
        return this_year
    try:
        return d.replace(year=today.year + 1)
    except ValueError:
        return d.replace(year=today.year + 1, day=28)


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    today = date.today()
    thirty_days_out = today + timedelta(days=30)
    now = datetime.now()

    all_users = db.query(User).all()
    birthdays: list[UpcomingBirthday] = []
    anniversaries: list[UpcomingAnniversary] = []

    for u in all_users:
        if u.birthday:
            occurrence = _next_occurrence(u.birthday, today)
            if today <= occurrence <= thirty_days_out:
                birthdays.append(UpcomingBirthday(
                    user_id=u.id,
                    name=u.name,
                    role=u.role,
                    birthday=occurrence,
                    days_until=(occurrence - today).days,
                ))

        if u.joining_date and u.joining_date < today:
            occurrence = _next_occurrence(u.joining_date, today)
            if today <= occurrence <= thirty_days_out:
                years = occurrence.year - u.joining_date.year
                anniversaries.append(UpcomingAnniversary(
                    user_id=u.id,
                    name=u.name,
                    role=u.role,
                    anniversary_date=occurrence,
                    years=years,
                    days_until=(occurrence - today).days,
                ))

    birthdays.sort(key=lambda x: x.days_until)
    anniversaries.sort(key=lambda x: x.days_until)

    on_leave_today = db.query(Leave).where(
        Leave.start_date <= today,
        Leave.end_date >= today,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).all()

    upcoming_leaves = db.query(Leave).where(
        Leave.start_date > today,
        Leave.start_date <= thirty_days_out,
        Leave.approved_by_l1 == True,
        Leave.approved_by_l2 == True,
    ).order_by(Leave.start_date).all()

    my_catchups = db.query(Catchup).where(
        Catchup.employee_id == current_user.id,
        Catchup.date_and_time >= now,
        Catchup.date_and_time <= datetime.combine(thirty_days_out, datetime.max.time()),
    ).order_by(Catchup.date_and_time).all()

    catchups_as_manager = db.query(Catchup).where(
        (Catchup.manager_id == current_user.id) | (Catchup.alternate_manager_id == current_user.id),
        Catchup.date_and_time >= now,
        Catchup.date_and_time <= datetime.combine(thirty_days_out, datetime.max.time()),
    ).order_by(Catchup.date_and_time).all()

    LeaveOwner = aliased(User)
    OwnerManager = aliased(User)

    l1_pending_count = (
        db.query(Leave)
        .join(LeaveOwner, Leave.user_id == LeaveOwner.id)
        .where(
            LeaveOwner.manager_id == current_user.id,
            Leave.approved_by_l1.is_(None),
            Leave.approved_by_l2.isnot(False),
            Leave.start_date >= today,
        )
        .count()
    )

    l2_pending_count = (
        db.query(Leave)
        .join(LeaveOwner, Leave.user_id == LeaveOwner.id)
        .join(OwnerManager, LeaveOwner.manager_id == OwnerManager.id)
        .where(
            OwnerManager.manager_id == current_user.id,
            Leave.approved_by_l1 == True,
            Leave.approved_by_l2.is_(None),
            Leave.start_date >= today,
        )
        .count()
    )

    return DashboardSummary(
        birthdays_upcoming=birthdays,
        anniversaries_upcoming=anniversaries,
        team_on_leave_today=[
            TeamLeaveItem(
                user_id=lv.user.id,
                name=lv.user.name,
                leave_type=str(lv.leave_type),
                start_date=lv.start_date,
                end_date=lv.end_date,
            )
            for lv in on_leave_today
        ],
        team_leaves_upcoming=[
            TeamLeaveItem(
                user_id=lv.user.id,
                name=lv.user.name,
                leave_type=str(lv.leave_type),
                start_date=lv.start_date,
                end_date=lv.end_date,
            )
            for lv in upcoming_leaves
        ],
        my_catchups_upcoming=[CatchupResponse.model_validate(c) for c in my_catchups],
        pending_approvals_count=l1_pending_count + l2_pending_count,
        upcoming_catchups_as_manager=[CatchupResponse.model_validate(c) for c in catchups_as_manager],
    )
