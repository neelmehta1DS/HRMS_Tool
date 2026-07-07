from datetime import date

from db.database import SessionLocal
from models.leaves import Leave, LeaveStatus
from models.users import User
from core.config import settings
from core import slack


def send_morning_digest() -> None:
    if not settings.SLACK_DIGEST_CHANNEL:
        return

    db = SessionLocal()
    try:
        today = date.today()

        on_leave = (
            db.query(Leave)
            .filter(
                Leave.start_date <= today,
                Leave.end_date >= today,
                Leave.status == LeaveStatus.approved,
            )
            .all()
        )

        late_users = db.query(User).filter(User.late_arrive_eta != None).all()

        lines = [f"*Good morning! Here's today's team status — {today.strftime('%A, %-d %b')}*"]

        if on_leave:
            lines.append("\n*On Leave Today*")
            for leave in on_leave:
                type_label = str(leave.leave_type).capitalize()
                end_str = f", back {leave.end_date.strftime('%-d %b')}" if leave.end_date != today else ""
                lines.append(f"• {leave.user.name} ({type_label}{end_str})")

        if late_users:
            lines.append("\n*Running Late*")
            for u in late_users:
                lines.append(f"• {u.name} · ETA {u.late_arrive_eta.strftime('%H:%M')}")

        if not on_leave and not late_users:
            lines.append("\nEveryone's in today! ✅")

        text = "\n".join(lines)
        slack.post_channel(
            settings.SLACK_DIGEST_CHANNEL,
            text=text,
            blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": text}}],
        )
    finally:
        db.close()
