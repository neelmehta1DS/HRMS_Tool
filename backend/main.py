from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config import settings
from core.scheduled_tasks import reset_annual_leave_counts, reset_daily_statuses, send_morning_digest
from core.time import IST
from db.database import Base, SessionLocal, engine
from routes import auth, users, leaves, catchups, slack_bot, dashboard, admin

from seed.seed_users import seed_users

if settings.DEBUG:
    import os
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

# Create all tables on startup
Base.metadata.create_all(bind=engine)


def _migrate():
    from sqlalchemy import text
    with engine.connect() as conn:
        users_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
        for col, definition in [
            ("stepping_out_from", "TIME"),
            ("stepping_out_to",   "TIME"),
        ]:
            if col not in users_cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {definition}"))

        # OUT is no longer a valid office_status value — convert existing rows to NULL
        conn.execute(text("UPDATE users SET office_status = NULL WHERE office_status = 'OUT'"))

        leaves_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(leaves)"))}
        if "is_exception" not in leaves_cols:
            conn.execute(text("ALTER TABLE leaves ADD COLUMN is_exception INTEGER NOT NULL DEFAULT 0"))

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


_migrate()


@asynccontextmanager
async def lifespan(app):
    scheduler = AsyncIOScheduler()
    # Pinned to IST rather than inherited from the system clock: on a UTC host
    # the daily reset would otherwise wipe everyone's status at 11:30 IST.
    scheduler.add_job(reset_annual_leave_counts, CronTrigger(month=1, day=1, hour=0, minute=0, timezone=IST))
    scheduler.add_job(reset_daily_statuses, CronTrigger(hour=6, minute=0, timezone=IST))
    scheduler.add_job(send_morning_digest, CronTrigger(hour=8, minute=0, timezone=IST))
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

# Routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(leaves.router)
app.include_router(catchups.router)
app.include_router(slack_bot.router)
app.include_router(dashboard.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "healthy"}