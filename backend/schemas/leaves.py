from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.leaves import LeaveType
from schemas.users import UserResponse

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

class LeaveRejectRequest(BaseModel):
    reason: str

class LeaveResponse(LeaveBase):
    id: int
    user: UserResponse

    approved_by_l1: Optional[bool] = None
    approved_by_l2: Optional[bool] = None
    rejection_note: Optional[str] = None
    over_limit: bool = False

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)