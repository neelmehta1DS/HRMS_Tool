from __future__ import annotations
from datetime import date, datetime
from enum import StrEnum
from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, DateTime, Enum, ForeignKey, func
from db.database import Base

if TYPE_CHECKING:
    from models.users import User


class LeaveType(StrEnum):
    sick = "sick"
    casual = "casual"


class Leave(Base):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType))
    note: Mapped[Optional[str]] = mapped_column(default=None)
    
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)

    approved_by_l1: Mapped[Optional[bool]] = mapped_column(default=None)
    approved_by_l2: Mapped[Optional[bool]] = mapped_column(default=None)
    rejection_note: Mapped[Optional[str]] = mapped_column(default=None)

    slack_l1_channel: Mapped[Optional[str]] = mapped_column(default=None)
    slack_l1_ts: Mapped[Optional[str]] = mapped_column(default=None)
    slack_l2_channel: Mapped[Optional[str]] = mapped_column(default=None)
    slack_l2_ts: Mapped[Optional[str]] = mapped_column(default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())