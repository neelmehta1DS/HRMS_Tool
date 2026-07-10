from __future__ import annotations
from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict

from models.users import OfficeStatus


class StatusEventResponse(BaseModel):
    occurred_at: datetime
    office_status: OfficeStatus

    late_arrive_eta: Optional[time] = None
    early_exit_eta: Optional[time] = None
    stepping_out_from: Optional[time] = None
    stepping_out_to: Optional[time] = None

    model_config = ConfigDict(from_attributes=True)


class StatusDayResponse(BaseModel):
    business_date: date
    clocked_in_at: datetime      # first event of the day
    final_status: OfficeStatus   # status as of the day's last event
    events: list[StatusEventResponse]
