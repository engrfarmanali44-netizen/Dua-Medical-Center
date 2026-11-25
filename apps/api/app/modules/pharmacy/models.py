import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

# Stock is a ledger: on-hand quantity = sum(inbound movements) - sum(outbound movements).
INBOUND_MOVEMENTS = ("RECEIPT", "RETURN", "TRANSFER_IN", "ADJUSTMENT_IN")
OUTBOUND_MOVEMENTS = ("SALE", "ISSUE", "TRANSFER_OUT", "ADJUSTMENT_OUT", "EXPIRED", "DAMAGE")
MAIN_PHARMACY_LOCATION = "MAIN-PHARMACY"


class Medicine(Base):
    __tablename__ = "medicines"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    medicine_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    generic_name: Mapped[str] = mapped_column(String(180), nullable=False)
    brand_name: Mapped[str | None] = mapped_column(String(180))
    strength: Mapped[str | None] = mapped_column(String(80))
    dosage_form: Mapped[str | None] = mapped_column(String(80))
    category: Mapped[str | None] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(30), default="unit", server_default="unit", nullable=False)
    reorder_level: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0, server_default="0", nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class MedicineBatch(Base):
    __tablename__ = "medicine_batches"
    __table_args__ = (
        CheckConstraint("purchase_price >= 0 AND selling_price >= 0", name="ck_batch_prices_nonnegative"),
        UniqueConstraint("medicine_id", "batch_number", name="uq_batch_medicine_number"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    medicine_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicines.id"), nullable=False)
    batch_number: Mapped[str] = mapped_column(String(80), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryLocation(Base):
    __tablename__ = "inventory_locations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    department_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("departments.id"))


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_stock_movement_positive_qty"),
        CheckConstraint("movement_type IN ('RECEIPT','SALE','ISSUE','RETURN','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT','EXPIRED','DAMAGE')", name="ck_stock_movement_type"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicine_batches.id"), nullable=False)
    location_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("inventory_locations.id"), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(30), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    reference_type: Mapped[str | None] = mapped_column(String(50))
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    performed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), unique=True, nullable=False)
    contact_person: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Purchase(Base):
    """Goods received from a supplier. Posting a purchase writes RECEIPT stock movements."""
    __tablename__ = "pharmacy_purchases"
    __table_args__ = (CheckConstraint("total_amount >= 0", name="ck_purchase_total_nonnegative"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    supplier_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("suppliers.id"), nullable=False)
    supplier_invoice_no: Mapped[str | None] = mapped_column(String(80))
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    supplier: Mapped[Supplier] = relationship()
    items: Mapped[list["PurchaseItem"]] = relationship(cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "pharmacy_purchase_items"
    __table_args__ = (CheckConstraint("quantity > 0 AND unit_cost >= 0", name="ck_purchase_item_values"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    purchase_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pharmacy_purchases.id", ondelete="CASCADE"), nullable=False)
    medicine_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicines.id"), nullable=False)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicine_batches.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    medicine: Mapped[Medicine] = relationship()
    batch: Mapped[MedicineBatch] = relationship()


class Sale(Base):
    """A pharmacy sale. Walk-in sales are paid in full; patient sales are billed to an invoice."""
    __tablename__ = "pharmacy_sales"
    __table_args__ = (
        CheckConstraint("subtotal >= 0 AND discount_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0", name="ck_sale_nonnegative"),
        CheckConstraint("paid_amount <= total_amount", name="ck_sale_paid_le_total"),
        CheckConstraint("patient_id IS NOT NULL OR paid_amount = total_amount", name="ck_sale_walkin_paid_in_full"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sale_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.id"))
    customer_name: Mapped[str | None] = mapped_column(String(180))
    customer_phone: Mapped[str | None] = mapped_column(String(30))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(30))
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"))
    sold_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    items: Mapped[list["SaleItem"]] = relationship(cascade="all, delete-orphan")


class SaleItem(Base):
    __tablename__ = "pharmacy_sale_items"
    __table_args__ = (CheckConstraint("quantity > 0 AND unit_price >= 0", name="ck_sale_item_values"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sale_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pharmacy_sales.id", ondelete="CASCADE"), nullable=False)
    medicine_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicines.id"), nullable=False)
    batch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("medicine_batches.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    medicine: Mapped[Medicine] = relationship()
    batch: Mapped[MedicineBatch] = relationship()
