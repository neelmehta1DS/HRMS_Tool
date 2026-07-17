from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from core import config_store
from core.config import settings
from core.scheduled_tasks import reset_annual_leave_counts, reset_daily_statuses, send_morning_digest
from core.time import IST
from db.database import Base, SessionLocal, engine
from routes import auth, users, leaves, catchups, slack_bot, dashboard, admin

from seed.seed_users import seed_users

if settings.DEBUG:
    import os
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

def _migrate():
    # These steps use SQLite-only PRAGMA / ALTER ... DROP COLUMN to bring an
    # older local database up to date. A fresh Postgres database (e.g. Supabase)
    # gets the current schema straight from Base.metadata.create_all above, so
    # there is nothing to migrate — and the PRAGMA calls would error there.
    if engine.dialect.name != "sqlite":
        return

    from sqlalchemy import text
    with engine.connect() as conn:
        users_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
        for col, definition in [
            ("stepping_out_from", "TIME"),
            ("stepping_out_to",   "TIME"),
            ("phone_number",      "VARCHAR"),
        ]:
            if col not in users_cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {definition}"))

        # OUT is no longer a valid office_status value — convert existing rows to NULL
        conn.execute(text("UPDATE users SET office_status = NULL WHERE office_status = 'OUT'"))

        leaves_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(leaves)"))}
        if "is_exception" not in leaves_cols:
            conn.execute(text("ALTER TABLE leaves ADD COLUMN is_exception INTEGER NOT NULL DEFAULT 0"))

        leaves_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(leaves)"))}
        if "created_by_admin" not in leaves_cols:
            conn.execute(text("ALTER TABLE leaves ADD COLUMN created_by_admin INTEGER NOT NULL DEFAULT 0"))

        # Leave approval refactor: replace L1/L2 booleans with status column + leave_approvals table
        leaves_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(leaves)"))}
        if "status" not in leaves_cols:
            conn.execute(text("ALTER TABLE leaves ADD COLUMN status VARCHAR NOT NULL DEFAULT 'pending'"))
            if "approved_by_l1" in leaves_cols:
                conn.execute(text(
                    "UPDATE leaves SET status = 'approved' WHERE approved_by_l1 = 1 AND approved_by_l2 = 1"
                ))
                conn.execute(text(
                    "UPDATE leaves SET status = 'rejected' WHERE approved_by_l1 = 0 OR approved_by_l2 = 0"
                ))

        # Populate leave_approvals for pending leaves (run once: only if table is empty)
        if "approved_by_l1" in leaves_cols:
            approval_count = conn.execute(text("SELECT COUNT(*) FROM leave_approvals")).scalar()
            if approval_count == 0:
                # Step 1 pending: manager has not yet decided
                conn.execute(text("""
                    INSERT INTO leave_approvals (leave_id, approver_id, step, status)
                    SELECT l.id, u.manager_id, 1, 'pending'
                    FROM leaves l
                    JOIN users u ON l.user_id = u.id
                    WHERE l.status = 'pending'
                      AND l.approved_by_l1 IS NULL
                      AND u.manager_id IS NOT NULL
                """))
                # Step 2 pending: L1 done, waiting for skip manager
                conn.execute(text("""
                    INSERT INTO leave_approvals (leave_id, approver_id, step, status)
                    SELECT l.id, m.manager_id, 2, 'pending'
                    FROM leaves l
                    JOIN users u ON l.user_id = u.id
                    JOIN users m ON u.manager_id = m.id
                    WHERE l.status = 'pending'
                      AND l.approved_by_l1 = 1
                      AND l.approved_by_l2 IS NULL
                      AND m.manager_id IS NOT NULL
                """))
            # Drop old columns now that data is migrated
            for col in [
                "approved_by_l1", "approved_by_l2", "rejection_note",
                "slack_l1_channel", "slack_l1_ts", "slack_l2_channel", "slack_l2_ts",
            ]:
                if col in leaves_cols:
                    conn.execute(text(f"ALTER TABLE leaves DROP COLUMN {col}"))

        conn.commit()


@asynccontextmanager
async def lifespan(app):
    # Bring the schema up to date before serving traffic. Kept out of module
    # import so that importing the app (in tests, scripts, or tooling) never
    # runs DDL against the live database.
    Base.metadata.create_all(bind=engine)
    _migrate()

    # Seed runtime config (leave limits, rules, holidays) from the JSON defaults
    # on first boot, then load the DB's values into the in-memory globals.
    db = SessionLocal()
    try:
        config_store.bootstrap(db)
    finally:
        db.close()

    scheduler = AsyncIOScheduler()
    # Pinned to IST rather than inherited from the system clock: on a UTC host
    # the daily reset would otherwise wipe everyone's status at 11:30 IST.
    scheduler.add_job(reset_annual_leave_counts, CronTrigger(month=1, day=1, hour=0, minute=0, timezone=IST))
    scheduler.add_job(reset_daily_statuses, CronTrigger(hour=6, minute=0, timezone=IST))
    scheduler.add_job(send_morning_digest, CronTrigger(hour=8, minute=0, timezone=IST))
    # Refresh runtime config from the DB, so an edit made outside this process —
    # another instance, or a direct change to the app_config row — propagates here
    # within the interval. An admin edit served by this process updates the
    # in-memory values immediately and doesn't wait for this.
    scheduler.add_job(config_store.reload, IntervalTrigger(minutes=10))
    scheduler.start()

    if settings.DEBUG:
        db = SessionLocal()
        try:
            seed_users(db)
        finally:
            db.close()

    yield

    scheduler.shutdown()


app = FastAPI(title="HRMS Tool API", version="0.1.0", debug=settings.DEBUG, lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers — every backend route is served under /api so the Kubernetes ingress
# routes it to the backend pod (frontend paths go to the React app).
API_PREFIX = "/api"
app.include_router(auth.router,      prefix=API_PREFIX)
app.include_router(users.router,     prefix=API_PREFIX)
app.include_router(leaves.router,    prefix=API_PREFIX)
app.include_router(catchups.router,  prefix=API_PREFIX)
app.include_router(slack_bot.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(admin.router,     prefix=API_PREFIX)


@app.get("/api/health")
def health():
    return {"status": "healthy"}