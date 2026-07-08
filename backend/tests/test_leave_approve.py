from datetime import date, timedelta


def _future(days=30):
    return str(date.today() + timedelta(days=days))


def _create_casual_leave(client, start_days=30):
    resp = client.post("/leaves", json={
        "leave_type": "casual",
        "note": "Taking time off",
        "start_date": _future(start_days),
    })
    assert resp.status_code == 200
    return resp.json()


# ---------------------------------------------------------------------------
# Single-step approval: manager requests leave, skip_manager approves
# (manager has no skip manager above them — produces one approval row)
# ---------------------------------------------------------------------------

def test_single_step_approve_sets_leave_approved(client_as, manager, skip_manager):
    leave = _create_casual_leave(client_as(manager))

    resp = client_as(skip_manager).patch(f"/leaves/{leave['id']}/approve")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"
    assert data["approvals"][0]["status"] == "approved"


def test_single_step_approve_increments_casual_balance(client_as, manager, skip_manager, db):
    leave = _create_casual_leave(client_as(manager))
    client_as(skip_manager).patch(f"/leaves/{leave['id']}/approve")

    db.refresh(manager)
    assert manager.casual_leaves_taken == 1


# ---------------------------------------------------------------------------
# Two-step approval: ic requests leave, manager then skip_manager approve
# ---------------------------------------------------------------------------

def test_step1_approve_leaves_leave_pending(client_as, ic, manager, skip_manager):
    """Step 1 approval alone should not mark the leave as approved."""
    leave = _create_casual_leave(client_as(ic))

    resp = client_as(manager).patch(f"/leaves/{leave['id']}/approve")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    by_step = {a["step"]: a["status"] for a in data["approvals"]}
    assert by_step[1] == "approved"
    assert by_step[2] == "pending"


def test_full_two_step_approval_sets_leave_approved(client_as, ic, manager, skip_manager):
    leave_id = _create_casual_leave(client_as(ic))["id"]

    client_as(manager).patch(f"/leaves/{leave_id}/approve")      # step 1
    resp = client_as(skip_manager).patch(f"/leaves/{leave_id}/approve")  # step 2

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

def test_wrong_approver_returns_403(client_as, ic, skip_manager):
    """Skip manager cannot approve step 1 — it belongs to the direct manager."""
    leave = _create_casual_leave(client_as(ic))

    resp = client_as(skip_manager).patch(f"/leaves/{leave['id']}/approve")

    assert resp.status_code == 403


def test_approve_already_resolved_leave_returns_409(client_as, manager, skip_manager):
    leave_id = _create_casual_leave(client_as(manager))["id"]
    client_as(skip_manager).patch(f"/leaves/{leave_id}/approve")   # fully approve

    resp = client_as(skip_manager).patch(f"/leaves/{leave_id}/approve")  # try again

    assert resp.status_code == 409
