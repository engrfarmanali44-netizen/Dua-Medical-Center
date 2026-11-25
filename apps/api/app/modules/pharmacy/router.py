from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.realtime import notify
from app.core.database import get_db
from app.core.dependencies import require_permission
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.models import Invoice
from app.modules.billing.service import PKT, money, today_pkt
from app.modules.pharmacy.models import Medicine, MedicineBatch, Purchase, Sale, StockMovement, Supplier
from app.modules.pharmacy.service import (
    PurchaseLine, SaleLine, batch_on_hand_subquery, post_purchase, post_sale, qty,
)

router = APIRouter(prefix="/pharmacy", tags=["Pharmacy"])


# ------------------------------------------------------------------ schemas

class MedicineIn(BaseModel):
    medicine_code: str = Field(min_length=1, max_length=40)
    generic_name: str = Field(min_length=2, max_length=180)
    brand_name: str | None = Field(default=None, max_length=180)
    strength: str | None = Field(default=None, max_length=80)
    dosage_form: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=80)
    unit: str = Field(default="unit", min_length=1, max_length=30)
    reorder_level: Decimal = Field(default=Decimal("0"), ge=0)


class MedicineUpdate(BaseModel):
    generic_name: str | None = Field(default=None, min_length=2, max_length=180)
    brand_name: str | None = None
    strength: str | None = None
    dosage_form: str | None = None
    category: str | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    reorder_level: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class SupplierIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    contact_person: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    is_active: bool | None = None


class PurchaseLineIn(BaseModel):
    medicine_id: UUID
    batch_number: str = Field(min_length=1, max_length=80)
    expiry_date: date
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    selling_price: Decimal = Field(ge=0)


class PurchaseIn(BaseModel):
    supplier_id: UUID
    supplier_invoice_no: str | None = Field(default=None, max_length=80)
    purchase_date: date | None = None
    notes: str | None = None
    items: list[PurchaseLineIn] = Field(min_length=1)


class SaleLineIn(BaseModel):
    medicine_id: UUID
    quantity: Decimal = Field(gt=0)


class SaleIn(BaseModel):
    patient_id: UUID | None = None
    customer_name: str | None = Field(default=None, max_length=180)
    customer_phone: str | None = Field(default=None, max_length=30)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    paid_amount: Decimal = Field(ge=0)
    payment_method: str | None = None
    items: list[SaleLineIn] = Field(min_length=1)


def _audit(db: Session, actor: User, action: str, entity: str, entity_id, values: dict):
    db.add(AuditLog(actor_user_id=actor.id, action=action, entity_type=entity,
                    entity_id=str(entity_id), new_values=values))


def _medicine_out(m: Medicine, on_hand=None, nearest_expiry=None) -> dict:
    d = {"id": str(m.id), "medicine_code": m.medicine_code, "generic_name": m.generic_name,
         "brand_name": m.brand_name, "strength": m.strength, "dosage_form": m.dosage_form,
         "category": m.category, "unit": m.unit, "reorder_level": str(qty(m.reorder_level)),
         "is_active": m.is_active}
    if on_hand is not None:
        d["on_hand"] = str(qty(on_hand))
        d["low_stock"] = qty(on_hand) <= qty(m.reorder_level)
        d["nearest_expiry"] = nearest_expiry.isoformat() if nearest_expiry else None
    return d


# ------------------------------------------------------------------ medicines

@router.get("/medicines")
def list_medicines(q: str | None = None, include_inactive: bool = False,
                   in_stock_only: bool = False, limit: int = Query(default=200, ge=1, le=500),
                   db: Session = Depends(get_db),
                   user: User = Depends(require_permission("pharmacy.stock.read"))):
    """Catalog with live sellable stock (non-expired batches only)."""
    oh = batch_on_hand_subquery()
    sellable = (select(MedicineBatch.medicine_id,
                       func.coalesce(func.sum(oh.c.on_hand), 0).label("on_hand"),
                       func.min(MedicineBatch.expiry_date).filter(oh.c.on_hand > 0).label("nearest_expiry"))
                .join(oh, oh.c.batch_id == MedicineBatch.id)
                .where(MedicineBatch.expiry_date > today_pkt())
                .group_by(MedicineBatch.medicine_id).subquery())
    stmt = (select(Medicine, func.coalesce(sellable.c.on_hand, 0), sellable.c.nearest_expiry)
            .outerjoin(sellable, sellable.c.medicine_id == Medicine.id)
            .order_by(Medicine.generic_name))
    if not include_inactive:
        stmt = stmt.where(Medicine.is_active.is_(True))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Medicine.generic_name.ilike(like), Medicine.brand_name.ilike(like),
                              Medicine.medicine_code.ilike(like)))
    if in_stock_only:
        stmt = stmt.where(sellable.c.on_hand > 0)
    return [_medicine_out(m, on_hand, exp) for m, on_hand, exp in db.execute(stmt.limit(limit)).all()]


@router.post("/medicines", status_code=status.HTTP_201_CREATED)
def create_medicine(payload: MedicineIn, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("pharmacy.medicines.create"))):
    code = payload.medicine_code.strip().upper()
    if db.scalar(select(Medicine.id).where(Medicine.medicine_code == code)):
        raise HTTPException(status_code=409, detail="Medicine code already exists")
    m = Medicine(**{**payload.model_dump(), "medicine_code": code})
    db.add(m)
    db.flush()
    _audit(db, actor, "CREATE", "MEDICINE", m.id, {"code": code, "name": m.generic_name})
    notify(db, "medicines", "stock")
    db.commit()
    return _medicine_out(m, 0, None)


@router.patch("/medicines/{medicine_id}")
def update_medicine(medicine_id: UUID, payload: MedicineUpdate, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("pharmacy.medicines.manage"))):
    m = db.get(Medicine, medicine_id)
    if not m:
        raise HTTPException(status_code=404, detail="Medicine not found")
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(m, k, v)
    _audit(db, actor, "UPDATE", "MEDICINE", m.id, {k: str(v) for k, v in changes.items()})
    notify(db, "medicines", "stock")
    db.commit()
    return _medicine_out(m)


# ------------------------------------------------------------------ suppliers

def _supplier_out(s: Supplier) -> dict:
    return {"id": str(s.id), "name": s.name, "contact_person": s.contact_person, "phone": s.phone,
            "address": s.address, "is_active": s.is_active}


@router.get("/suppliers")
def list_suppliers(include_inactive: bool = False, db: Session = Depends(get_db),
                   user: User = Depends(require_permission("pharmacy.stock.read"))):
    stmt = select(Supplier).order_by(Supplier.name)
    if not include_inactive:
        stmt = stmt.where(Supplier.is_active.is_(True))
    return [_supplier_out(s) for s in db.scalars(stmt).all()]


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("pharmacy.purchases.create"))):
    if db.scalar(select(Supplier.id).where(func.lower(Supplier.name) == payload.name.strip().lower())):
        raise HTTPException(status_code=409, detail="Supplier already exists")
    s = Supplier(**{**payload.model_dump(), "name": payload.name.strip()})
    db.add(s)
    notify(db, "suppliers")
    db.commit()
    return _supplier_out(s)


@router.patch("/suppliers/{supplier_id}")
def update_supplier(supplier_id: UUID, payload: SupplierUpdate, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("pharmacy.suppliers.manage"))):
    s = db.get(Supplier, supplier_id)
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    notify(db, "suppliers")
    db.commit()
    return _supplier_out(s)


# ------------------------------------------------------------------ purchases

def _purchase_out(p: Purchase, with_items: bool = False) -> dict:
    d = {"id": str(p.id), "purchase_number": p.purchase_number, "supplier_id": str(p.supplier_id),
         "supplier_name": p.supplier.name, "supplier_invoice_no": p.supplier_invoice_no,
         "purchase_date": p.purchase_date.isoformat(), "total_amount": str(money(p.total_amount)),
         "item_count": len(p.items), "notes": p.notes, "created_at": p.created_at.isoformat()}
    if with_items:
        d["items"] = [{"medicine_id": str(i.medicine_id), "medicine_name": i.medicine.generic_name,
                       "strength": i.medicine.strength, "batch_number": i.batch.batch_number,
                       "expiry_date": i.batch.expiry_date.isoformat(), "quantity": str(qty(i.quantity)),
                       "unit_cost": str(money(i.unit_cost)), "selling_price": str(money(i.batch.selling_price)),
                       "line_total": str(money(i.line_total))} for i in p.items]
    return d


@router.get("/purchases")
def list_purchases(supplier_id: UUID | None = None, limit: int = Query(default=100, ge=1, le=500),
                   db: Session = Depends(get_db),
                   user: User = Depends(require_permission("pharmacy.stock.read"))):
    stmt = (select(Purchase).options(selectinload(Purchase.supplier), selectinload(Purchase.items))
            .order_by(Purchase.created_at.desc()).limit(limit))
    if supplier_id:
        stmt = stmt.where(Purchase.supplier_id == supplier_id)
    return [_purchase_out(p) for p in db.scalars(stmt).all()]


@router.get("/purchases/{purchase_id}")
def get_purchase(purchase_id: UUID, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("pharmacy.stock.read"))):
    p = db.scalar(select(Purchase).where(Purchase.id == purchase_id).options(
        selectinload(Purchase.supplier), selectinload(Purchase.items)))
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return _purchase_out(p, with_items=True)


@router.post("/purchases", status_code=status.HTTP_201_CREATED)
def create_purchase(payload: PurchaseIn, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("pharmacy.purchases.create"))):
    p = post_purchase(db, supplier_id=payload.supplier_id, actor_id=actor.id,
                      purchase_date=payload.purchase_date, supplier_invoice_no=payload.supplier_invoice_no,
                      notes=payload.notes, lines=[PurchaseLine(**i.model_dump()) for i in payload.items])
    _audit(db, actor, "CREATE", "PHARMACY_PURCHASE", p.id, {"number": p.purchase_number, "total": str(p.total_amount)})
    notify(db, "purchases", "stock", "medicines")
    db.commit()
    db.refresh(p)
    return _purchase_out(p, with_items=True)


# ------------------------------------------------------------------ stock

@router.get("/stock/batches")
def stock_batches(medicine_id: UUID | None = None, include_empty: bool = False,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_permission("pharmacy.stock.read"))):
    oh = batch_on_hand_subquery()
    stmt = (select(MedicineBatch, Medicine, func.coalesce(oh.c.on_hand, 0))
            .join(Medicine, Medicine.id == MedicineBatch.medicine_id)
            .outerjoin(oh, oh.c.batch_id == MedicineBatch.id)
            .order_by(Medicine.generic_name, MedicineBatch.expiry_date))
    if medicine_id:
        stmt = stmt.where(MedicineBatch.medicine_id == medicine_id)
    if not include_empty:
        stmt = stmt.where(oh.c.on_hand > 0)
    today = today_pkt()
    return [{"batch_id": str(b.id), "medicine_id": str(m.id), "medicine_name": m.generic_name,
             "strength": m.strength, "batch_number": b.batch_number, "expiry_date": b.expiry_date.isoformat(),
             "days_to_expiry": (b.expiry_date - today).days, "expired": b.expiry_date <= today,
             "on_hand": str(qty(on_hand)), "purchase_price": str(money(b.purchase_price)),
             "selling_price": str(money(b.selling_price)),
             "stock_value": str(money(qty(on_hand) * b.purchase_price))}
            for b, m, on_hand in db.execute(stmt).all()]


@router.get("/stock/movements")
def stock_movements(medicine_id: UUID | None = None, limit: int = Query(default=200, ge=1, le=1000),
                    db: Session = Depends(get_db),
                    user: User = Depends(require_permission("pharmacy.stock.read"))):
    stmt = (select(StockMovement, MedicineBatch, Medicine, User.username)
            .join(MedicineBatch, MedicineBatch.id == StockMovement.batch_id)
            .join(Medicine, Medicine.id == MedicineBatch.medicine_id)
            .join(User, User.id == StockMovement.performed_by)
            .order_by(StockMovement.occurred_at.desc()).limit(limit))
    if medicine_id:
        stmt = stmt.where(Medicine.id == medicine_id)
    return [{"id": str(mv.id), "occurred_at": mv.occurred_at.isoformat(), "movement_type": mv.movement_type,
             "medicine_name": m.generic_name, "strength": m.strength, "batch_number": b.batch_number,
             "quantity": str(qty(mv.quantity)), "reference_type": mv.reference_type,
             "reference_id": str(mv.reference_id) if mv.reference_id else None, "performed_by": username}
            for mv, b, m, username in db.execute(stmt).all()]


@router.get("/expiry-alerts")
def expiry_alerts(days: int = Query(default=90, ge=1, le=730), db: Session = Depends(get_db),
                  user: User = Depends(require_permission("pharmacy.stock.read"))):
    """Batches with stock that are expired or expire within `days`."""
    rows = stock_batches(medicine_id=None, include_empty=False, db=db, user=user)
    return [r for r in rows if r["days_to_expiry"] <= days]


# ------------------------------------------------------------------ sales

def _sale_out(s: Sale, invoice_status: str | None = None, with_items: bool = False, sold_by: str | None = None) -> dict:
    status_ = "PAID" if s.patient_id is None else (invoice_status or "UNPAID")
    d = {"id": str(s.id), "sale_number": s.sale_number, "sold_at": s.sold_at.isoformat(),
         "patient_id": str(s.patient_id) if s.patient_id else None, "is_walk_in": s.patient_id is None,
         "customer_name": s.customer_name, "customer_phone": s.customer_phone,
         "subtotal": str(money(s.subtotal)), "discount_amount": str(money(s.discount_amount)),
         "total_amount": str(money(s.total_amount)), "paid_amount": str(money(s.paid_amount)),
         "due_amount": str(money(s.total_amount - s.paid_amount)), "payment_method": s.payment_method,
         "payment_status": status_, "invoice_id": str(s.invoice_id) if s.invoice_id else None,
         "sold_by": sold_by}
    if with_items:
        d["items"] = [{"medicine_name": i.medicine.generic_name, "strength": i.medicine.strength,
                       "batch_number": i.batch.batch_number, "expiry_date": i.batch.expiry_date.isoformat(),
                       "quantity": str(qty(i.quantity)), "unit_price": str(money(i.unit_price)),
                       "line_total": str(money(i.line_total))} for i in s.items]
    return d


@router.get("/sales")
def list_sales(day: date | None = None, patient_id: UUID | None = None,
               limit: int = Query(default=200, ge=1, le=1000), db: Session = Depends(get_db),
               user: User = Depends(require_permission("pharmacy.sales.read"))):
    stmt = (select(Sale, Invoice.status, User.username)
            .outerjoin(Invoice, Invoice.id == Sale.invoice_id)
            .join(User, User.id == Sale.sold_by)
            .order_by(Sale.sold_at.desc()).limit(limit))
    if day:
        start = datetime.combine(day, datetime.min.time(), tzinfo=PKT)
        stmt = stmt.where(Sale.sold_at >= start, Sale.sold_at < start + timedelta(days=1))
    if patient_id:
        stmt = stmt.where(Sale.patient_id == patient_id)
    return [_sale_out(s, inv_status, sold_by=username) for s, inv_status, username in db.execute(stmt).all()]


@router.get("/sales/{sale_id}")
def get_sale(sale_id: UUID, db: Session = Depends(get_db),
             user: User = Depends(require_permission("pharmacy.sales.read"))):
    row = db.execute(select(Sale, Invoice.status, User.username)
                     .outerjoin(Invoice, Invoice.id == Sale.invoice_id)
                     .join(User, User.id == Sale.sold_by)
                     .where(Sale.id == sale_id)
                     .options(selectinload(Sale.items))).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    s, inv_status, username = row
    return _sale_out(s, inv_status, with_items=True, sold_by=username)


@router.post("/sales", status_code=status.HTTP_201_CREATED)
def create_sale(payload: SaleIn, db: Session = Depends(get_db),
                actor: User = Depends(require_permission("pharmacy.sales.create"))):
    s = post_sale(db, lines=[SaleLine(**i.model_dump()) for i in payload.items], actor_id=actor.id,
                  patient_id=payload.patient_id, customer_name=payload.customer_name,
                  customer_phone=payload.customer_phone, discount=payload.discount_amount,
                  paid_amount=payload.paid_amount, payment_method=payload.payment_method)
    _audit(db, actor, "CREATE", "PHARMACY_SALE", s.id, {"number": s.sale_number, "total": str(s.total_amount),
                                                        "paid": str(s.paid_amount)})
    notify(db, "sales", "stock", "medicines", "billing")
    db.commit()
    return get_sale(s.id, db=db, user=actor)
