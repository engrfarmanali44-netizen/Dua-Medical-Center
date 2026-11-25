"""Daily staff attendance, marked by HR / Admin (client requirement)."""
import uuid
from datetime import date, datetime, time

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, String, Time, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

ATTENDANCE_STATUSES = ("PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_attendance_employee_day"),
        CheckConstraint("status IN ('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE')", name="ck_attendance_status"),
        CheckConstraint("check_out IS NULL OR check_in IS NULL OR check_out >= check_in", name="ck_attendance_times"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    check_in: Mapped[time | None] = mapped_column(Time)
    check_out: Mapped[time | None] = mapped_column(Time)
    note: Mapped[str | None] = mapped_column(String(255))
    marked_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
