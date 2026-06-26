from datetime import date, datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import Date, DateTime, ForeignKey, func
from db.database import Base

if TYPE_CHECKING:
    from models.users import User

class Catchup(Base):
    __tablename__ = "catchups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    manager_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    manager: Mapped["User"] = relationship("User", foreign_keys=[manager_id])
    alternate_manager_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), default=None)
    alternate_manager: Mapped[Optional["User"]] = relationship("User", foreign_keys=[alternate_manager_id])

    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id])

    notes_doc_link: Mapped[str] = mapped_column()
    meeting_link: Mapped[str] = mapped_column()
    date_and_time: Mapped[datetime] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())