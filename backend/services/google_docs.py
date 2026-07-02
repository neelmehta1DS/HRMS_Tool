import logging
from datetime import datetime
from typing import Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from core.config import settings
from services.doc_template import build_doc_requests

logger = logging.getLogger(__name__)


def _build_credentials(refresh_token: str) -> Credentials:
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )


def _get_or_create_folder(drive, name: str, parent_id: Optional[str] = None) -> str:
    safe_name = name.replace("\\", "\\\\").replace("'", "\\'")
    query = (
        f"name='{safe_name}' and "
        "mimeType='application/vnd.google-apps.folder' and "
        "trashed=false"
    )
    if parent_id:
        query += f" and '{parent_id}' in parents"

    results = drive.files().list(q=query, fields="files(id)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]

    body = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        body["parents"] = [parent_id]

    folder = drive.files().create(body=body, fields="id").execute()
    return folder["id"]


def _get_or_create_employee_folder(drive, employee_name: str) -> str:
    root_id = _get_or_create_folder(drive, "EmployeeCatchups")
    return _get_or_create_folder(drive, employee_name, parent_id=root_id)


def _build_and_share_doc(
    l2_refresh_token: str,
    employee_name: str,
    manager_name: str,
    emails_to_share: list[str],
    catchup_date: datetime,
    meeting_link: str = "",
) -> str:
    """Creates and shares a Google Doc for the catchup. Returns the doc URL."""
    creds = _build_credentials(l2_refresh_token)
    drive = build("drive", "v3", credentials=creds)
    docs  = build("docs",  "v1", credentials=creds)

    folder_id = _get_or_create_employee_folder(drive, employee_name)

    doc_file = drive.files().create(
        body={
            "name": catchup_date.strftime("%Y-%m-%d"),
            "mimeType": "application/vnd.google-apps.document",
            "parents": [folder_id],
        },
        fields="id",
    ).execute()
    doc_id = doc_file["id"]

    requests = build_doc_requests(
        employee_name=employee_name,
        manager_name=manager_name,
        meeting_link=meeting_link,
        catchup_date=catchup_date,
    )
    docs.documents().batchUpdate(
        documentId=doc_id,
        body={"requests": requests},
    ).execute()

    for email in emails_to_share:
        drive.permissions().create(
            fileId=doc_id,
            body={"type": "user", "role": "writer", "emailAddress": email},
            sendNotificationEmail=False,
        ).execute()

    return f"https://docs.google.com/document/d/{doc_id}/edit"


def _delete_doc_file(owner_refresh_token: str, doc_url: str) -> None:
    """Delete a Google Drive document by its URL."""
    try:
        doc_id = doc_url.split("/d/")[1].split("/")[0]
    except (IndexError, AttributeError):
        return
    creds = _build_credentials(owner_refresh_token)
    drive = build("drive", "v3", credentials=creds)
    drive.files().delete(fileId=doc_id).execute()
