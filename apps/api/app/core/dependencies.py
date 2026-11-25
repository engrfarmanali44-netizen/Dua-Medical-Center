from collections.abc import Callable
from fastapi import Depends, HTTPException, status, Cookie
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.security import decode_access_token
from app.modules.auth.models import User, UserRole, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        token = access_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise InvalidTokenError("Missing subject")
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user = db.scalar(
        select(User)
        .options(selectinload(User.user_roles).selectinload(UserRole.role).selectinload(Role.permissions))
        .where(User.id == user_id, User.is_active.is_(True))
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or unknown user")
    return user


def require_permission(permission_key: str) -> Callable:
    def dependency(user: User = Depends(get_current_user)) -> User:
        granted = {
            permission.key
            for user_role in user.user_roles
            for permission in user_role.role.permissions
        }
        if permission_key not in granted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
        return user
    return dependency


def granted_permissions(user: User) -> set[str]:
    return {p.key for ur in user.user_roles for p in ur.role.permissions}


def require_permissions(*permission_keys: str) -> Callable:
    """Like require_permission, but the user must hold ALL of the given permissions."""
    def dependency(user: User = Depends(get_current_user)) -> User:
        if not set(permission_keys) <= granted_permissions(user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")
        return user
    return dependency
