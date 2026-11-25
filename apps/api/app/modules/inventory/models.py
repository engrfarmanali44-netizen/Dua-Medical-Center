"""Hospital inventory (non-medicine items: chairs, tables, stools, beds, equipment...). Managed by HR / Admin."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

ASSET_CATEGORIES = ("FURNITURE", "EQUIPMENT", "ELECTRONICS", "LINEN", "OTHER")
ASSET_CONDITIONS = ("GOOD", "NEEDS_REPAIR", "DAMAGED")


class AssetItem(Base):
    __tablename__ = "asset_items"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_asset_quantity"),
        CheckConstraint("category IN ('FURNITURE','EQUIPMENT','ELECTRONICS','LINEN','OTHER')", name="ck_asset_category"),
        CheckConstraint("condition IN ('GOOD','NEEDS_REPAIR','DAMAGED')", name="ck_asset_condition"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    location: Mapped[str | None] = mapped_column(String(160))  # ward / room / department
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit: Mapped[str] = mapped_column(String(30), default="piece", nullable=False)
    condition: Mapped[str] = mapped_column(String(20), default="GOOD", nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    purchase_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AssetAdjustment(Base):
    """History: every quantity / condition / location change, with a reason."""
    __tablename__ = "asset_adjustments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("asset_items.id", ondelete="CASCADE"), nullable=False, index=True)
    change: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # + added, - removed
    quantity_after: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(String(500), nullable=False)
    performed_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
