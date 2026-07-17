from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from core.config import settings


_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

# Boilerplate code for database connection and session management using SQLAlchemy
engine = create_engine(
    settings.DATABASE_URL,
    # check_same_thread is a SQLite-only flag; Postgres drivers reject it.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    # Managed Postgres (e.g. Supabase) drops idle connections; pre-ping checks a
    # connection is still alive before use so requests don't hit stale sockets.
    # (Measured: on the transaction pooler this ping is cheap — removing it saved
    # nothing — so the staleness safety is kept.)
    pool_pre_ping=not _is_sqlite,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()