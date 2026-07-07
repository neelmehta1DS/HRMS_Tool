# Design: Remove `role_level` Column — Compute from Manager Hierarchy

**Date:** 2026-07-07  
**Status:** Approved

## Problem

`role_level` is stored as a DB column (`ic`, `l1_manager`, `l2_lead`) but is fully derivable from the manager hierarchy:

- **L2** — `manager_id IS NULL`
- **L1** — has a manager whose `manager_id IS NULL`
- **IC** — has a manager whose manager also has a manager

Storing it creates a dual source of truth that can drift.

## Solution: `@property` on the ORM model

Replace the DB column with a Python `@property` on `User`. Because Pydantic uses `from_attributes=True`, the property is serialized identically to a column — the API contract is unchanged and no frontend code needs to change.

## Affected Files

### `backend/models/users.py`
- Remove: `role_level: Mapped[RoleLevel] = mapped_column(Enum(RoleLevel), default=RoleLevel.ic)`
- Add property:
  ```python
  @property
  def role_level(self) -> RoleLevel:
      if self.manager_id is None:
          return RoleLevel.l2_lead
      if self.manager and self.manager.manager_id is None:
          return RoleLevel.l1_manager
      return RoleLevel.ic
  ```
- Keep the `RoleLevel` enum (still referenced by schemas and the property return type).

### `backend/routes/admin.py`
- Remove `role_level: Optional[RoleLevel] = None` from the `UserUpdate` body schema.
- Remove `"role_level"` from the field-update loop string list.

### `backend/seed/seed_users.py`
- Remove `"role_level": RoleLevel.<value>` from every user dict.

### No changes needed
- `backend/schemas/users.py` — `role_level: RoleLevel` reads from the property via `from_attributes=True`.
- `backend/schemas/slack_bot.py` — same.
- `backend/routes/catchups.py` — `_find_l2()` checks `current.role_level == RoleLevel.l2_lead` in Python; now reads the property, which returns `l2_lead` when `manager_id is None`. Correct.
- `backend/routes/slack_bot.py` — passes `user.role_level`; reads property, no change.
- All frontend files — API still returns `role_level`; `isL2/isL1/isIC` and UI components unchanged.

## Database

No Alembic. DB has been deleted and will be recreated via `create_all` on server start, then reseeded. No migration needed.
