"""Patient visits (client requirement).

A patient comes with a problem -> a treatment CASE is opened with Visit 1. Each later visit for the
same problem is Visit 2, 3, ... When the patient recovers the case is FINALIZED (read-only).
Each visit records the problem, the doctor's analysis, the medicines given, and uploaded files
(photo of the prescription slip, lab reports).
"""
import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

CASE_STATUSES = ("OPEN", "FINALIZED")
ATTACHMENT_KINDS = ("SLIP", "LAB_REPORT", "OTHER")


class PatientCase(Base):
    __tablename__ = "patient_cases"
    __table_args__ = (CheckConstraint("status IN ('OPEN','FINALIZED')", name="ck_case_status"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)  # main problem, e.g. "Fever and cough"
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False)
    opened_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finalized_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    final_notes: Mapped[str | None] = mapped_column(Text)
    visits: Mapped[list["Visit"]] = relationship(back_populates="case", order_by="Visit.visit_number",
                                                 cascade="all, delete-orphan")


class Visit(Base):
    __tablename__ = "patient_visits"
    __table_args__ = (UniqueConstraint("case_id", "visit_number", name="uq_visit_case_number"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True)
    visit_number: Mapped[int] = mapped_column(Integer, nullable=False)
    visit_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    doctor_employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    complaint: Mapped[str | None] = mapped_column(Text)   # what the patient says the problem is
    analysis: Mapped[str | None] = mapped_column(Text)    # doctor's examination / diagnosis
    notes: Mapped[str | None] = mapped_column(Text)
    follow_up_date: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    case: Mapped[PatientCase] = relationship(back_populates="visits")
    medicines: Mapped[list["VisitMedicine"]] = relationship(order_by="VisitMedicine.position", cascade="all, delete-orphan")
    attachments: Mapped[list["VisitAttachment"]] = relationship(order_by="VisitAttachment.created_at", cascade="all, delete-orphan")


class VisitMedicine(Base):
    """A medicine given / prescribed on a visit. Linked to the store catalog when picked from it."""
    __tablename__ = "visit_medicines"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_visits.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    medicine_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("medicines.id"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    dosage: Mapped[str | None] = mapped_column(String(80))       # e.g. "1 tablet", "5 ml"
    frequency: Mapped[str | None] = mapped_column(String(80))    # e.g. "3 times a day"
    duration: Mapped[str | None] = mapped_column(String(80))     # e.g. "5 days"
    instructions: Mapped[str | None] = mapped_column(String(255))  # e.g. "after meals"


class VisitAttachment(Base):
    """Uploaded file (stored privately in cloud storage; opened through short-lived signed links)."""
    __tablename__ = "visit_attachments"
    __table_args__ = (CheckConstraint("kind IN ('SLIP','LAB_REPORT','OTHER')", name="ck_attachment_kind"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patient_visits.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
