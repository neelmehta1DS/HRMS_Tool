from __future__ import annotations
from datetime import date, time
from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.users import RoleLevel


class ManagerInfo(BaseModel):
    id: int
    name: str
    manager: Optional["ManagerInfo"] = None
    model_config = ConfigDict(from_attributes=True)

ManagerInfo.model_rebuild()


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str

    role_level: RoleLevel
    manager_id: Optional[int] = None
    manager: Optional[ManagerInfo] = None

    slack_user_id: Optional[str] = None

    in_office: bool
    wfh: bool
    late_arrive_eta: Optional[time] = None
    early_exit_eta: Optional[time] = None

    sick_leaves_taken: int = 0
    casual_leaves_taken: int = 0

    birthday: Optional[date] = None
    joining_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)

class UserStatusUpdate(BaseModel):
    in_office: Optional[bool] = None
    wfh: Optional[bool] = None
    late_arrive_eta: Optional[time] = None
    early_exit_eta: Optional[time] = None