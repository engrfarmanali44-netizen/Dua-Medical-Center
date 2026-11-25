from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.realtime import notify
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.models import Invoice, InvoiceItem, Payment, PaymentAllocation
from app.modules.billing.service import (
    OPEN_INVOICE_STATUSES, PAYMENT_METHODS, allocated_amount, money, patient_outstanding, record_payment,
)
from app.modules.patients.models import Patient

router = APIRouter(prefix="/billing", tags=["Billing"])


class PaymentIn(BaseModel):
    patient_id: UUID
    amount: Decimal = Field(gt=0)
    payment_method: str
    invoice_id: UUID | None = None
    reference_number: str | None = Field(default=None, max_length=100)


def _patient_name(p: Patient) -> str:
    return f"{p.first_name} {p.last_name or ''}".strip()


def _invoice_out(db: Session, inv: Invoice, patient: Patient | None = None, with_items: bool = False) -> dict:
    paid = allocated_amount(db, inv.id)
    d = {"id": str(inv.id), "invoice_number": inv.invoice_number, "invoice_date": inv.invoice_date.isoformat(),
         "patient_id": str(inv.patient_id), "subtotal": str(money(inv.subtotal)),
         "discount_amount": str(money(inv.discount_amount)), "total_amount": str(money(inv.total_amount)),
         "paid_amount": str(paid), "balance": str(max(money(inv.total_amount) - paid, Decimal("0"))),
         "status": inv.status, "notes": inv.notes}
    if patient:
        d.update(patient_name=_patient_name(patient), patient_mrn=patient.mrn, patient_phone=patient.phone)
    if with_items:
        d["items"] = [{"description": i.description, "source_module": i.source_module,
                       "quantity": str(i.quantity.normalize()), "unit_price": str(money(i.unit_price)),
                       "line_total": str(money(i.line_total))}
                      for i in db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id == inv.id)).all()]
        d["payments"] = [{"receipt_number": p.receipt_number, "received_at": p.received_at.isoformat(),
                          "payment_method": p.payment_method, "allocated_amount": str(money(a.allocated_amount))}
                         for a, p in db.execute(select(PaymentAllocation, Payment)
                                                .join(Payment, Payment.id == PaymentAllocation.payment_id)
                                                .where(PaymentAllocation.invoice_id == inv.id)
                                                .order_by(Payment.received_at)).all()]
    return d


def _payment_out(p: Payment, patient: Patient | None = None, received_by: str | None = None) -> dict:
    d = {"id": str(p.id), "receipt_number": p.receipt_number, "patient_id": str(p.patient_id),
         "amount": str(money(p.amount)), "payment_method": p.payment_method,
         "reference_number": p.reference_number, "status": p.status, "received_at": p.received_at.isoformat(),
         "received_by": received_by}
    if patient:
        d.update(patient_name=_patient_name(patient), patient_mrn=patient.mrn)
    return d


def _account(db: Session, patient: Patient) -> dict:
    invoices = db.scalars(select(Invoice).where(Invoice.patient_id == patient.id)
                          .order_by(Invoice.invoice_date.desc(), Invoice.created_at.desc())).all()
    payments = db.scalars(select(Payment).where(Payment.patient_id == patient.id)
                          .order_by(Payment.received_at.desc())).all()
    billed = sum((money(i.total_amount) for i in invoices if i.status not in ("DRAFT", "CANCELLED", "VOID")), Decimal("0"))
    paid = sum((money(p.amount) for p in payments if p.status == "POSTED"), Decimal("0"))
    return {"patient": {"id": str(patient.id), "mrn": patient.mrn, "name": _patient_name(patient),
                        "phone": patient.phone},
            "summary": {"total_billed": str(money(billed)), "total_paid": str(money(paid)),
                        "outstanding": str(patient_outstanding(db, patient.id)),
                        "open_invoices": sum(1 for i in invoices if i.status in OPEN_INVOICE_STATUSES)},
            "invoices": [_invoice_out(db, i) for i in invoices],
            "payments": [_payment_out(p) for p in payments]}


@router.get("/payment-methods")
def payment_methods(user: User = Depends(get_current_user)):
    return list(PAYMENT_METHODS)


@router.get("/invoices")
def list_invoices(status_: str | None = Query(default=None, alias="status"), patient_id: UUID | None = None,
                  q: str | None = None, limit: int = Query(default=200, ge=1, le=1000),
                  db: Session = Depends(get_db), user: User = Depends(require_permission("billing.read"))):
    stmt = (select(Invoice, Patient).join(Patient, Patient.id == Invoice.patient_id)
            .order_by(Invoice.invoice_date.desc(), Invoice.created_at.desc()).limit(limit))
    if status_ == "OPEN":
        stmt = stmt.where(Invoice.status.in_(OPEN_INVOICE_STATUSES))
    elif status_:
        stmt = stmt.where(Invoice.status == status_)
    if patient_id:
        stmt = stmt.where(Invoice.patient_id == patient_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Invoice.invoice_number.ilike(like), Patient.mrn.ilike(like),
                              Patient.first_name.ilike(like), Patient.last_name.ilike(like), Patient.phone.ilike(like)))
    return [_invoice_out(db, inv, p) for inv, p in db.execute(stmt).all()]


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: UUID, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    inv = db.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    patient = db.get(Patient, inv.patient_id)
    granted = {p.key for ur in user.user_roles for p in ur.role.permissions}
    if "billing.read" not in granted and patient.user_id != user.id:
        raise HTTPException(status_code=403, detail="Permission denied")
    return _invoice_out(db, inv, patient, with_items=True)


@router.get("/payments")
def list_payments(patient_id: UUID | None = None, limit: int = Query(default=200, ge=1, le=1000),
                  db: Session = Depends(get_db), user: User = Depends(require_permission("billing.read"))):
    stmt = (select(Payment, Patient, User.username).join(Patient, Patient.id == Payment.patient_id)
            .join(User, User.id == Payment.received_by)
            .order_by(Payment.received_at.desc()).limit(limit))
    if patient_id:
        stmt = stmt.where(Payment.patient_id == patient_id)
    return [_payment_out(p, pt, u) for p, pt, u in db.execute(stmt).all()]


@router.post("/payments", status_code=status.HTTP_201_CREATED)
def create_payment(payload: PaymentIn, db: Session = Depends(get_db),
                   actor: User = Depends(require_permission("billing.payments.create"))):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    payment = record_payment(db, patient_id=patient.id, amount=payload.amount, method=payload.payment_method,
                             received_by=actor.id, invoice_id=payload.invoice_id,
                             reference_number=payload.reference_number)
    db.add(AuditLog(actor_user_id=actor.id, action="CREATE", entity_type="PAYMENT", entity_id=str(payment.id),
                    new_values={"receipt": payment.receipt_number, "amount": str(payment.amount)}))
    notify(db, "billing")
    db.commit()
    return _payment_out(payment, patient, actor.username)


@router.get("/dues")
def dues(q: str | None = None, db: Session = Depends(get_db),
         user: User = Depends(require_permission("billing.read"))):
    """Patients with an outstanding balance, largest first."""
    paid_per_invoice = (select(PaymentAllocation.invoice_id,
                               func.sum(PaymentAllocation.allocated_amount).label("paid"))
                        .join(Payment, Payment.id == PaymentAllocation.payment_id)
                        .where(Payment.status == "POSTED")
                        .group_by(PaymentAllocation.invoice_id).subquery())
    balance = func.sum(Invoice.total_amount - func.coalesce(paid_per_invoice.c.paid, 0))
    stmt = (select(Patient, balance.label("balance"), func.count(Invoice.id), func.min(Invoice.invoice_date))
            .join(Invoice, Invoice.patient_id == Patient.id)
            .outerjoin(paid_per_invoice, paid_per_invoice.c.invoice_id == Invoice.id)
            .where(Invoice.status.in_(OPEN_INVOICE_STATUSES))
            .group_by(Patient.id).having(balance > 0).order_by(balance.desc()))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.mrn.ilike(like), Patient.first_name.ilike(like),
                              Patient.last_name.ilike(like), Patient.phone.ilike(like)))
    return [{"patient_id": str(p.id), "mrn": p.mrn, "name": _patient_name(p), "phone": p.phone,
             "outstanding": str(money(bal)), "open_invoices": n, "oldest_invoice_date": oldest.isoformat()}
            for p, bal, n, oldest in db.execute(stmt).all()]


@router.get("/patients/{patient_id}/account")
def patient_account(patient_id: UUID, db: Session = Depends(get_db),
                    user: User = Depends(require_permission("billing.read"))):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return _account(db, patient)


@router.get("/me/account")
def my_account(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A logged-in patient's own invoices, payments and balance."""
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if not patient:
        raise HTTPException(status_code=404, detail="No patient record is linked to this account")
    return _account(db, patient)
