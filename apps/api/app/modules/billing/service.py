"""Billing rules shared by every module that charges patients (pharmacy, lab, OPD, ...).

Money is always Decimal, rounded to 2 places. An invoice's status is derived from what has
been allocated to it, never set by hand:
    allocated == 0           -> UNPAID
    0 < allocated < total    -> PARTIALLY_PAID
    allocated >= total       -> PAID
"""
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.billing.models import (
    DocumentSequence, Invoice, InvoiceItem, Payment, PaymentAllocation,
)

PKT = timezone(timedelta(hours=5), name="PKT")
OPEN_INVOICE_STATUSES = ("UNPAID", "PARTIALLY_PAID")
PAYMENT_METHODS = ("CASH", "CARD", "BANK_TRANSFER", "EASYPAISA", "JAZZCASH", "CHEQUE")
CENT = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def today_pkt() -> date:
    return datetime.now(PKT).date()


def next_number(db: Session, prefix: str) -> str:
    """Return e.g. 'PS-2026-000042'. Row lock makes it safe under concurrent requests."""
    year = today_pkt().year
    key = f"{prefix}-{year}"
    seq = db.execute(select(DocumentSequence).where(DocumentSequence.name == key).with_for_update()).scalar_one_or_none()
    if seq is None:
        seq = DocumentSequence(name=key, last_value=0)
        db.add(seq)
        db.flush()
        seq = db.execute(select(DocumentSequence).where(DocumentSequence.name == key).with_for_update()).scalar_one()
    seq.last_value += 1
    return f"{key}-{seq.last_value:06d}"


def allocated_amount(db: Session, invoice_id: uuid.UUID) -> Decimal:
    return money(db.scalar(
        select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
        .join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(PaymentAllocation.invoice_id == invoice_id, Payment.status == "POSTED")))


def refresh_invoice_status(db: Session, invoice: Invoice) -> None:
    if invoice.status in ("DRAFT", "CANCELLED", "VOID"):
        return
    paid = allocated_amount(db, invoice.id)
    if paid <= 0:
        invoice.status = "UNPAID"
    elif paid < money(invoice.total_amount):
        invoice.status = "PARTIALLY_PAID"
    else:
        invoice.status = "PAID"


@dataclass
class ChargeLine:
    source_module: str
    description: str
    quantity: Decimal
    unit_price: Decimal
    source_reference_id: uuid.UUID | None = None


def create_invoice(db: Session, patient_id: uuid.UUID, lines: Iterable[ChargeLine],
                   discount: Decimal = Decimal("0"), notes: str | None = None) -> Invoice:
    lines = list(lines)
    subtotal = money(sum((money(l.quantity * l.unit_price) for l in lines), Decimal("0")))
    discount = money(discount)
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the subtotal")
    invoice = Invoice(invoice_number=next_number(db, "INV"), patient_id=patient_id,
                      invoice_date=today_pkt(), subtotal=subtotal, discount_amount=discount,
                      tax_amount=Decimal("0"), total_amount=subtotal - discount,
                      status="UNPAID", notes=notes)
    db.add(invoice)
    db.flush()
    for l in lines:
        db.add(InvoiceItem(invoice_id=invoice.id, source_module=l.source_module,
                           source_reference_id=l.source_reference_id, description=l.description[:255],
                           quantity=l.quantity, unit_price=money(l.unit_price),
                           line_total=money(l.quantity * l.unit_price)))
    if invoice.total_amount == 0:
        invoice.status = "PAID"
    return invoice


def patient_outstanding(db: Session, patient_id: uuid.UUID) -> Decimal:
    invoiced = money(db.scalar(select(func.coalesce(func.sum(Invoice.total_amount), 0))
                               .where(Invoice.patient_id == patient_id,
                                      Invoice.status.in_(OPEN_INVOICE_STATUSES))))
    allocated = money(db.scalar(
        select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
        .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
        .join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(Invoice.patient_id == patient_id, Invoice.status.in_(OPEN_INVOICE_STATUSES),
               Payment.status == "POSTED")))
    return max(invoiced - allocated, Decimal("0"))


def record_payment(db: Session, *, patient_id: uuid.UUID, amount: Decimal, method: str,
                   received_by: uuid.UUID, invoice_id: uuid.UUID | None = None,
                   reference_number: str | None = None) -> Payment:
    """Record a payment and allocate it to one invoice, or to the oldest open invoices first.

    Overpayment is rejected: the hospital does not hold patient credit balances.
    """
    amount = money(amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"Payment method must be one of {', '.join(PAYMENT_METHODS)}")

    stmt = (select(Invoice).where(Invoice.patient_id == patient_id,
                                  Invoice.status.in_(OPEN_INVOICE_STATUSES))
            .order_by(Invoice.invoice_date, Invoice.created_at).with_for_update())
    if invoice_id is not None:
        stmt = stmt.where(Invoice.id == invoice_id)
    invoices = list(db.scalars(stmt).all())
    if invoice_id is not None and not invoices:
        raise HTTPException(status_code=400, detail="Invoice is not open for payment for this patient")

    dues = [(inv, money(inv.total_amount) - allocated_amount(db, inv.id)) for inv in invoices]
    total_due = sum((d for _, d in dues), Decimal("0"))
    if amount > total_due:
        raise HTTPException(status_code=400, detail=f"Payment exceeds the outstanding amount of PKR {total_due:,.2f}")

    payment = Payment(receipt_number=next_number(db, "RCPT"), patient_id=patient_id, amount=amount,
                      payment_method=method, reference_number=reference_number,
                      status="POSTED", received_by=received_by)
    db.add(payment)
    db.flush()
    remaining = amount
    for inv, due in dues:
        if remaining <= 0:
            break
        portion = min(due, remaining)
        if portion <= 0:
            continue
        db.add(PaymentAllocation(payment_id=payment.id, invoice_id=inv.id, allocated_amount=portion))
        remaining -= portion
    db.flush()
    for inv, _ in dues:
        refresh_invoice_status(db, inv)
    return payment
