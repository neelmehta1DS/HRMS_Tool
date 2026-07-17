from typing import List
from pydantic_settings import BaseSettings
from pydantic import field_validator

class Settings(BaseSettings):
    DATABASE_URL: str

    DEBUG: bool = False

    APP_BASE_URL: str = "http://localhost:8000"
    # Where users land after a successful Google login.
    FRONTEND_URL: str = "http://localhost:5173"

    ALLOWED_ORIGINS: str = ""

    SECRET_KEY: str
    ALGORITHM: str ="HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    GOOGLE_CLIENT_ID: str
    GOOGLE_CLIENT_SECRET: str

    INTERNAL_API_KEY: str = ""  # shared secret for Slack bot → backend calls

    SLACK_BOT_TOKEN: str = ""
    SLACK_DEMO_MODE: bool = False
    SLACK_DEMO_USER_ID: str = ""
    SLACK_DIGEST_CHANNEL: str = ""  # channel ID for the 9 AM daily digest

    @field_validator("ALLOWED_ORIGINS")
    def parse_allowed_origins(cls, v: str) -> List[str]:
        return v.split(",") if v else []
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"



settings = Settings()