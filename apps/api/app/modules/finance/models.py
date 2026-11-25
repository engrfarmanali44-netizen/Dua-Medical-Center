"""Hospital expenses (for cash management and profit & loss). Recorded by Admin, viewed by Accountant."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

EXPENSE_CATEGORIES = ("SALARIES", "UTILITIES", "RENT", "MAINTENANCE", "SUPPLIES", "EQUIPMENT", "TRANSPORT", "OTHER")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_expense_amount"),
        CheckConstraint("category IN ('SALARIES','UTILITIES','RENT','MAINTENANCE','SUPPLIES','EQUIPMENT','TRANSPORT','OTHER')", name="ck_expense_category"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False)
    paid_to: Mapped[str | None] = mapped_column(String(160))
    reference: Mapped[str | None] = mapped_column(String(100))
    recorded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# Money received that does not come through invoices or the medical store.
# CAPITAL and OPENING_BALANCE are cash put into the hospital: they count as money in but are not revenue.
INCOME_CATEGORIES = ("CONSULTATION", "LAB", "PROCEDURE", "DONATION", "RENT_RECEIVED", "CAPITAL", "OPENING_BALANCE", "OTHER")
NON_REVENUE_INCOME = ("CAPITAL", "OPENING_BALANCE")


class OtherIncome(Base):
    __tablename__ = "other_incomes"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_income_amount"),
        CheckConstraint("category IN ('CONSULTATION','LAB','PROCEDURE','DONATION','RENT_RECEIVED','CAPITAL','OPENING_BALANCE','OTHER')", name="ck_income_category"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    income_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    income_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False)
    received_from: Mapped[str | None] = mapped_column(String(160))
    reference: Mapped[str | None] = mapped_column(String(100))
    recorded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
