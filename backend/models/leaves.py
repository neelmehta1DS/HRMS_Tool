from __future__ import annotations
from datetime import date, datetime
from enum import StrEnum
from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Integer, UniqueConstraint
from core.time import now_ist
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


def leave_type_label(leave_type) -> str:
    """The display label for a leave type, e.g. LeaveType.lwp → 'Leave Without Pay'."""
    return LEAVE_TYPE_LABELS.get(leave_type, str(leave_type).replace("_", " ").title())


def leave_phrase(leave_type) -> str:
    """A user-facing noun phrase for a leave type, e.g. 'Earned leave', but
    'Leave Without Pay' as-is (never 'Leave Without Pay leave')."""
    label = leave_type_label(leave_type)
    return label if "leave" in label.lower() else f"{label} leave"


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

    # True when a leave was logged by an admin / Head of Product on the user's
    # behalf, rather than requested by the user. Feeds the leave-hygiene score as
    # a "HoP-logged absence" event — see core/leave_hygiene.py.
    created_by_admin: Mapped[bool] = mapped_column(default=False)

    status: Mapped[LeaveStatus] = mapped_column(Enum(LeaveStatus), default=LeaveStatus.pending)

    approvals: Mapped[list["LeaveApproval"]] = relationship(
        "LeaveApproval", back_populates="leave", cascade="all, delete-orphan", order_by="LeaveApproval.step"
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    __table_args__ = (
        Index("ix_leaves_user_id", "user_id"),
        Index("ix_leaves_status_start", "status", "start_date"),
        Index("ix_leaves_start_end", "start_date", "end_date"),
    )


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

    __table_args__ = (
        Index("ix_leave_approvals_approver_status", "approver_id", "status"),
        Index("ix_leave_approvals_leave_id", "leave_id"),
    )


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
