from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator

GENDERS = ("MALE", "FEMALE", "OTHER")
BLOOD_GROUPS = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
USERNAME_PATTERN = r"^[A-Za-z0-9._@-]{3,80}$"


class PortalLogin(BaseModel):
    """Login for the patient portal (see own visits, reports, dues; chat with doctor/admin)."""
    username: str = Field(min_length=3, max_length=80, pattern=USERNAME_PATTERN)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("username")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class PatientCreate(BaseModel):
    # Leave empty to have the system issue the next MRN (e.g. MRN-2026-000001).
    mrn: str | None = Field(default=None, min_length=3, max_length=40)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    age: int | None = Field(default=None, ge=0, le=130)
    gender: str | None = Field(default=None, pattern="^(MALE|FEMALE|OTHER)$")
    blood_group: str | None = Field(default=None, pattern="^(A|B|AB|O)[+-]$")
    phone: str = Field(min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = None
    login: PortalLogin | None = None


class PatientUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    age: int | None = Field(default=None, ge=0, le=130)
    gender: str | None = Field(default=None, pattern="^(MALE|FEMALE|OTHER)$")
    blood_group: str | None = Field(default=None, pattern="^(A|B|AB|O)[+-]$")
    phone: str | None = Field(default=None, min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = None


class PasswordIn(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class PatientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    mrn: str
    first_name: str
    last_name: str | None
    age: int | None
    gender: str | None
    blood_group: str | None
    phone: str
    email: str | None
    address: str | None
    created_at: datetime
    login_username: str | None = None
    login_active: bool | None = None
