import uuid
from typing import TYPE_CHECKING, Optional
from datetime import date, datetime, time
from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric,
    String, Text, Time, UniqueConstraint, func, text
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

if TYPE_CHECKING:
    from app.modules.auth.models import User


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), unique=True)
    department_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"), nullable=False)
    employee_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    designation: Mapped[str] = mapped_column(String(100), nullable=False)
    employment_status: Mapped[str] = mapped_column(String(30), default="ACTIVE", nullable=False)
    joining_date: Mapped[date | None] = mapped_column(Date)
    # Pakistani CNIC, stored as 13 digits without dashes (shown as 12345-1234567-1).
    cnic: Mapped[str | None] = mapped_column(String(13), unique=True)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user: Mapped[Optional["User"]] = relationship("User", lazy="joined")
    department: Mapped[Department] = relationship(lazy="joined")


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HospitalSettings(Base):
    __tablename__ = "hospital_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("hospitals.id"), unique=True, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="PKR", nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Karachi", nullable=False)
    locale: Mapped[str] = mapped_column(String(20), default="en", nullable=False)


TASK_STATUSES = ("PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED")
TASK_PRIORITIES = ("LOW", "NORMAL", "HIGH", "URGENT")


class StaffTask(Base):
    """A daily task for ONE staff member (assigning to several people creates one task each)."""
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')", name="ck_task_status"),
        CheckConstraint("priority IN ('LOW','NORMAL','HIGH','URGENT')", name="ck_task_priority"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", nullable=False)
    priority: Mapped[str] = mapped_column(String(30), default="NORMAL", nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # legacy, unused
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_note: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TaskAssignment(Base):
    __tablename__ = "task_assignments"
    __table_args__ = (UniqueConstraint("task_id", "assignee_user_id", name="uq_task_assignment"),)

    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    assignee_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
