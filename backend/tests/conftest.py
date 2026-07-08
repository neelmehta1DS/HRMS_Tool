import pytest
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from fastapi import Depends
from fastapi.testclient import TestClient
from unittest.mock import patch

from db.database import Base, get_db
from models.users import User
from core.security import get_current_user

# ---------------------------------------------------------------------------
# Test database
# ---------------------------------------------------------------------------
# StaticPool forces every session/connection to reuse the same underlying
# SQLite connection, so data committed by one session is immediately visible
# to another — essential for sharing an in-memory database across the test
# session and the route handlers that use their own sessions.
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def reset_schema():
    """Drop and recreate all tables before each test for clean isolation."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db(reset_schema):
    """A direct DB session the test can use to set up state or inspect results."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def mock_slack():
    """Prevent any real Slack API calls from firing during tests."""
    with patch("core.slack.dm", return_value=None), \
         patch("core.slack.delete_msg", return_value=None):
        yield


# ---------------------------------------------------------------------------
# User fixtures (three-level hierarchy: ic → manager → skip_manager)
# ---------------------------------------------------------------------------

@pytest.fixture
def skip_manager(db):
    u = User(email="skip@test.com", name="Skip Manager", role="VP")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def manager(db, skip_manager):
    u = User(email="mgr@test.com", name="Manager", role="Senior Engineer",
             manager_id=skip_manager.id)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def ic(db, manager):
    u = User(email="ic@test.com", name="IC User", role="Engineer",
             manager_id=manager.id)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u



# ---------------------------------------------------------------------------
# Client factory
# ---------------------------------------------------------------------------

@pytest.fixture
def client_as(db):
    """
    Factory fixture.  Call client_as(user) to get a TestClient that acts as
    that user.  Each call overwrites app.dependency_overrides, so make the
    request immediately after calling client_as(user).

    Two dependencies are overridden:
      - get_db       → sessions backed by the in-memory test engine
      - get_current_user → re-fetches the user from the test DB by ID so that
                           lazy-loaded relationships work in the route's own
                           session (avoids DetachedInstanceError)
    """
    from main import app

    def _make(user: User) -> TestClient:
        uid = user.id

        def override_get_db():
            session = TestingSessionLocal()
            try:
                yield session
            finally:
                session.close()

        # Uses Depends(get_db) so FastAPI injects the overridden test session,
        # keeping the user attached to the route's own session.
        def override_get_current_user(session: Session = Depends(get_db)):
            return session.query(User).filter(User.id == uid).first()

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_current_user] = override_get_current_user
        return TestClient(app, raise_server_exceptions=True)

    yield _make
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def future_date(days: int = 30) -> str:
    """Return a date string N calendar days from today (satisfies advance-notice rules)."""
    return str(date.today() + timedelta(days=days))


def today_str() -> str:
    return str(date.today())
