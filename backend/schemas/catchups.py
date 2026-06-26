from __future__ import annotations
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict

from schemas.users import UserResponse

class CatchupBase(BaseModel):
    employee_id: int
    date_and_time: datetime

class CatchupCreate(CatchupBase):
    pass

class CatchupResponse(CatchupBase):
    id: int

    manager_id: int
    manager: UserResponse
    alternate_manager_id: Optional[int] = None
    alternate_manager: Optional[UserResponse] = None

    notes_doc_link: str
    meeting_link: str

    model_config = ConfigDict(from_attributes=True)