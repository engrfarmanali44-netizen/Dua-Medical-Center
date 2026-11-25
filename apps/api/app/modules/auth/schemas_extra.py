from uuid import UUID
from pydantic import BaseModel, Field


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=12, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class AuthMe(BaseModel):
    id: UUID
    username: str
    email: str | None = None
    is_active: bool
    is_superuser: bool
    must_change_password: bool
    roles: list[str]
    permissions: list[str]


class MobileTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MobileRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=256)


class MobileLogoutRequest(BaseModel):
    refresh_token: str | None = Field(default=None, min_length=32, max_length=256)
