from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.leaves import LeaveType, LeaveStatus, ApprovalStatus
from schemas.users import UserResponse


class ApproverInfo(BaseModel):
    id: int
    name: str
    role: str
    slack_user_id: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class LeaveApprovalResponse(BaseModel):
    id: int
    step: int
    status: ApprovalStatus
    decided_at: Optional[datetime] = None
    rejection_note: Optional[str] = None
    approver: ApproverInfo
    model_config = ConfigDict(from_attributes=True)


class LeaveBase(BaseModel):
    leave_type: LeaveType
    note: Optional[str] = None
    start_date: date
    end_date: date


class LeaveCreate(BaseModel):
    leave_type: LeaveType
    note: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None  # defaults to start_date if omitted
    is_exception: bool = False


class LeaveUpdate(BaseModel):
    note: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class LeaveRejectRequest(BaseModel):
    reason: str


class LeaveBalanceEntry(BaseModel):
    taken: int
    limit: Optional[int]
    remaining: Optional[int]  # None when limit is null (LWP)


class LeaveResponse(LeaveBase):
    id: int
    user: UserResponse

    is_exception: bool = False
    status: LeaveStatus
    approvals: list[LeaveApprovalResponse] = []
    over_limit: bool = False
    user_balances: Optional[dict[str, LeaveBalanceEntry]] = None

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
