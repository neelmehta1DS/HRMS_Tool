from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, field_validator
from models.users import RoleLevel
from models.leaves import LeaveType
from schemas.leaves import reject_balance_bucket


class BotManagerInfo(BaseModel):
    id: int
    name: str
    role: str
    slack_user_id: Optional[str] = None


class BotUserResponse(BaseModel):
    id: int
    name: str
    role: str
    role_level: RoleLevel
    slack_user_id: Optional[str] = None
    l1_manager: Optional[BotManagerInfo] = None
    l2_manager: Optional[BotManagerInfo] = None


class BotLeaveCreate(BaseModel):
    slack_user_id: str
    leave_type: LeaveType
    start_date: str
    end_date: str
    note: Optional[str] = None

    _check_leave_type = field_validator("leave_type")(reject_balance_bucket)


class BotApproveRequest(BaseModel):
    slack_user_id: str


class BotRejectRequest(BaseModel):
    slack_user_id: str
    reason: str = ""


class BotSetMessageRequest(BaseModel):
    channel: str
    ts: str
