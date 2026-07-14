from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from models.leaves import LeaveType, LeaveStatus, ApprovalStatus, REQUESTABLE_LEAVE_TYPES
from schemas.users import UserResponse


def reject_balance_bucket(value: LeaveType) -> LeaveType:
    """`sick_and_casual` names a shared balance pool, not a leave anyone can take.

    Requests must say which of `sick` or `casual` they are, since the two carry
    different date rules.
    """
    if value not in REQUESTABLE_LEAVE_TYPES:
        raise ValueError(
            f"'{value}' is a balance pool, not a requestable leave type. "
            f"Use 'sick' or 'casual'."
        )
    return value


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

    _check_leave_type = field_validator("leave_type")(reject_balance_bucket)


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


class LeaveSummaryResponse(BaseModel):
    """What a profile sidebar needs: what is coming, and which past days were leave."""

    upcoming: list[LeaveResponse]     # approved only — a pending leave has not happened
    leave_dates: list[date]           # every approved leave day inside the window
