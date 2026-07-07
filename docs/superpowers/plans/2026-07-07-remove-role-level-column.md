# Remove `role_level` Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stored `role_level` DB column with a computed Python `@property` derived from the manager hierarchy.

**Architecture:** The `role_level` property lives on the SQLAlchemy `User` model and returns an `RoleLevel` enum value based on `manager_id` and `manager.manager_id`. Pydantic schemas read it via `from_attributes=True` so the API contract is unchanged. The DB column is dropped by removing it from the model (DB has been deleted and will be recreated via `create_all`).

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy (ORM, lazy-loaded relationships), Pydantic v2, SQLite

## Global Constraints

- No Alembic — schema is managed via `Base.metadata.create_all`. DB has been wiped; just restart the server to recreate it.
- No test suite in the project — verification is done by starting the server and inspecting the API response.
- The `RoleLevel` enum must remain defined in `models/users.py` (still imported by schemas and the property).
- Frontend is untouched — the API must continue returning `role_level` in `UserResponse` and `BotUserResponse`.

---

### Task 1: Replace `role_level` column with `@property` in the User model

**Files:**
- Modify: `backend/models/users.py`

**Interfaces:**
- Produces: `User.role_level` — a Python `@property` returning `RoleLevel`. Signature: `def role_level(self) -> RoleLevel`. Consumed by all existing callers unchanged.

- [ ] **Step 1: Remove the mapped column and add the property**

Open `backend/models/users.py`. Make these two edits:

**Remove** this line (around line 31):
```python
role_level: Mapped[RoleLevel] = mapped_column(Enum(RoleLevel), default=RoleLevel.ic)
```

**Add** this property immediately after the `reports` relationship (after line ~34):
```python
@property
def role_level(self) -> RoleLevel:
    if self.manager_id is None:
        return RoleLevel.l2_lead
    if self.manager and self.manager.manager_id is None:
        return RoleLevel.l1_manager
    return RoleLevel.ic
```

The `Enum` import on the SQLAlchemy import line can also be removed if it's no longer used elsewhere — check that `Enum` isn't referenced anywhere else in the file before removing it.

The file's `RoleLevel` enum definition and the `from sqlalchemy import ..., Enum, ...` import stay only if `Enum` is still used. Since it was only used for the `role_level` column, remove `Enum` from the SQLAlchemy import line too.

- [ ] **Step 2: Verify the model file looks correct**

The `User` class should have no `role_level` mapped column. The `RoleLevel` enum class should still be present. The `@property` should appear after `reports`. The `manager` relationship must be defined before the property (it already is).

- [ ] **Step 3: Commit**

```bash
git add backend/models/users.py
git commit -m "refactor: compute role_level as property from manager hierarchy"
```

---

### Task 2: Remove `role_level` from the admin update endpoint

**Files:**
- Modify: `backend/routes/admin.py`

**Interfaces:**
- Consumes: nothing new
- Produces: `UserUpdate` body no longer accepts `role_level`; the field-update loop no longer sets it on the DB object.

- [ ] **Step 1: Remove `role_level` from `UserUpdate`**

In `backend/routes/admin.py`, find the `UserUpdate` class (around line 33). Remove this line:
```python
role_level: Optional[RoleLevel] = None
```

- [ ] **Step 2: Remove `"role_level"` from the field-update loop**

Find the loop (around line 61):
```python
for field in ("name", "role", "role_level", "slack_user_id", "is_admin"):
```
Change it to:
```python
for field in ("name", "role", "slack_user_id", "is_admin"):
```

- [ ] **Step 3: Clean up the `RoleLevel` import if unused**

`RoleLevel` is now only used in the import on line 11:
```python
from models.users import User, RoleLevel
```
Since `RoleLevel` is no longer referenced in this file, change it to:
```python
from models.users import User
```

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin.py
git commit -m "refactor: remove role_level from admin user update endpoint"
```

---

### Task 3: Remove `role_level` from the seed script

**Files:**
- Modify: `backend/seed/seed_users.py`

**Interfaces:**
- Consumes: nothing new
- Produces: seed dicts with no `role_level` key (the model no longer has a mapped column for it)

- [ ] **Step 1: Remove `role_level` from every user dict**

In `backend/seed/seed_users.py`, delete the `"role_level": RoleLevel.<value>,` line from every `upsert_user(db, {...})` call. There are 18 users. Every dict has exactly one such line.

- [ ] **Step 2: Remove the `RoleLevel` import**

The top of the file has:
```python
from models.users import User, RoleLevel, OfficeStatus
```
Change to:
```python
from models.users import User, OfficeStatus
```

- [ ] **Step 3: Commit**

```bash
git add backend/seed/seed_users.py
git commit -m "refactor: remove role_level from seed script"
```

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Start the server**

```bash
cd backend && uv run uvicorn main:app --reload
```

Expected: server starts, `create_all` creates the `users` table without a `role_level` column.

- [ ] **Step 2: Run the seed script**

```bash
cd backend && uv run python -c "from db.database import SessionLocal; from seed.seed_users import seed_users; db = SessionLocal(); seed_users(db); db.close(); print('done')"
```

Expected: `done` with no errors.

- [ ] **Step 3: Check the API response includes computed `role_level`**

```bash
curl -s http://localhost:8000/users/me -H "Authorization: Bearer <token>" | python3 -m json.tool | grep role_level
```

Expected: `"role_level": "l2_lead"` (or `l1_manager` / `ic` depending on the authenticated user's position in the hierarchy).

- [ ] **Step 4: Confirm `UserHierarchy` page and Sidebar render correctly**

Open the frontend, log in, and confirm:
- The Sidebar displays the correct role label derived from `role_level`.
- The `UserHierarchy` admin page renders nodes with correct colors and labels.
