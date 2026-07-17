from __future__ import annotations
from typing import Optional
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from core.config import settings
from models.leaves import leave_phrase

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


def fmt_date(d) -> str:
    """Format a date the friendly way, e.g. '20 Jul 2026'."""
    return d.strftime("%-d %b %Y")


def date_range(start, end) -> str:
    """Human-friendly date range with no raw ISO dates.

    Single day → '20 Jul 2026'. Same-year range → '20 Jul → 22 Jul 2026'.
    Cross-year range → '28 Dec 2025 → 3 Jan 2026'.
    """
    if start == end:
        return fmt_date(start)
    if start.year == end.year:
        return f"{start.strftime('%-d %b')} → {fmt_date(end)}"
    return f"{fmt_date(start)} → {fmt_date(end)}"


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


def post_channel(channel_id: str, **kwargs) -> Optional[dict]:
    """Post a message to a channel. In demo mode redirects to SLACK_DEMO_USER_ID."""
    client = _get_client()
    if not client or not channel_id:
        return None
    dest = settings.SLACK_DEMO_USER_ID if (settings.SLACK_DEMO_MODE and settings.SLACK_DEMO_USER_ID) else channel_id
    try:
        r = client.chat_postMessage(channel=dest, **kwargs)
        return {"channel": r["channel"], "ts": r["ts"]}
    except SlackApiError as e:
        print(f"[slack channel error] {e.response['error']}")
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


def approver_payload(leave, user, days: int, over_limit: bool = False) -> dict:
    """Build the chat_postMessage kwargs for a manager approval request DM."""
    date_str = date_range(leave.start_date, leave.end_date)
    phrase = leave_phrase(leave.leave_type)
    day_word = "day" if days == 1 else "days"
    first_name = user.name.split()[0] if user.name else user.name
    over_limit_line = f"\n⚠️ This request will exceed {first_name}'s {phrase.lower()} balance." if over_limit else ""
    exception_line = "\n🚨 Exception request — notice-period rules were waived." if getattr(leave, "is_exception", False) else ""
    text = (
        f"*Leave approval needed*\n"
        f"*{user.name}* ({user.role}) has requested time off and needs your approval.\n\n"
        f"*Type:*  {phrase}\n"
        f"*Dates:*  {date_str}  ({days} working {day_word})\n"
        f"*Note:*  {leave.note or '—'}"
        f"{over_limit_line}"
        f"{exception_line}"
    )
    return {
        "text": f"Leave approval needed for {user.name}",
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
