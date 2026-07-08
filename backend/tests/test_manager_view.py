from datetime import date, timedelta


def _future(days=30):
    return str(date.today() + timedelta(days=days))


def _create_casual_leave(client, start_days=30):
    resp = client.post("/leaves", json={
        "leave_type": "casual",
        "note": "Time off",
        "start_date": _future(start_days),
    })
    assert resp.status_code == 200
    return resp.json()


def _manager_queue(client):
    resp = client.get("/leaves/manager/me")
    assert resp.status_code == 200
    return [l["id"] for l in resp.json()]


# ---------------------------------------------------------------------------
# Manager view — min-step subquery logic
# ---------------------------------------------------------------------------

def test_manager_sees_pending_leave_in_queue(client_as, ic, manager):
    leave = _create_casual_leave(client_as(ic))

    queue = _manager_queue(client_as(manager))

    assert leave["id"] in queue


def test_skip_manager_does_not_see_leave_while_step1_is_pending(client_as, ic, skip_manager):
    """Step 2 should be invisible to the skip manager until step 1 resolves."""
    leave = _create_casual_leave(client_as(ic))

    queue = _manager_queue(client_as(skip_manager))

    assert leave["id"] not in queue


def test_skip_manager_sees_leave_after_step1_approved(client_as, ic, manager, skip_manager):
    leave_id = _create_casual_leave(client_as(ic))["id"]

    client_as(manager).patch(f"/leaves/{leave_id}/approve")  # resolve step 1

    queue = _manager_queue(client_as(skip_manager))
    assert leave_id in queue
