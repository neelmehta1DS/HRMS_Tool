from datetime import timedelta
from itertools import groupby

from sqlalchemy.orm import Session

from core.time import today_ist
from models.status_events import StatusEvent
from schemas.status_events import StatusDayResponse, StatusEventResponse


def status_history(db: Session, user_id: int, days: int) -> list[StatusDayResponse]:
    """A user's status days, newest first, each holding that day's events in order.

    `days` counts today plus the days before it, so a window of 1 is just today.
    Days with no events are absent: the person never set a status.
    """
    earliest = today_ist() - timedelta(days=days - 1)

    events = (
        db.query(StatusEvent)
        .filter(StatusEvent.user_id == user_id, StatusEvent.business_date >= earliest)
        .order_by(StatusEvent.business_date.desc(), StatusEvent.occurred_at.asc())
        .all()
    )

    return [
        StatusDayResponse(
            business_date=business_date,
            clocked_in_at=day_events[0].occurred_at,
            final_status=day_events[-1].office_status,
            events=[StatusEventResponse.model_validate(e) for e in day_events],
        )
        for business_date, day_events in (
            (d, list(g)) for d, g in groupby(events, key=lambda e: e.business_date)
        )
    ]
