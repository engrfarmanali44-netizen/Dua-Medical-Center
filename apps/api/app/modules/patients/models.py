import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Optional
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.modules.auth.models import User


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mrn: Mapped[str] = mapped_column(String(40), unique=True, nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str | None] = mapped_column(String(100))
    # Age as told at the counter, and the date it was recorded; the current age counts up from there.
    age_years: Mapped[int | None] = mapped_column(Integer)
    age_recorded_on: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(30))
    blood_group: Mapped[str | None] = mapped_column(String(5))
    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    user: Mapped[Optional["User"]] = relationship("User", lazy="joined")

    @property
    def age(self) -> int | None:
        if self.age_years is None:
            return None
        if not self.age_recorded_on:
            return self.age_years
        today = date.today()
        passed = today.year - self.age_recorded_on.year - ((today.month, today.day) < (self.age_recorded_on.month, self.age_recorded_on.day))
        return self.age_years + max(passed, 0)

    @property
    def login_username(self) -> str | None:
        return self.user.username if self.user else None

    @property
    def login_active(self) -> bool | None:
        return self.user.is_active if self.user else None


class PatientAllergy(Base):
    __tablename__ = "patient_allergies"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id", ondelete="CASCADE"), nullable=False)
    allergy_name: Mapped[str] = mapped_column(String(160), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(30))
    reaction: Mapped[str | None] = mapped_column(Text)
    recorded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
