from tests.helpers import future_working_date as _future


def _create_earned_leave(client, start_days=30):
    resp = client.post("/leaves", json={
        "leave_type": "earned",
        "note": "Taking time off",
        "start_date": _future(start_days),
    })
    assert resp.status_code == 200
    return resp.json()


def _reject(client, leave_id, reason="Not approved"):
    return client.patch(f"/leaves/{leave_id}/reject", json={"reason": reason})


# ---------------------------------------------------------------------------
# Single-step rejection: manager requests, skip_manager rejects
# ---------------------------------------------------------------------------

def test_reject_sets_leave_status_rejected(client_as, manager, skip_manager):
    leave = _create_earned_leave(client_as(manager))

    resp = _reject(client_as(skip_manager), leave["id"])

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"


def test_reject_stores_reason_on_approval_row(client_as, manager, skip_manager):
    leave = _create_earned_leave(client_as(manager))

    resp = _reject(client_as(skip_manager), leave["id"], reason="Too short notice")

    rejected_step = next(a for a in resp.json()["approvals"] if a["status"] == "rejected")
    assert rejected_step["rejection_note"] == "Too short notice"


# ---------------------------------------------------------------------------
# The note is optional — approvers may decline without explaining themselves
# ---------------------------------------------------------------------------

def test_reject_without_a_reason_is_allowed(client_as, manager, skip_manager):
    leave = _create_earned_leave(client_as(manager))

    resp = client_as(skip_manager).patch(f"/leaves/{leave['id']}/reject", json={})

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    rejected_step = next(a for a in resp.json()["approvals"] if a["status"] == "rejected")
    assert rejected_step["rejection_note"] is None


def test_blank_reason_is_stored_as_no_note(client_as, manager, skip_manager):
    """A whitespace-only note is normalised to null so the UI omits it entirely."""
    leave = _create_earned_leave(client_as(manager))

    resp = _reject(client_as(skip_manager), leave["id"], reason="   ")

    rejected_step = next(a for a in resp.json()["approvals"] if a["status"] == "rejected")
    assert rejected_step["rejection_note"] is None


# ---------------------------------------------------------------------------
# Two-step rejection: ic requests, manager rejects at step 1
# ---------------------------------------------------------------------------

def test_reject_at_step1_leaves_step2_approval_untouched(client_as, ic, manager, skip_manager):
    """Rejecting at step 1 should not touch the step 2 row — it stays pending."""
    leave = _create_earned_leave(client_as(ic))

    resp = _reject(client_as(manager), leave["id"])

    assert resp.status_code == 200
    by_step = {a["step"]: a["status"] for a in resp.json()["approvals"]}
    assert by_step[1] == "rejected"
    assert by_step[2] == "pending"


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

def test_wrong_approver_reject_returns_403(client_as, ic, skip_manager):
    """Skip manager cannot reject step 1 — it belongs to the direct manager."""
    leave = _create_earned_leave(client_as(ic))

    resp = _reject(client_as(skip_manager), leave["id"])

    assert resp.status_code == 403


def test_reject_already_resolved_leave_returns_409(client_as, manager, skip_manager):
    leave_id = _create_earned_leave(client_as(manager))["id"]
    _reject(client_as(skip_manager), leave_id)  # first rejection

    resp = _reject(client_as(skip_manager), leave_id)  # try again

    assert resp.status_code == 409
