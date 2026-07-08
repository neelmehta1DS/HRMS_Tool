from datetime import date, timedelta

from models.leaves import Leave, LeaveApproval, LeaveType, LeaveStatus, ApprovalStatus


def _future(days=30):
    return str(date.today() + timedelta(days=days))


def _today():
    return str(date.today())


# ---------------------------------------------------------------------------
# Sick leave
# ---------------------------------------------------------------------------

def test_sick_leave_auto_approved(client_as, ic):
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "sick",
        "note": "Not feeling well",
        "start_date": _today(),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["approvals"] == []


def test_sick_leave_increments_balance(client_as, ic, db):
    client_as(ic).post("/leaves", json={
        "leave_type": "sick",
        "note": "Sick day",
        "start_date": _today(),
    })
    db.refresh(ic)
    assert ic.sick_leaves_taken == 1


# ---------------------------------------------------------------------------
# Casual leave — approval row creation
# ---------------------------------------------------------------------------

def test_casual_two_level_chain_creates_two_approval_rows(client_as, ic, manager, skip_manager):
    # ic has manager (step 1) and skip_manager (step 2)
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Holiday",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    approvals = data["approvals"]
    assert len(approvals) == 2
    assert approvals[0]["step"] == 1
    assert approvals[0]["approver"]["id"] == manager.id
    assert approvals[0]["status"] == "pending"
    assert approvals[1]["step"] == 2
    assert approvals[1]["approver"]["id"] == skip_manager.id
    assert approvals[1]["status"] == "pending"


def test_casual_single_manager_creates_one_approval_row(client_as, manager, skip_manager):
    # manager's only approver is skip_manager; skip_manager has no manager above
    resp = client_as(manager).post("/leaves", json={
        "leave_type": "casual",
        "note": "Day off",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 1
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


def test_casual_no_manager_auto_approved(client_as, skip_manager):
    # skip_manager has no manager above them — auto-approved
    resp = client_as(skip_manager).post("/leaves", json={
        "leave_type": "casual",
        "note": "Vacation",
        "start_date": _future(30),
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["approvals"] == []


# ---------------------------------------------------------------------------
# Exception leaves
# ---------------------------------------------------------------------------

def test_exception_with_skip_manager_routes_to_step2_only(client_as, ic, skip_manager):
    # ic has a skip_manager — exception leave goes directly to them
    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Emergency",
        "start_date": _future(5),
        "is_exception": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 2
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


def test_exception_without_skip_manager_falls_back_to_direct_manager(client_as, manager, skip_manager):
    # manager has no skip manager — exception falls back to single-step with skip_manager
    resp = client_as(manager).post("/leaves", json={
        "leave_type": "casual",
        "note": "Emergency",
        "start_date": _future(5),
        "is_exception": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert len(data["approvals"]) == 1
    assert data["approvals"][0]["step"] == 1
    assert data["approvals"][0]["approver"]["id"] == skip_manager.id


# ---------------------------------------------------------------------------
# Overlap check
# ---------------------------------------------------------------------------

def test_rejected_leave_does_not_block_new_request(client_as, ic, db):
    db.add(Leave(
        user_id=ic.id,
        leave_type=LeaveType.casual,
        note="old",
        start_date=date.today() + timedelta(days=30),
        end_date=date.today() + timedelta(days=30),
        status=LeaveStatus.rejected,
    ))
    db.commit()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Try again",
        "start_date": _future(30),
    })
    assert resp.status_code == 200


def test_pending_leave_blocks_overlapping_request(client_as, ic, manager, db):
    existing = Leave(
        user_id=ic.id,
        leave_type=LeaveType.casual,
        note="existing",
        start_date=date.today() + timedelta(days=30),
        end_date=date.today() + timedelta(days=30),
        status=LeaveStatus.pending,
    )
    db.add(existing)
    db.flush()
    db.add(LeaveApproval(leave_id=existing.id, approver_id=manager.id, step=1))
    db.commit()

    resp = client_as(ic).post("/leaves", json={
        "leave_type": "casual",
        "note": "Duplicate",
        "start_date": _future(30),
    })
    assert resp.status_code == 422
