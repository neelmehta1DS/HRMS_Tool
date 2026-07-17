import asyncio
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, and_, or_
from sqlalchemy.orm import Session, joinedload

from core.holidays import HOLIDAYS
from core.time import now_ist, today_ist
from core.occasions import next_occurrence, occurrences_in_range
from core.security import get_current_user
from db.database import get_db, SessionLocal
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


# The /summary handler fans these four helpers out concurrently
# (asyncio.gather + run_in_threadpool). Each opens its own short-lived sync
# session — a Session is not safe to share across threads — and returns fully
# built Pydantic models / values so nothing is lazy-loaded after its session
# closes. Catch-up serialization walks the manager chain, so those queries
# eager-load it explicitly rather than leaning on an identity-map warmup.

def _summary_people(today: date, thirty_days_out: date):
    birthdays: list[UpcomingBirthday] = []
    anniversaries: list[UpcomingAnniversary] = []
    with SessionLocal() as s:
        for u in s.query(User).all():
            if u.birthday:
                occurrence = next_occurrence(u.birthday, today)
                if today <= occurrence <= thirty_days_out:
                    birthdays.append(UpcomingBirthday(
                        user_id=u.id, name=u.name, role=u.role,
                        birthday=occurrence, days_until=(occurrence - today).days,
                    ))
            if u.joining_date and u.joining_date < today:
                occurrence = next_occurrence(u.joining_date, today)
                if today <= occurrence <= thirty_days_out:
                    anniversaries.append(UpcomingAnniversary(
                        user_id=u.id, name=u.name, role=u.role,
                        anniversary_date=occurrence,
                        years=occurrence.year - u.joining_date.year,
                        days_until=(occurrence - today).days,
                    ))
    birthdays.sort(key=lambda x: x.days_until)
    anniversaries.sort(key=lambda x: x.days_until)
    return birthdays, anniversaries


def _summary_leaves(today: date, thirty_days_out: date):
    """One query for approved leaves overlapping [today, +30d]; split into
    on-leave-today vs upcoming in Python."""
    on_today: list[TeamLeaveItem] = []
    upcoming: list[TeamLeaveItem] = []
    with SessionLocal() as s:
        rows = (
            s.query(Leave)
            .options(joinedload(Leave.user))
            .where(
                Leave.status == LeaveStatus.approved,
                Leave.end_date >= today,
                Leave.start_date <= thirty_days_out,
            )
            .order_by(Leave.start_date)
            .all()
        )
        for lv in rows:
            item = TeamLeaveItem(
                user_id=lv.user.id, name=lv.user.name, leave_type=str(lv.leave_type),
                start_date=lv.start_date, end_date=lv.end_date,
            )
            (on_today if lv.start_date <= today else upcoming).append(item)
    return on_today, upcoming


def _summary_catchups(uid: int, now: datetime, thirty_days_out: date):
    """One query for the user's catch-ups (as employee OR manager) in the next
    30 days; split by role in Python."""
    end_dt = datetime.combine(thirty_days_out, datetime.max.time())
    with SessionLocal() as s:
        rows = (
            s.query(Catchup)
            .options(
                joinedload(Catchup.employee).joinedload(User.manager).joinedload(User.manager),
                joinedload(Catchup.manager).joinedload(User.manager).joinedload(User.manager),
                joinedload(Catchup.alternate_manager).joinedload(User.manager).joinedload(User.manager),
            )
            .where(
                or_(
                    Catchup.employee_id == uid,
                    Catchup.manager_id == uid,
                    Catchup.alternate_manager_id == uid,
                ),
                Catchup.date_and_time >= now,
                Catchup.date_and_time <= end_dt,
            )
            .order_by(Catchup.date_and_time)
            .all()
        )
        as_employee = [CatchupResponse.model_validate(c) for c in rows if c.employee_id == uid]
        as_manager = [
            CatchupResponse.model_validate(c) for c in rows
            if c.manager_id == uid or c.alternate_manager_id == uid
        ]
    return as_employee, as_manager


def _summary_pending_count(uid: int, today: date) -> int:
    with SessionLocal() as s:
        min_pending = (
            s.query(LeaveApproval.leave_id, func.min(LeaveApproval.step).label("min_step"))
            .where(LeaveApproval.status == ApprovalStatus.pending)
            .group_by(LeaveApproval.leave_id)
            .subquery()
        )
        return (
            s.query(LeaveApproval)
            .join(min_pending, and_(
                min_pending.c.leave_id == LeaveApproval.leave_id,
                LeaveApproval.step == min_pending.c.min_step,
            ))
            .join(Leave, Leave.id == LeaveApproval.leave_id)
            .where(
                LeaveApproval.approver_id == uid,
                LeaveApproval.status == ApprovalStatus.pending,
                Leave.status == LeaveStatus.pending,
                Leave.start_date >= today,
            )
            .count()
        )


@router.get("/summary", response_model=DashboardSummary)
async def get_dashboard_summary(
    current_user: Annotated[User, Depends(get_current_user)],
):
    today = today_ist()
    thirty_days_out = today + timedelta(days=30)
    now = now_ist()
    uid = current_user.id

    (
        (birthdays, anniversaries),
        (on_leave_today, upcoming_leaves),
        (my_catchups, catchups_as_manager),
        pending_approvals_count,
    ) = await asyncio.gather(
        run_in_threadpool(_summary_people, today, thirty_days_out),
        run_in_threadpool(_summary_leaves, today, thirty_days_out),
        run_in_threadpool(_summary_catchups, uid, now, thirty_days_out),
        run_in_threadpool(_summary_pending_count, uid, today),
    )

    return DashboardSummary(
        birthdays_upcoming=birthdays,
        anniversaries_upcoming=anniversaries,
        team_on_leave_today=on_leave_today,
        team_leaves_upcoming=upcoming_leaves,
        my_catchups_upcoming=my_catchups,
        pending_approvals_count=pending_approvals_count,
        upcoming_catchups_as_manager=catchups_as_manager,
    )


def _calendar_people(start: date, end: date) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    with SessionLocal() as s:
        for u in s.query(User).all():
            if u.birthday:
                events.extend(
                    CalendarEvent(
                        type="birthday", start_date=occurrence, end_date=occurrence,
                        title=u.name, user_id=u.id, user_name=u.name,
                    )
                    for occurrence in occurrences_in_range(u.birthday, start, end)
                )
            if u.joining_date:
                for occurrence in occurrences_in_range(u.joining_date, start, end):
                    years = occurrence.year - u.joining_date.year
                    if years < 1:
                        continue  # the joining date itself is not an anniversary
                    events.append(CalendarEvent(
                        type="anniversary", start_date=occurrence, end_date=occurrence,
                        title=u.name, user_id=u.id, user_name=u.name, years=years,
                    ))
    return events


def _calendar_leaves(start: date, end: date) -> list[CalendarEvent]:
    with SessionLocal() as s:
        rows = (
            s.query(Leave)
            .options(joinedload(Leave.user))
            .where(
                Leave.status == LeaveStatus.approved,
                Leave.start_date <= end,
                Leave.end_date >= start,
            )
            .order_by(Leave.start_date)
            .all()
        )
        return [
            CalendarEvent(
                type="leave", start_date=lv.start_date, end_date=lv.end_date,
                title=lv.user.name, user_id=lv.user_id, user_name=lv.user.name,
                leave_type=str(lv.leave_type),
            )
            for lv in rows
        ]


def _calendar_catchups(uid: int, start: date, end: date) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    with SessionLocal() as s:
        rows = (
            s.query(Catchup)
            .options(joinedload(Catchup.employee), joinedload(Catchup.manager))
            .where(
                or_(
                    Catchup.employee_id == uid,
                    Catchup.manager_id == uid,
                    Catchup.alternate_manager_id == uid,
                ),
                Catchup.date_and_time >= datetime.combine(start, time.min),
                Catchup.date_and_time <= datetime.combine(end, time.max),
            )
            .order_by(Catchup.date_and_time)
            .all()
        )
        for c in rows:
            day = c.date_and_time.date()
            other = c.employee if c.manager_id == uid or c.alternate_manager_id == uid else c.manager
            events.append(CalendarEvent(
                type="catchup", start_date=day, end_date=day,
                title=other.name, user_id=other.id, user_name=other.name,
                catchup_id=c.id, starts_at=c.date_and_time,
                meeting_link=c.meeting_link, notes_doc_link=c.notes_doc_link,
            ))
    return events


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    current_user: Annotated[User, Depends(get_current_user)],
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

    people_events, leave_events, catchup_events = await asyncio.gather(
        run_in_threadpool(_calendar_people, start, end),
        run_in_threadpool(_calendar_leaves, start, end),
        run_in_threadpool(_calendar_catchups, current_user.id, start, end),
    )

    events: list[CalendarEvent] = [*people_events, *leave_events, *catchup_events]

    for h in HOLIDAYS:
        day = date.fromisoformat(h["date"])
        if start <= day <= end:
            events.append(CalendarEvent(
                type="holiday", start_date=day, end_date=day, title=h["name"],
            ))

    return CalendarResponse(events=events)
