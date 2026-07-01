import logging
import time
from datetime import datetime
from typing import Optional

from googleapiclient.discovery import build

from db.database import SessionLocal
from models.catchups import Catchup
from services.google_calendar import _build_credentials as _build_calendar_credentials, _create_calendar_event
from services.google_docs import _build_and_share_doc

logger = logging.getLogger(__name__)

_RETRY_DELAYS = [0, 1, 2]


def _add_doc_attachment(service, event_id: str, doc_url: str) -> None:
    service.events().patch(
        calendarId="primary",
        eventId=event_id,
        body={
            "attachments": [{
                "fileUrl": doc_url,
                "title": "Meeting Notes",
                "mimeType": "application/vnd.google-apps.document",
            }]
        },
        supportsAttachments=True,
    ).execute()


def _run(
    catchup_id: int,
    manager_refresh_token: Optional[str],
    l2_refresh_token: Optional[str],
    employee_name: str,
    employee_email: str,
    manager_name: str,
    alternate_manager_email: Optional[str],
    emails_to_share: list[str],
    date_and_time: datetime,
) -> None:
    meet_link: Optional[str] = None
    event_id: Optional[str] = None
    doc_url: Optional[str] = None
    calendar_service = None

    if manager_refresh_token:
        creds = _build_calendar_credentials(manager_refresh_token)
        calendar_service = build("calendar", "v3", credentials=creds)
        meet_link, event_id = _create_calendar_event(
            service=calendar_service,
            catchup_id=catchup_id,
            employee_name=employee_name,
            employee_email=employee_email,
            alternate_manager_email=alternate_manager_email,
            date_and_time=date_and_time,
        )

    if l2_refresh_token:
        doc_url = _build_and_share_doc(
            l2_refresh_token=l2_refresh_token,
            employee_name=employee_name,
            manager_name=manager_name,
            emails_to_share=emails_to_share,
            catchup_date=date_and_time,
            meeting_link=meet_link or "",
        )

    if calendar_service and event_id and doc_url:
        _add_doc_attachment(calendar_service, event_id, doc_url)

    db = SessionLocal()
    try:
        catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
        if catchup:
            if meet_link:
                catchup.meeting_link = meet_link
            if doc_url:
                catchup.notes_doc_link = doc_url
            db.commit()
    finally:
        db.close()


def create_catchup_resources(
    catchup_id: int,
    manager_refresh_token: Optional[str],
    l2_refresh_token: Optional[str],
    employee_name: str,
    employee_email: str,
    manager_name: str,
    alternate_manager_email: Optional[str],
    emails_to_share: list[str],
    date_and_time: datetime,
) -> None:
    last_error: Optional[Exception] = None
    for delay in _RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        try:
            _run(
                catchup_id=catchup_id,
                manager_refresh_token=manager_refresh_token,
                l2_refresh_token=l2_refresh_token,
                employee_name=employee_name,
                employee_email=employee_email,
                manager_name=manager_name,
                alternate_manager_email=alternate_manager_email,
                emails_to_share=emails_to_share,
                date_and_time=date_and_time,
            )
            return
        except Exception as e:
            last_error = e

    logger.error(
        "Failed to create catchup resources for catchup %d after %d attempts: %s",
        catchup_id,
        len(_RETRY_DELAYS),
        last_error,
        exc_info=True,
    )
