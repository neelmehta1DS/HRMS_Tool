import logging
from datetime import datetime, timedelta
from typing import Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from core.config import settings

logger = logging.getLogger(__name__)

_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"

# Catch-up times are stored naive as IST wall-clock (see core/time.py), so the
# calendar event must be tagged with the matching IANA zone — not UTC, or every
# invite lands 5.5 hours off.
_EVENT_TIMEZONE = "Asia/Kolkata"


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
    service,
    catchup_id: int,
    employee_name: str,
    employee_email: str,
    alternate_manager_email: Optional[str],
    date_and_time,
) -> tuple[str, str]:
    """Creates a Google Calendar event with a Meet link. Returns (meet_link, event_id)."""
    attendees = [{"email": employee_email}]
    if alternate_manager_email:
        attendees.append({"email": alternate_manager_email})

    end_time = date_and_time + timedelta(minutes=30)

    event = {
        "summary": f"Catchup: {employee_name}",
        "start": {"dateTime": date_and_time.isoformat(), "timeZone": _EVENT_TIMEZONE},
        "end": {"dateTime": end_time.isoformat(), "timeZone": _EVENT_TIMEZONE},
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

    return link, result["id"]


def _delete_calendar_event(manager_refresh_token: str, event_id: str) -> None:
    """Delete a Google Calendar event and cancel all invites."""
    creds = _build_credentials(manager_refresh_token)
    service = build("calendar", "v3", credentials=creds)
    service.events().delete(calendarId="primary", eventId=event_id, sendUpdates="all").execute()


def _patch_calendar_event_time(manager_refresh_token: str, event_id: str, new_date_and_time: datetime) -> None:
    """Update only the start/end time of an existing Calendar event."""
    creds = _build_credentials(manager_refresh_token)
    service = build("calendar", "v3", credentials=creds)
    end_time = new_date_and_time + timedelta(minutes=30)
    service.events().patch(
        calendarId="primary",
        eventId=event_id,
        body={
            "start": {"dateTime": new_date_and_time.isoformat(), "timeZone": _EVENT_TIMEZONE},
            "end": {"dateTime": end_time.isoformat(), "timeZone": _EVENT_TIMEZONE},
        },
        sendUpdates="all",
    ).execute()
