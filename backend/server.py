# Entry point expected by supervisor (`uvicorn server:app`).
# The FastAPI application lives in main.py; this module simply re-exports it.
from main import app

__all__ = ["app"]
