"""Shared SQLAlchemy eager-loading options.

Serializing a list of leaves/catchups reads relationships (user, approvals,
approver, manager chain). Left lazy, each access fires its own query — O(N)
round-trips. These options load everything up front so a list is a fixed
handful of queries regardless of size.
"""
from sqlalchemy.orm import selectinload, joinedload

from models.leaves import Leave, LeaveApproval
from models.users import User

# A leave's user serializes to the slim LeaveUser (plain columns only) and its
# approvals' approvers to ApproverInfo (also plain columns) — neither walks the
# manager chain, so no deep loading is needed here.
LEAVE_LOADS = (
    selectinload(Leave.user),
    selectinload(Leave.approvals).joinedload(LeaveApproval.approver),
)

# A User serialized as the *full* UserResponse needs its manager chain loaded:
# role_level reads self.manager, and the recursive ManagerInfo walks upward. The
# hierarchy is at most 3 levels, so two hops cover it; a null manager_id resolves
# to None with no query.
USER_MANAGER_CHAIN = joinedload(User.manager).joinedload(User.manager)


def user_rel_chain(rel):
    """Eager-load a many-to-one User relationship plus its manager chain (for
    relationships whose target serializes to the full UserResponse)."""
    return joinedload(rel).joinedload(User.manager).joinedload(User.manager)
