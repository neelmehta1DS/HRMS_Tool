from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from models.leaves import LeaveStatus, LeaveType
from schemas.catchups import CatchupResponse
from schemas.leaves import LeaveBalanceEntry, LeaveResponse
from schemas.status_events import StatusDayResponse
from schemas.users import UserResponse


class AdminUserCreate(BaseModel):
    email: str
    name: str
    role: str
    manager_id: Optional[int] = None
    is_admin: bool = False
    slack_user_id: Optional[str] = None
    birthday: Optional[date] = None
    joining_date: Optional[date] = None


class AdminUserUpdate(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    manager_id: Optional[int] = None
    slack_user_id: Optional[str] = None
    is_admin: Optional[bool] = None
    birthday: Optional[date] = None
    joining_date: Optional[date] = None


class AdminLeaveCreate(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    note: Optional[str] = None
    status: LeaveStatus = LeaveStatus.approved
    is_exception: bool = False


class AdminLeaveUpdate(BaseModel):
    leave_type: Optional[LeaveType] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    note: Optional[str] = None
    status: Optional[LeaveStatus] = None
    is_exception: Optional[bool] = None


class AdminCatchupCreate(BaseModel):
    manager_id: int
    date_and_time: datetime
    alternate_manager_id: Optional[int] = None
    notes_doc_link: str = ""
    meeting_link: str = ""


class AdminCatchupUpdate(BaseModel):
    employee_id: Optional[int] = None
    manager_id: Optional[int] = None
    alternate_manager_id: Optional[int] = None
    date_and_time: Optional[datetime] = None
    notes_doc_link: Optional[str] = None
    meeting_link: Optional[str] = None


class UserOverviewResponse(BaseModel):
    """Everything an admin needs about one person, in one request."""

    user: UserResponse
    balances: dict[str, LeaveBalanceEntry]
    leaves: list[LeaveResponse]        # every leave, newest start date first
    catchups: list[CatchupResponse]    # every catchup, newest first
    status_days: list[StatusDayResponse]
