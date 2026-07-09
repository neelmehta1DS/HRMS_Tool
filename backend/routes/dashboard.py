from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session, joinedload

from core.holidays import HOLIDAYS
from core.occasions import next_occurrence, occurrences_in_range
from core.security import get_current_user
from db.database import get_db
from models.catchups import Catchup
from models.leaves import Leave, LeaveApproval, LeaveStatus, ApprovalStatus
from models.users import User
from schemas.catchups import CatchupResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# The calendar UI only ever requests a single month. The cap stops a
# hand-rolled decade-wide range from projecting every user's birthday
# across a hundred years.
MAX_CALENDAR_SPAN_DAYS = 92


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


CalendarEventType = Literal["birthday", "anniversary", "leave", "catchup", "holiday"]


class CalendarEvent(BaseModel):
    """One event on the team calendar.

    Deliberately a flat model with nullable per-type fields rather than a
    discriminated union, so the frontend can read start_date/end_date off any
    event without narrowing on `type` first.
    """
    type: CalendarEventType
    start_date: date
    end_date: date  # equals start_date for everything except multi-day leaves
    title: str

    user_id: Optional[int] = None
    user_name: Optional[str] = None

    leave_type: Optional[str] = None      # leave
    years: Optional[int] = None           # anniversary
    catchup_id: Optional[int] = None      # catchup
    starts_at: Optional[datetime] = None  # catchup
    meeting_link: Optional[str] = None    # catchup
    notes_doc_link: Optional[str] = None  # catchup


class CalendarResponse(BaseModel):
    events: list[CalendarEvent]


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
            occurrence = next_occurrence(u.birthday, today)
            if today <= occurrence <= thirty_days_out:
                birthdays.append(UpcomingBirthday(
                    user_id=u.id,
                    name=u.name,
                    role=u.role,
                    birthday=occurrence,
                    days_until=(occurrence - today).days,
                ))

        if u.joining_date and u.joining_date < today:
            occurrence = next_occurrence(u.joining_date, today)
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
        Leave.status == LeaveStatus.approved,
    ).all()

    upcoming_leaves = db.query(Leave).where(
        Leave.start_date > today,
        Leave.start_date <= thirty_days_out,
        Leave.status == LeaveStatus.approved,
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

    min_pending = (
        db.query(LeaveApproval.leave_id, func.min(LeaveApproval.step).label("min_step"))
        .where(LeaveApproval.status == ApprovalStatus.pending)
        .group_by(LeaveApproval.leave_id)
        .subquery()
    )

    pending_approvals_count = (
        db.query(LeaveApproval)
        .join(min_pending, and_(
            min_pending.c.leave_id == LeaveApproval.leave_id,
            LeaveApproval.step == min_pending.c.min_step,
        ))
        .join(Leave, Leave.id == LeaveApproval.leave_id)
        .where(
            LeaveApproval.approver_id == current_user.id,
            LeaveApproval.status == ApprovalStatus.pending,
            Leave.status == LeaveStatus.pending,
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
        pending_approvals_count=pending_approvals_count,
        upcoming_catchups_as_manager=[CatchupResponse.model_validate(c) for c in catchups_as_manager],
    )


@router.get("/calendar", response_model=CalendarResponse)
def get_calendar(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    start: Annotated[date, Query(description="First day of the window, inclusive")],
    end: Annotated[date, Query(description="Last day of the window, inclusive")],
):
    """Every calendar event overlapping [start, end].

    Birthdays, anniversaries, approved leaves and holidays are org-wide;
    catchups are scoped to the current user.
    """
    if end < start:
        raise HTTPException(400, "end must not be before start")
    if (end - start).days >= MAX_CALENDAR_SPAN_DAYS:
        raise HTTPException(400, f"range must span fewer than {MAX_CALENDAR_SPAN_DAYS} days")

    events: list[CalendarEvent] = []

    for u in db.query(User).all():
        if u.birthday:
            events.extend(
                CalendarEvent(
                    type="birthday",
                    start_date=occurrence,
                    end_date=occurrence,
                    title=u.name,
                    user_id=u.id,
                    user_name=u.name,
                )
                for occurrence in occurrences_in_range(u.birthday, start, end)
            )

        if u.joining_date:
            for occurrence in occurrences_in_range(u.joining_date, start, end):
                years = occurrence.year - u.joining_date.year
                if years < 1:
                    continue  # the joining date itself is not an anniversary
                events.append(CalendarEvent(
                    type="anniversary",
                    start_date=occurrence,
                    end_date=occurrence,
                    title=u.name,
                    user_id=u.id,
                    user_name=u.name,
                    years=years,
                ))

    leaves = (
        db.query(Leave)
        .options(joinedload(Leave.user))
        .where(
            Leave.status == LeaveStatus.approved,
            Leave.start_date <= end,
            Leave.end_date >= start,
        )
        .order_by(Leave.start_date)
        .all()
    )
    events.extend(
        CalendarEvent(
            type="leave",
            start_date=lv.start_date,
            end_date=lv.end_date,
            title=lv.user.name,
            user_id=lv.user_id,
            user_name=lv.user.name,
            leave_type=str(lv.leave_type),
        )
        for lv in leaves
    )

    catchups = (
        db.query(Catchup)
        .where(
            or_(
                Catchup.employee_id == current_user.id,
                Catchup.manager_id == current_user.id,
                Catchup.alternate_manager_id == current_user.id,
            ),
            Catchup.date_and_time >= datetime.combine(start, time.min),
            Catchup.date_and_time <= datetime.combine(end, time.max),
        )
        .order_by(Catchup.date_and_time)
        .all()
    )
    for c in catchups:
        day = c.date_and_time.date()
        other = c.employee if c.manager_id == current_user.id or c.alternate_manager_id == current_user.id else c.manager
        events.append(CalendarEvent(
            type="catchup",
            start_date=day,
            end_date=day,
            title=other.name,
            user_id=other.id,
            user_name=other.name,
            catchup_id=c.id,
            starts_at=c.date_and_time,
            meeting_link=c.meeting_link,
            notes_doc_link=c.notes_doc_link,
        ))

    for h in HOLIDAYS:
        day = date.fromisoformat(h["date"])
        if start <= day <= end:
            events.append(CalendarEvent(
                type="holiday",
                start_date=day,
                end_date=day,
                title=h["name"],
            ))

    return CalendarResponse(events=events)
