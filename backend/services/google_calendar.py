import logging
import time
from datetime import timedelta
from typing import Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from core.config import settings
from db.database import SessionLocal
from models.catchups import Catchup

logger = logging.getLogger(__name__)

_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"
_RETRY_DELAYS = [0, 1, 2]  # seconds before each attempt


def _build_credentials(refresh_token: str) -> Credentials:
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=[_CALENDAR_SCOPE],
    )


def _create_calendar_event(
    refresh_token: str,
    catchup_id: int,
    employee_name: str,
    employee_email: str,
    alternate_manager_email: Optional[str],
    date_and_time,
) -> str:
    creds = _build_credentials(refresh_token)
    service = build("calendar", "v3", credentials=creds)

    attendees = [{"email": employee_email}]
    if alternate_manager_email:
        attendees.append({"email": alternate_manager_email})

    end_time = date_and_time + timedelta(minutes=30)

    event = {
        "summary": f"Catchup: {employee_name}",
        "start": {"dateTime": date_and_time.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end_time.isoformat(), "timeZone": "UTC"},
        "attendees": attendees,
        "conferenceData": {
            "createRequest": {
                "requestId": f"catchup-{catchup_id}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    result = service.events().insert(
        calendarId="primary",
        body=event,
        conferenceDataVersion=1,
        sendUpdates="all",
    ).execute()

    link = result.get("hangoutLink")
    if not link:
        raise RuntimeError(f"Google Calendar event created but no Meet link returned (event id: {result.get('id')})")
    return link


def create_meeting_for_catchup(
    catchup_id: int,
    manager_refresh_token: str,
    employee_name: str,
    employee_email: str,
    alternate_manager_email: Optional[str],
    date_and_time,
) -> None:
    last_error: Optional[Exception] = None

    for delay in _RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        try:
            meeting_link = _create_calendar_event(
                refresh_token=manager_refresh_token,
                catchup_id=catchup_id,
                employee_name=employee_name,
                employee_email=employee_email,
                alternate_manager_email=alternate_manager_email,
                date_and_time=date_and_time,
            )

            db = SessionLocal()
            try:
                catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
                if catchup:
                    catchup.meeting_link = meeting_link
                    db.commit()
            finally:
                db.close()

            return

        except Exception as e:
            last_error = e

    logger.error(
        "Failed to create Google Meet for catchup %d after %d attempts: %s",
        catchup_id,
        len(_RETRY_DELAYS),
        last_error,
        exc_info=True,
    )
