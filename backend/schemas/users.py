from __future__ import annotations
from datetime import date, time
from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.users import RoleLevel, OfficeStatus


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
    phone_number: Optional[str] = None

    role_level: RoleLevel
    manager_id: Optional[int] = None
    manager: Optional[ManagerInfo] = None

    slack_user_id: Optional[str] = None

    office_status: Optional[OfficeStatus] = None
    late_arrive_eta: Optional[time] = None
    early_exit_eta: Optional[time] = None
    stepping_out_from: Optional[time] = None
    stepping_out_to: Optional[time] = None

    sick_leaves_taken: int = 0
    casual_leaves_taken: int = 0

    is_admin: bool = False

    birthday: Optional[date] = None
    joining_date: Optional[date] = None

    model_config = ConfigDict(from_attributes=True)

class UserStatusUpdate(BaseModel):
    office_status: Optional[OfficeStatus] = None
    late_arrive_eta: Optional[time] = None
    early_exit_eta: Optional[time] = None
    stepping_out_from: Optional[time] = None
    stepping_out_to: Optional[time] = None