from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.catchups import Catchup
from models.leaves import Leave, LeaveApproval, LeaveBalance
from models.status_events import StatusEvent
from models.users import User


def delete_user_and_records(db: Session, user: User) -> None:
    """Remove a user and everything that points at them.

    SQLite ignores `ondelete` unless PRAGMA foreign_keys is on, and this app
    never turns it on, so nothing cascades on its own. Every referencing row is
    removed here explicitly; miss one and the next query joining it explodes.

    Their direct reports are re-parented to the deleted user's own manager,
    which keeps the hierarchy connected instead of stranding a subtree at the
    root. Approvals this user owed on *other people's* leaves are removed too —
    those leaves keep whatever status they already reached.
    """
    # Read these before anything is deleted.
    grandparent_id = user.manager_id
    report_ids = [row[0] for row in db.query(User.id).filter(User.manager_id == user.id).all()]

    catchups = db.query(Catchup).filter(
        or_(
            Catchup.employee_id == user.id,
            Catchup.manager_id == user.id,
            Catchup.alternate_manager_id == user.id,
        )
    ).all()
    for catchup in catchups:
        db.delete(catchup)

    leave_ids = [row[0] for row in db.query(Leave.id).filter(Leave.user_id == user.id).all()]
    if leave_ids:
        db.query(LeaveApproval).filter(LeaveApproval.leave_id.in_(leave_ids)).delete(synchronize_session=False)
    db.query(LeaveApproval).filter(LeaveApproval.approver_id == user.id).delete(synchronize_session=False)
    db.query(Leave).filter(Leave.user_id == user.id).delete(synchronize_session=False)

    db.query(LeaveBalance).filter(LeaveBalance.user_id == user.id).delete(synchronize_session=False)
    db.query(StatusEvent).filter(StatusEvent.user_id == user.id).delete(synchronize_session=False)

    db.delete(user)
    db.flush()

    # Re-parent only now. Deleting the user makes SQLAlchemy null out the
    # manager_id of everyone in `user.reports`, which would silently undo this
    # if it ran first.
    if report_ids:
        db.query(User).filter(User.id.in_(report_ids)).update(
            {User.manager_id: grandparent_id}, synchronize_session=False
        )

    db.commit()
