"""Staff requests: leave (Admin AND HR must approve) and advance payments (Admin approves)."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

LEAVE_TYPES = ("CASUAL", "SICK", "ANNUAL", "OTHER")
DECISIONS = ("PENDING", "APPROVED", "REJECTED")


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="ck_leave_dates"),
        CheckConstraint("leave_type IN ('CASUAL','SICK','ANNUAL','OTHER')", name="ck_leave_type"),
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','CANCELLED')", name="ck_leave_status"),
        CheckConstraint("admin_decision IN ('PENDING','APPROVED','REJECTED')", name="ck_leave_admin_decision"),
        CheckConstraint("hr_decision IN ('PENDING','APPROVED','REJECTED')", name="ck_leave_hr_decision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    leave_type: Mapped[str] = mapped_column(String(20), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # Overall: APPROVED only when BOTH Admin and HR approved; REJECTED as soon as either rejects.
    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False, index=True)
    admin_decision: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)
    admin_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    admin_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    admin_comment: Mapped[str | None] = mapped_column(String(500))
    hr_decision: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)
    hr_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    hr_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hr_comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AdvanceRequest(Base):
    __tablename__ = "advance_requests"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_advance_amount"),
        CheckConstraint("approved_amount IS NULL OR approved_amount > 0", name="ck_advance_approved_amount"),
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','PAID','CANCELLED')", name="ck_advance_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False, index=True)
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_comment: Mapped[str | None] = mapped_column(String(500))
    paid_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_method: Mapped[str | None] = mapped_column(String(30))
    payment_reference: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
