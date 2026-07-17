from __future__ import annotations

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class AppConfig(Base):
    """Single-row table holding runtime-editable configuration.

    One row (id=1) stores a JSON blob shaped as::

        {"limits": {...}, "rules": {...}, "holidays": [{"date", "name"}, ...]}

    JSONB on Postgres (validated, indexable); plain JSON on SQLite so the test
    suite works unchanged. The in-memory globals in core.holidays /
    core.leave_limits remain the read path — see core/config_store.py.
    """
    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    config: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
