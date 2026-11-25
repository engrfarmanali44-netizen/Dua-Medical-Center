"""Pharmacy stock rules: purchases add stock, sales consume it first-expiry-first-out (FEFO)."""
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.modules.billing.service import ChargeLine, create_invoice, money, next_number, record_payment, today_pkt
from app.modules.patients.models import Patient
from app.modules.pharmacy.models import (
    INBOUND_MOVEMENTS, MAIN_PHARMACY_LOCATION, OUTBOUND_MOVEMENTS, InventoryLocation, Medicine,
    MedicineBatch, Purchase, PurchaseItem, Sale, SaleItem, StockMovement, Supplier,
)

QTY = Decimal("0.001")

# Signed quantity of a movement: + for inbound, - for outbound.
signed_qty = case(
    (StockMovement.movement_type.in_(INBOUND_MOVEMENTS), StockMovement.quantity),
    else_=-StockMovement.quantity,
)


def qty(value) -> Decimal:
    return Decimal(value or 0).quantize(QTY)


def main_location(db: Session) -> InventoryLocation:
    loc = db.scalar(select(InventoryLocation).where(InventoryLocation.code == MAIN_PHARMACY_LOCATION))
    if loc is None:
        loc = InventoryLocation(code=MAIN_PHARMACY_LOCATION, name="Main Pharmacy")
        db.add(loc)
        db.flush()
    return loc


def batch_on_hand_subquery():
    return (select(StockMovement.batch_id, func.coalesce(func.sum(signed_qty), 0).label("on_hand"))
            .group_by(StockMovement.batch_id).subquery())


def batch_on_hand(db: Session, batch_id: uuid.UUID) -> Decimal:
    return qty(db.scalar(select(func.coalesce(func.sum(signed_qty), 0)).where(StockMovement.batch_id == batch_id)))


# ------------------------------------------------------------------ purchases

@dataclass
class PurchaseLine:
    medicine_id: uuid.UUID
    batch_number: str
    expiry_date: date
    quantity: Decimal
    unit_cost: Decimal
    selling_price: Decimal


def post_purchase(db: Session, *, supplier_id: uuid.UUID, lines: list[PurchaseLine], actor_id: uuid.UUID,
                  purchase_date: date | None = None, supplier_invoice_no: str | None = None,
                  notes: str | None = None) -> Purchase:
    supplier = db.get(Supplier, supplier_id)
    if not supplier or not supplier.is_active:
        raise HTTPException(status_code=400, detail="Supplier not found or inactive")
    if not lines:
        raise HTTPException(status_code=400, detail="A purchase needs at least one item")

    location = main_location(db)
    purchase = Purchase(purchase_number=next_number(db, "PO"), supplier_id=supplier_id,
                        supplier_invoice_no=supplier_invoice_no, purchase_date=purchase_date or today_pkt(),
                        total_amount=Decimal("0"), notes=notes, created_by=actor_id)
    db.add(purchase)
    db.flush()
    total = Decimal("0")
    for line in lines:
        medicine = db.get(Medicine, line.medicine_id)
        if not medicine:
            raise HTTPException(status_code=400, detail="Unknown medicine in purchase")
        if line.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantity for {medicine.generic_name} must be positive")
        if line.expiry_date <= today_pkt():
            raise HTTPException(status_code=400, detail=f"Batch {line.batch_number} of {medicine.generic_name} is already expired")
        batch_number = line.batch_number.strip()
        batch = db.scalar(select(MedicineBatch).where(MedicineBatch.medicine_id == medicine.id,
                                                      MedicineBatch.batch_number == batch_number))
        if batch is None:
            batch = MedicineBatch(medicine_id=medicine.id, batch_number=batch_number, expiry_date=line.expiry_date,
                                  purchase_price=money(line.unit_cost), selling_price=money(line.selling_price))
            db.add(batch)
            db.flush()
        else:
            if batch.expiry_date != line.expiry_date:
                raise HTTPException(status_code=400, detail=f"Batch {batch_number} already exists with expiry {batch.expiry_date}")
            batch.purchase_price = money(line.unit_cost)
            batch.selling_price = money(line.selling_price)
        line_total = money(line.quantity * line.unit_cost)
        total += line_total
        db.add(PurchaseItem(purchase_id=purchase.id, medicine_id=medicine.id, batch_id=batch.id,
                            quantity=qty(line.quantity), unit_cost=money(line.unit_cost), line_total=line_total))
        db.add(StockMovement(batch_id=batch.id, location_id=location.id, movement_type="RECEIPT",
                             quantity=qty(line.quantity), reference_type="PURCHASE",
                             reference_id=purchase.id, performed_by=actor_id))
    purchase.total_amount = money(total)
    return purchase


# ------------------------------------------------------------------ sales

@dataclass
class SaleLine:
    medicine_id: uuid.UUID
    quantity: Decimal


def _allocate_fefo(db: Session, medicine: Medicine, wanted: Decimal) -> list[tuple[MedicineBatch, Decimal]]:
    """Lock the medicine's sellable batches and pick quantities, earliest expiry first."""
    batches = list(db.scalars(
        select(MedicineBatch)
        .where(MedicineBatch.medicine_id == medicine.id, MedicineBatch.expiry_date > today_pkt())
        .order_by(MedicineBatch.expiry_date, MedicineBatch.created_at)
        .with_for_update()).all())
    picks: list[tuple[MedicineBatch, Decimal]] = []
    remaining = wanted
    available_total = Decimal("0")
    for batch in batches:
        available = batch_on_hand(db, batch.id)
        available_total += max(available, Decimal("0"))
        if remaining > 0 and available > 0:
            take = min(available, remaining)
            picks.append((batch, take))
            remaining -= take
    if remaining > 0:
        raise HTTPException(status_code=409,
                            detail=f"Not enough stock for {medicine.generic_name}: requested {wanted.normalize():f}, "
                                   f"available {available_total.normalize():f}")
    return picks


def post_sale(db: Session, *, lines: list[SaleLine], actor_id: uuid.UUID, patient_id: uuid.UUID | None,
              customer_name: str | None, customer_phone: str | None, discount: Decimal,
              paid_amount: Decimal, payment_method: str | None) -> Sale:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one medicine to the sale")
    patient = None
    if patient_id is not None:
        patient = db.get(Patient, patient_id)
        if not patient:
            raise HTTPException(status_code=400, detail="Patient not found")

    location = main_location(db)
    # Merge duplicate medicines so the stock check sees the full requested quantity.
    merged: dict[uuid.UUID, Decimal] = {}
    for line in lines:
        if line.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantities must be positive")
        merged[line.medicine_id] = merged.get(line.medicine_id, Decimal("0")) + qty(line.quantity)

    items: list[SaleItem] = []
    for medicine_id, wanted in merged.items():
        medicine = db.get(Medicine, medicine_id)
        if not medicine or not medicine.is_active:
            raise HTTPException(status_code=400, detail="Unknown or inactive medicine in sale")
        for batch, take in _allocate_fefo(db, medicine, wanted):
            items.append(SaleItem(medicine_id=medicine.id, batch_id=batch.id, quantity=take,
                                  unit_price=money(batch.selling_price),
                                  line_total=money(take * batch.selling_price)))

    subtotal = money(sum((i.line_total for i in items), Decimal("0")))
    discount = money(discount)
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot exceed the subtotal")
    total = subtotal - discount
    paid = money(paid_amount)
    if paid > total:
        raise HTTPException(status_code=400, detail="Paid amount cannot exceed the total")
    if patient is None and paid != total:
        raise HTTPException(status_code=400, detail="Walk-in sales must be paid in full. Select a registered patient to add a due.")
    if paid > 0 and not payment_method:
        raise HTTPException(status_code=400, detail="Choose a payment method")

    sale = Sale(sale_number=next_number(db, "PS"), patient_id=patient_id,
                customer_name=customer_name or (f"{patient.first_name} {patient.last_name or ''}".strip() if patient else None),
                customer_phone=customer_phone or (patient.phone if patient else None),
                subtotal=subtotal, discount_amount=discount, total_amount=total, paid_amount=paid,
                payment_method=payment_method if paid > 0 else None, sold_by=actor_id, items=items)
    db.add(sale)
    db.flush()
    for item in items:
        db.add(StockMovement(batch_id=item.batch_id, location_id=location.id, movement_type="SALE",
                             quantity=item.quantity, reference_type="PHARMACY_SALE",
                             reference_id=sale.id, performed_by=actor_id))

    if patient is not None:
        names = {m.id: m for m in db.scalars(select(Medicine).where(Medicine.id.in_(merged.keys())))}
        invoice = create_invoice(
            db, patient.id,
            [ChargeLine("PHARMACY", f"{names[i.medicine_id].generic_name} {names[i.medicine_id].strength or ''}".strip(),
                        i.quantity, i.unit_price, sale.id) for i in items],
            discount=discount, notes=f"Pharmacy sale {sale.sale_number}")
        sale.invoice_id = invoice.id
        db.flush()
        if paid > 0:
            record_payment(db, patient_id=patient.id, amount=paid, method=payment_method,
                           received_by=actor_id, invoice_id=invoice.id)
    return sale
