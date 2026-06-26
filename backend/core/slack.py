from __future__ import annotations
from typing import Optional
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from core.config import settings

_client: Optional[WebClient] = None


def _get_client() -> Optional[WebClient]:
    global _client
    if not settings.SLACK_BOT_TOKEN:
        return None
    if _client is None:
        _client = WebClient(token=settings.SLACK_BOT_TOKEN)
    return _client


def _dest(slack_user_id: str) -> str:
    if settings.SLACK_DEMO_MODE and settings.SLACK_DEMO_USER_ID:
        return settings.SLACK_DEMO_USER_ID
    return slack_user_id


def dm(slack_user_id: str, **kwargs) -> Optional[dict]:
    """Post a DM to a user. Returns {channel, ts} on success, None on failure."""
    client = _get_client()
    if not client or not slack_user_id:
        return None
    try:
        r = client.chat_postMessage(channel=_dest(slack_user_id), **kwargs)
        return {"channel": r["channel"], "ts": r["ts"]}
    except SlackApiError as e:
        print(f"[slack dm error] {e.response['error']}")
        return None


def delete_msg(channel: Optional[str], ts: Optional[str]) -> None:
    """Delete a Slack message by channel + ts. Silent on failure."""
    if not channel or not ts:
        return
    client = _get_client()
    if not client:
        return
    try:
        client.chat_delete(channel=channel, ts=ts)
    except SlackApiError as e:
        print(f"[slack delete error] {e.response['error']}")


def approver_payload(leave, user, step_label: str, days: int) -> dict:
    """Build the chat_postMessage kwargs for a manager approval request DM."""
    date_str = (
        str(leave.start_date)
        if leave.start_date == leave.end_date
        else f"{leave.start_date} → {leave.end_date}"
    )
    type_label = str(leave.leave_type).capitalize()
    day_word = "day" if days == 1 else "days"
    text = (
        f"*Leave request* `#{leave.id}`  ·  _{step_label}_\n"
        f"*From:* {user.name} ({user.role})\n"
        f"*Type:* {type_label}\n"
        f"*Dates:* {date_str}  (*{days}* working {day_word})\n"
        f"*Note:* {leave.note or '—'}"
    )
    return {
        "text": f"Leave request #{leave.id} from {user.name}",
        "blocks": [
            {"type": "section", "text": {"type": "mrkdwn", "text": text}},
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "action_id": "leave_approve",
                        "style": "primary",
                        "text": {"type": "plain_text", "text": "Approve"},
                        "value": str(leave.id),
                    },
                    {
                        "type": "button",
                        "action_id": "leave_reject",
                        "style": "danger",
                        "text": {"type": "plain_text", "text": "Reject"},
                        "value": str(leave.id),
                    },
                ],
            },
        ],
    }
