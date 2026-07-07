from __future__ import annotations
from datetime import date, datetime, time
from enum import StrEnum
from typing import Optional

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, Time, DateTime, Enum, ForeignKey, func
from db.database import Base


class RoleLevel(StrEnum):
    ic = "ic"
    l1_manager = "l1_manager"
    l2_lead = "l2_lead"


class OfficeStatus(StrEnum):
    IN = "IN"
    WFH = "WFH"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    name: Mapped[str]
    role: Mapped[str]

    # Hierarchy
    manager_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), default=None)
    manager: Mapped[Optional["User"]] = relationship("User", remote_side=[id], back_populates="reports")
    reports: Mapped[list["User"]] = relationship("User", back_populates="manager")

    @property
    def role_level(self) -> RoleLevel:
        if self.manager_id is None:
            return RoleLevel.l2_lead
        if self.manager and self.manager.manager_id is None:
            return RoleLevel.l1_manager
        return RoleLevel.ic

    # Google OAuth
    refresh_token: Mapped[Optional[str]] = mapped_column(default=None)

    # Slack integration
    slack_user_id: Mapped[Optional[str]] = mapped_column(unique=True, default=None)

    # Live status
    office_status: Mapped[Optional[OfficeStatus]] = mapped_column(Enum(OfficeStatus), default=None)
    late_arrive_eta: Mapped[Optional[time]] = mapped_column(Time, default=None)
    early_exit_eta: Mapped[Optional[time]] = mapped_column(Time, default=None)
    stepping_out_from: Mapped[Optional[time]] = mapped_column(Time, default=None)
    stepping_out_to: Mapped[Optional[time]] = mapped_column(Time, default=None)

    # Leave balances (weekdays only)
    sick_leaves_taken: Mapped[int] = mapped_column(default=0)
    casual_leaves_taken: Mapped[int] = mapped_column(default=0)

    is_admin: Mapped[bool] = mapped_column(default=False)

    birthday: Mapped[Optional[date]] = mapped_column(Date, default=None)
    joining_date: Mapped[Optional[date]] = mapped_column(Date, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())