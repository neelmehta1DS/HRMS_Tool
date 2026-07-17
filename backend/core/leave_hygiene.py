"""Leave-hygiene score: how well a person plans and files their leave.

The score rewards planning ahead and penalises the two things that undermine it:

  • exceptions — a leave raised bypassing the normal notice rules
  • HoP-logged absences — a leave an admin / Head of Product had to record on the
    person's behalf because they never filed it themselves

Each event carries a weight; recent events count for more (recency decay); and a
smoothing constant keeps a single bad event from swinging a low-volume user
wildly. The result is a 0–100 score with a descriptive band.

    penalty = min( Σ(weight_i × decay_i) / (total_leaves_12mo + k), 1 )
    score   = round(100 × (1 − penalty))

Users with no manager (L2 leads) auto-approve their own leaves and never raise
exceptions, so a hygiene score is meaningless for them — compute() returns None.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from core.time import today_ist
from models.leaves import Leave, LeaveStatus
from models.users import User


# ── Tunables ───────────────────────────────────────────────────────────────────
# Event weights. Anchored to the spec's worked example: an approved exception
# weighs 1 and a HoP-logged absence weighs 2.5. A declined exception weighs more
# than an approved one (1.5) — asking to bypass notice and being refused is worse
# hygiene than being granted it.
WEIGHT_EXCEPTION_APPROVED = 1.0
WEIGHT_EXCEPTION_DECLINED = 1.5
WEIGHT_HOP = 2.5

# Pseudo-leaves added to the denominator so one event can't swing a user with few
# leaves by 25+ points.
SMOOTHING_K = 4

# Recency decay boundaries, in months. Full weight inside the first, half weight
# up to the second, nothing beyond it.
FULL_WEIGHT_MONTHS = 6
WINDOW_MONTHS = 12
DAYS_PER_MONTH = 30.4375

# Score bands, high threshold first.
BANDS: tuple[tuple[int, str], ...] = (
    (90, "Excellent"),
    (75, "Good"),
    (55, "Fair"),
    (0, "Needs attention"),
)


@dataclass
class HygieneScore:
    score: int            # 0–100
    band: str             # Excellent / Good / Fair / Needs attention
    exceptions: int       # exception events counted in the window
    hop_absences: int     # HoP-logged events counted in the window
    total_leaves: int     # leaves filed (approved or rejected) in the trailing 12 months
    driver: str           # human-readable "what's dragging the score" line


def band_for(score: int) -> str:
    for threshold, label in BANDS:
        if score >= threshold:
            return label
    return BANDS[-1][1]


def _months_ago(event_date: date, today: date) -> float:
    return (today - event_date).days / DAYS_PER_MONTH


def _decay(months_ago: float) -> float:
    """1.0 inside the full-weight window, 0.5 up to the cliff, 0.0 beyond it.

    A future-dated (scheduled) leave has a negative age and counts at full
    weight — it is the most recent event there is.
    """
    if months_ago < FULL_WEIGHT_MONTHS:
        return 1.0
    if months_ago < WINDOW_MONTHS:
        return 0.5
    return 0.0


def _driver_text(hop_absences: int, exceptions: int) -> str:
    """One line naming what pulls the score down, HoP absences first."""
    parts: list[str] = []
    if hop_absences:
        noun = "absence" if hop_absences == 1 else "absences"
        parts.append(f"{hop_absences} unapproved {noun} logged by HoP")
    if exceptions:
        noun = "exception" if exceptions == 1 else "exceptions"
        parts.append(f"{exceptions} {noun}")
    if not parts:
        return "All leaves planned and filed on time"
    return " · ".join(parts)


def compute(db: Session, user: User, today: Optional[date] = None) -> Optional[HygieneScore]:
    """Leave-hygiene score for `user`, or None for users with no manager (L2)."""
    if user.manager_id is None:
        return None

    today = today or today_ist()
    cutoff = today - timedelta(days=round(DAYS_PER_MONTH * WINDOW_MONTHS))

    # One query for everything in the window; decay filters the stragglers out.
    leaves = (
        db.query(Leave)
        .filter(Leave.user_id == user.id, Leave.start_date >= cutoff)
        .all()
    )

    # Denominator base: every leave the user filed in the window, whether it was
    # approved or rejected. Pending leaves aren't decided yet, so they don't count.
    total_leaves = sum(
        1 for lv in leaves if lv.status in (LeaveStatus.approved, LeaveStatus.rejected)
    )

    weighted = 0.0
    exceptions = 0
    hop_absences = 0
    for lv in leaves:
        decay = _decay(_months_ago(lv.start_date, today))
        if decay == 0.0:
            continue
        # created_by_admin wins over is_exception: an absence someone else had to
        # log is the HoP case even if it was also flagged an exception.
        if lv.created_by_admin:
            weighted += WEIGHT_HOP * decay
            hop_absences += 1
        elif lv.is_exception:
            weight = (
                WEIGHT_EXCEPTION_DECLINED
                if lv.status == LeaveStatus.rejected
                else WEIGHT_EXCEPTION_APPROVED
            )
            weighted += weight * decay
            exceptions += 1

    penalty = min(weighted / (total_leaves + SMOOTHING_K), 1.0)
    score = round(100 * (1 - penalty))

    return HygieneScore(
        score=score,
        band=band_for(score),
        exceptions=exceptions,
        hop_absences=hop_absences,
        total_leaves=total_leaves,
        driver=_driver_text(hop_absences, exceptions),
    )
