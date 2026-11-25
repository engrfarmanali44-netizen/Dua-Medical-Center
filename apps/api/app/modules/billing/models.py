import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint("subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0", name="ck_invoice_nonnegative"),
        CheckConstraint("currency = 'PKR'", name="ck_invoice_currency_pkr"),
        CheckConstraint("status IN ('DRAFT','UNPAID','PARTIALLY_PAID','PAID','CANCELLED','VOID')", name="ck_invoice_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="PKR", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    source_module: Mapped[str] = mapped_column(String(40), nullable=False)
    source_reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_positive_amount"),
        CheckConstraint("currency = 'PKR'", name="ck_payment_currency_pkr"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="PKR", nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False)
    reference_number: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30), default="POSTED", nullable=False)
    received_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    __table_args__ = (CheckConstraint("allocated_amount > 0", name="ck_allocation_positive"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id"), nullable=False)
    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"), nullable=False)
    allocated_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class DocumentSequence(Base):
    """Gap-free, concurrency-safe counters for human-readable document numbers (row-locked on use)."""
    __tablename__ = "document_sequences"
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
