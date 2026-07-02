from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from core.config import settings
from db.database import Base, SessionLocal, engine
from routes import auth, users, leaves, catchups, slack_bot, dashboard

from seed.seed_users import seed_users  

if settings.DEBUG:
    import os
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

# Create all tables on startup
Base.metadata.create_all(bind=engine)

# Add leave-balance columns if they don't exist yet (SQLite doesn't support IF NOT EXISTS for columns)
def _migrate():
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(__import__("sqlalchemy").text("PRAGMA table_info(users)"))}
        for col, definition in [
            ("sick_leaves_taken",   "INTEGER NOT NULL DEFAULT 0"),
            ("casual_leaves_taken", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            if col not in existing:
                conn.execute(__import__("sqlalchemy").text(f"ALTER TABLE users ADD COLUMN {col} {definition}"))
        conn.commit()

_migrate()

@asynccontextmanager
async def lifespan(app):
    if settings.DEBUG:
        db = SessionLocal()
        try:
            seed_users(db)
        finally:
            db.close()

    yield


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


@app.get("/health")
def health():
    return {"status": "healthy"}