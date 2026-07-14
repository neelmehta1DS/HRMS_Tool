from __future__ import annotations
from datetime import date, datetime
from enum import StrEnum
from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, UniqueConstraint, func
from db.database import Base

if TYPE_CHECKING:
    from models.users import User


class LeaveType(StrEnum):
    earned = "earned"
    sick = "sick"
    casual = "casual"
    # Balance bucket only: sick and casual draw from this shared pool. No Leave
    # row ever carries it as its own leave_type — see REQUESTABLE_LEAVE_TYPES.
    sick_and_casual = "sick_and_casual"
    bereavement = "bereavement"
    marriage = "marriage"
    maternity = "maternity"
    paternity = "paternity"
    lwp = "lwp"


SPECIAL_LEAVE_TYPES = {
    LeaveType.bereavement,
    LeaveType.marriage,
    LeaveType.maternity,
    LeaveType.paternity,
    LeaveType.lwp,
}

BALANCE_BUCKET: dict[LeaveType, LeaveType] = {
    LeaveType.sick: LeaveType.sick_and_casual,
    LeaveType.casual: LeaveType.sick_and_casual,
}

REQUESTABLE_LEAVE_TYPES = frozenset(LeaveType) - {LeaveType.sick_and_casual}


def balance_key(leave_type: LeaveType) -> LeaveType:
    """The pool a leave type draws from — identity for every type but sick/casual.

    Sick and casual are separate types so their notice rules can diverge, but they
    share one annual allowance. Every LeaveBalance and LEAVE_LIMITS lookup goes
    through here, or each would silently get an allowance of its own.
    """
    return BALANCE_BUCKET.get(leave_type, leave_type)


# The distinct pools a balance can be held against, in display order. Every
# LeaveType maps onto exactly one of these via balance_key.
BALANCE_POOLS: tuple[LeaveType, ...] = tuple(dict.fromkeys(balance_key(lt) for lt in LeaveType))


LEAVE_TYPE_LABELS: dict[LeaveType, str] = {
    LeaveType.earned: "Earned",
    LeaveType.sick: "Sick",
    LeaveType.casual: "Casual",
    LeaveType.sick_and_casual: "Sick & Casual",
    LeaveType.bereavement: "Bereavement",
    LeaveType.marriage: "Marriage",
    LeaveType.maternity: "Maternity",
    LeaveType.paternity: "Paternity",
    LeaveType.lwp: "Leave Without Pay",
}


class LeaveStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class ApprovalStatus(StrEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Leave(Base):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType))
    note: Mapped[Optional[str]] = mapped_column(default=None)

    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)

    is_exception: Mapped[bool] = mapped_column(default=False)

    status: Mapped[LeaveStatus] = mapped_column(Enum(LeaveStatus), default=LeaveStatus.pending)

    approvals: Mapped[list["LeaveApproval"]] = relationship(
        "LeaveApproval", back_populates="leave", cascade="all, delete-orphan", order_by="LeaveApproval.step"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LeaveApproval(Base):
    __tablename__ = "leave_approvals"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    leave_id: Mapped[int] = mapped_column(ForeignKey("leaves.id"))
    approver_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    step: Mapped[int]
    status: Mapped[ApprovalStatus] = mapped_column(Enum(ApprovalStatus), default=ApprovalStatus.pending)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    rejection_note: Mapped[Optional[str]] = mapped_column(default=None)
    slack_channel: Mapped[Optional[str]] = mapped_column(default=None)
    slack_ts: Mapped[Optional[str]] = mapped_column(default=None)

    leave: Mapped["Leave"] = relationship("Leave", back_populates="approvals")
    approver: Mapped["User"] = relationship("User", foreign_keys=[approver_id])


class LeaveBalance(Base):
    __tablename__ = "leave_balances"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    leave_type: Mapped[LeaveType] = mapped_column(Enum(LeaveType))
    year: Mapped[int] = mapped_column(Integer)
    days_taken: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint("user_id", "leave_type", "year", name="uq_balance_user_type_year"),
    )
