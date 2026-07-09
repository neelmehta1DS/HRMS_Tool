from __future__ import annotations
from typing import Optional
from pydantic import BaseModel
from models.users import RoleLevel
from models.leaves import LeaveType


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


class BotApproveRequest(BaseModel):
    slack_user_id: str


class BotRejectRequest(BaseModel):
    slack_user_id: str
    reason: str = ""


class BotSetMessageRequest(BaseModel):
    channel: str
    ts: str
