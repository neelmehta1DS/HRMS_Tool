from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Cookie
from fastapi.responses import RedirectResponse, Response
from sqlalchemy.orm import Session
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import Flow

from core.config import settings
from core.security import create_jwt, get_current_user
from db.database import get_db
from models.users import User
from schemas.users import UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

ALLOWED_DOMAIN = "1digitalstack.ai"

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.file",
]


def get_flow() -> Flow:
    client_config = {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [f"{settings.APP_BASE_URL}/auth/oauth2callback"],
        }
    }
    return Flow.from_client_config(
        client_config=client_config,
        scopes=SCOPES,
        redirect_uri=f"{settings.APP_BASE_URL}/auth/oauth2callback",
    )


@router.get("/login")
def login(request: Request):
    flow = get_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    request.session["code_verifier"] = flow.code_verifier
    request.session["state"] = state
    return RedirectResponse(auth_url)


@router.get("/oauth2callback")
def oauth2callback(
    request: Request,
    db: Session = Depends(get_db),
    code: Optional[str] = None,
    error: Optional[str] = None,
):
    if error or not code:
        raise HTTPException(status_code=400, detail="Google OAuth failed or was denied")

    flow = get_flow()
    flow.code_verifier = request.session.get("code_verifier")
    flow.fetch_token(authorization_response=str(request.url))
    creds = flow.credentials

    for scope in SCOPES:
        if scope not in creds.granted_scopes:
            raise HTTPException(
                status_code=403,
                detail=f"Required scope not granted: {scope}. Please allow all permissions."
            )

    service = build("oauth2", "v2", credentials=creds)
    user_info = service.userinfo().get().execute()
    email = user_info["email"]
    name = user_info["name"]

    if not email.endswith(f"@{ALLOWED_DOMAIN}"):
        raise HTTPException(
            status_code=403,
            detail=f"Only @{ALLOWED_DOMAIN} accounts are allowed"
        )

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            name=name,
            role="Employee",
            refresh_token=creds.refresh_token,
        )
        db.add(user)
    else:
        if creds.refresh_token:
            user.refresh_token = creds.refresh_token

    db.commit()
    db.refresh(user)

    token = create_jwt(user.id)
    response = RedirectResponse(settings.FRONTEND_URL)
    response.set_cookie(
        key="jwt_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,
    )
    return response


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(
        key="jwt_token",
        httponly=True,
        secure=False,
        samesite="lax",
    )
    return {"message": "Logged out"}


#FOR TESTING PURPOSES ONLY: This endpoint allows developers to log in as any user by providing their email. It should only be used in development mode and should not be exposed in production.

@router.post("/dev-login")
def dev_login(email: str, response: Response, db: Session = Depends(get_db)):
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not found")
    
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    token = create_jwt(user.id)
    response.set_cookie(
        key="jwt_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax", 
        max_age=60 * 60 * 24 * 7,
    )
    return {"message": "Logged in", "user": user.email}