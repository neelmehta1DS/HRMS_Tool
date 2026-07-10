from __future__ import annotations
from datetime import date, datetime, time
from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Time

from core.time import now_ist, today_ist
from db.database import Base
from models.users import OfficeStatus

if TYPE_CHECKING:
    from models.users import User


class StatusEvent(Base):
    """One row per accepted status update, snapshotting the resulting status.

    Append-only: rows are never updated or deleted. The nightly reset in
    core.scheduled_tasks clears the live status on `users` but writes nothing
    here, because it is housekeeping rather than something a person did.
    """

    __tablename__ = "status_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # No index=True: user_id leads ix_status_events_user_date below, so a second
    # index on it alone would only cost writes.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    # Stored rather than derived: SQLite cannot index an expression over
    # occurred_at, so grouping a month of history would scan the table.
    business_date: Mapped[date] = mapped_column(Date, default=today_ist)

    # Never null. The API refuses to record an ETA for someone who has not set a
    # status, which is what makes the day's first event a real clock-in.
    office_status: Mapped[OfficeStatus] = mapped_column(Enum(OfficeStatus))

    late_arrive_eta: Mapped[Optional[time]] = mapped_column(Time, default=None)
    early_exit_eta: Mapped[Optional[time]] = mapped_column(Time, default=None)
    stepping_out_from: Mapped[Optional[time]] = mapped_column(Time, default=None)
    stepping_out_to: Mapped[Optional[time]] = mapped_column(Time, default=None)

    __table_args__ = (
        Index("ix_status_events_user_date", "user_id", "business_date"),
    )
