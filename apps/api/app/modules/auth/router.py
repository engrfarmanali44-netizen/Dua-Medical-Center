import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from app.core.config import settings
from fastapi import APIRouter, Depends, HTTPException, Response, Cookie, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import verify_password, hash_password, create_access_token
from app.core.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.models_extra import UserSession
from app.modules.auth.schemas import LoginRequest, TokenResponse
from app.modules.auth.schemas_extra import (
    ChangePasswordRequest,
    AuthMe,
    MobileTokenResponse,
    MobileRefreshRequest,
    MobileLogoutRequest,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _find_login_user(db: Session, name: str) -> User | None:
    """Sign in with username or email (both case-insensitive)."""
    name = name.strip().lower()
    return db.scalar(select(User).where(or_(func.lower(User.username) == name, func.lower(User.email) == name)))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = _find_login_user(db, payload.username)
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    refresh = secrets.token_urlsafe(48)
    refresh_hash = hashlib.sha256(refresh.encode()).hexdigest()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(session)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    response.set_cookie(
        "access_token",
        create_access_token(str(user.id)),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=20 * 60,
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=7 * 24 * 60 * 60,
        path="/api/v1/auth",
    )
    access_token = create_access_token(str(user.id))
    response.set_cookie(
        "access_token",
        access_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=20 * 60,
        path="/",
    )
    return TokenResponse(access_token=access_token)


def _create_mobile_session(user: User, db: Session) -> MobileTokenResponse:
    refresh = secrets.token_urlsafe(48)
    db.add(UserSession(
        user_id=user.id,
        refresh_token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    ))
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return MobileTokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=refresh,
    )


@router.post("/mobile/login", response_model=MobileTokenResponse)
def mobile_login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = _find_login_user(db, payload.username)
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _create_mobile_session(user, db)


@router.post("/mobile/refresh", response_model=MobileTokenResponse)
def mobile_refresh(payload: MobileRefreshRequest, db: Session = Depends(get_db)):
    old_hash = hashlib.sha256(payload.refresh_token.encode()).hexdigest()
    session = db.scalar(select(UserSession).where(
        UserSession.refresh_token_hash == old_hash,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > datetime.now(timezone.utc),
    ).with_for_update())  # lock: a refresh token must be usable exactly once, even under concurrent requests
    if not session:
        raise HTTPException(status_code=401, detail="Refresh session invalid")
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=401, detail="Inactive or unknown user")
    session.revoked_at = datetime.now(timezone.utc)
    return _create_mobile_session(user, db)


@router.post("/mobile/logout")
def mobile_logout(payload: MobileLogoutRequest, db: Session = Depends(get_db)):
    if payload.refresh_token:
        refresh_hash = hashlib.sha256(payload.refresh_token.encode()).hexdigest()
        session = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == refresh_hash))
        if session and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
            db.commit()
    return {"status": "logged_out"}


@router.post("/logout")
def logout(response: Response, refresh_token: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    if refresh_token:
        refresh_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        session = db.scalar(select(UserSession).where(UserSession.refresh_token_hash == refresh_hash))
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            db.commit()
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/v1/auth")
    return {"status": "logged_out"}


@router.post("/refresh", response_model=TokenResponse)
def refresh(response: Response, refresh_token: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh session missing")
    old_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    session = db.scalar(select(UserSession).where(
        UserSession.refresh_token_hash == old_hash,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > datetime.now(timezone.utc),
    ).with_for_update())  # lock: a refresh token must be usable exactly once, even under concurrent requests
    if not session:
        raise HTTPException(status_code=401, detail="Refresh session invalid")
    session.revoked_at = datetime.now(timezone.utc)
    replacement = secrets.token_urlsafe(48)
    replacement_hash = hashlib.sha256(replacement.encode()).hexdigest()
    db.add(UserSession(
        user_id=session.user_id,
        refresh_token_hash=replacement_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    ))
    db.commit()
    access = create_access_token(str(session.user_id))
    response.set_cookie("access_token", access, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=20 * 60, path="/")
    response.set_cookie("refresh_token", replacement, httponly=True, secure=settings.cookie_secure, samesite="lax",
                        max_age=7 * 24 * 60 * 60, path="/api/v1/auth")
    return TokenResponse(access_token=access)


@router.get("/me", response_model=AuthMe)
def me(user: User = Depends(get_current_user)):
    roles = [ur.role.name for ur in user.user_roles]
    permissions = sorted({p.key for ur in user.user_roles for p in ur.role.permissions})
    return AuthMe(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        must_change_password=user.must_change_password,
        roles=roles,
        permissions=permissions,
    )


@router.post("/change-password")
def change_password(payload: ChangePasswordRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    db.query(UserSession).filter(UserSession.user_id == user.id).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    return {"status": "password_changed"}
