import logging
import time
from datetime import datetime
from typing import Optional

from googleapiclient.discovery import build

from db.database import SessionLocal
from models.catchups import Catchup
from services.google_calendar import _build_credentials as _build_calendar_credentials, _create_calendar_event, _delete_calendar_event, _patch_calendar_event_time
from services.google_docs import _build_and_share_doc, _delete_doc_file

logger = logging.getLogger(__name__)

_RETRY_DELAYS = [0, 1, 2]


def _retry(fn, label: str, catchup_id: int):
    """Calls fn() with retries. Returns the result on success, or None after all attempts fail."""
    last_error = None
    for delay in _RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        try:
            return fn()
        except Exception as e:
            last_error = e
    logger.error("Failed to %s for catchup %d after %d attempts: %s", label, catchup_id, len(_RETRY_DELAYS), last_error, exc_info=True)
    return None


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
    meet_link: Optional[str] = None
    event_id: Optional[str] = None
    doc_url: Optional[str] = None
    calendar_service = None

    if manager_refresh_token:
        def _create_meeting():
            nonlocal calendar_service, event_id
            creds = _build_calendar_credentials(manager_refresh_token)
            calendar_service = build("calendar", "v3", credentials=creds)
            link, eid = _create_calendar_event(
                service=calendar_service,
                catchup_id=catchup_id,
                employee_name=employee_name,
                employee_email=employee_email,
                alternate_manager_email=alternate_manager_email,
                date_and_time=date_and_time,
            )
            event_id = eid
            return link

        meet_link = _retry(_create_meeting, "create calendar event", catchup_id)

    doc_owner_token = l2_refresh_token or manager_refresh_token
    if doc_owner_token:
        doc_url = _retry(
            lambda: _build_and_share_doc(
                l2_refresh_token=doc_owner_token,
                employee_name=employee_name,
                manager_name=manager_name,
                emails_to_share=emails_to_share,
                catchup_date=date_and_time,
                meeting_link=meet_link or "",
            ),
            "create notes doc",
            catchup_id,
        )

    if calendar_service and event_id and doc_url:
        _retry(
            lambda: _add_doc_attachment(calendar_service, event_id, doc_url),
            "attach doc to calendar event",
            catchup_id,
        )

    db = SessionLocal()
    try:
        catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
        if catchup:
            if meet_link:
                catchup.meeting_link = meet_link
            if event_id:
                catchup.calendar_event_id = event_id
            if doc_url:
                catchup.notes_doc_link = doc_url
            catchup.background_creation_finished = True
            db.commit()
    finally:
        db.close()


def delete_catchup_resources(
    doc_link: str,
    doc_owner_token: Optional[str],
    calendar_event_id: Optional[str],
    manager_refresh_token: Optional[str],
) -> None:
    """Fire-and-forget: delete Google Doc and Calendar event after a catchup is deleted."""
    if doc_link and doc_owner_token:
        try:
            _delete_doc_file(doc_owner_token, doc_link)
        except Exception as e:
            logger.error("Failed to delete catchup doc %s: %s", doc_link, e, exc_info=True)

    if calendar_event_id and manager_refresh_token:
        try:
            _delete_calendar_event(manager_refresh_token, calendar_event_id)
        except Exception as e:
            logger.error("Failed to delete calendar event %s: %s", calendar_event_id, e, exc_info=True)


def update_catchup_calendar_time(
    catchup_id: int,
    calendar_event_id: Optional[str],
    manager_refresh_token: Optional[str],
    new_date_and_time: datetime,
) -> None:
    """Patch the calendar event's time in-place without touching the doc."""
    if not calendar_event_id or not manager_refresh_token:
        return
    _retry(
        lambda: _patch_calendar_event_time(manager_refresh_token, calendar_event_id, new_date_and_time),
        "update calendar event time",
        catchup_id,
    )


def recreate_catchup_resources(
    catchup_id: int,
    old_doc_link: str,
    old_calendar_event_id: Optional[str],
    doc_owner_token: Optional[str],
    manager_refresh_token: Optional[str],
    employee_name: str,
    employee_email: str,
    manager_name: str,
    alternate_manager_email: Optional[str],
    emails_to_share: list[str],
    date_and_time: datetime,
) -> None:
    """Delete old doc + calendar event, then create fresh ones for the updated catchup."""
    if old_doc_link and doc_owner_token:
        _retry(lambda: _delete_doc_file(doc_owner_token, old_doc_link), "delete old doc", catchup_id)

    if old_calendar_event_id and manager_refresh_token:
        _retry(lambda: _delete_calendar_event(manager_refresh_token, old_calendar_event_id), "delete old calendar event", catchup_id)

    meet_link: Optional[str] = None
    event_id: Optional[str] = None
    doc_url: Optional[str] = None
    calendar_service = None

    if manager_refresh_token:
        def _create_meeting():
            nonlocal calendar_service, event_id
            creds = _build_calendar_credentials(manager_refresh_token)
            calendar_service = build("calendar", "v3", credentials=creds)
            link, eid = _create_calendar_event(
                service=calendar_service,
                catchup_id=catchup_id,
                employee_name=employee_name,
                employee_email=employee_email,
                alternate_manager_email=alternate_manager_email,
                date_and_time=date_and_time,
            )
            event_id = eid
            return link

        meet_link = _retry(_create_meeting, "create calendar event", catchup_id)

    if doc_owner_token:
        doc_url = _retry(
            lambda: _build_and_share_doc(
                l2_refresh_token=doc_owner_token,
                employee_name=employee_name,
                manager_name=manager_name,
                emails_to_share=emails_to_share,
                catchup_date=date_and_time,
                meeting_link=meet_link or "",
            ),
            "create notes doc",
            catchup_id,
        )

    if calendar_service and event_id and doc_url:
        _retry(
            lambda: _add_doc_attachment(calendar_service, event_id, doc_url),
            "attach doc to calendar event",
            catchup_id,
        )

    db = SessionLocal()
    try:
        catchup = db.query(Catchup).filter(Catchup.id == catchup_id).first()
        if catchup:
            catchup.meeting_link = meet_link or ""
            catchup.calendar_event_id = event_id
            catchup.notes_doc_link = doc_url or ""
            catchup.background_creation_finished = True
            db.commit()
    finally:
        db.close()
