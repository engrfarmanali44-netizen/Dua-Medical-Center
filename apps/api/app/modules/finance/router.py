"""Cash management and profit & loss.

finance.read             Admin, Accountant (view only, as the client asked)
finance.expenses.manage  Admin (record / delete expenses)

Cash book (money actually received / paid out in the period)
  IN : patient payments (counter + store sales to patients), walk-in medical store sales
  OUT: expenses, staff advances paid, medicine purchases from suppliers
Profit & loss (what was earned in the period)
  Revenue = medical store sales + other patient charges (invoices that are not store sales)
  Cost of medicines sold = sold quantity x batch purchase price
  Net = revenue - cost of medicines sold - expenses - staff advances paid
"""
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.core.realtime import notify
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.models import Invoice, Payment
from app.modules.billing.service import PAYMENT_METHODS, PKT, money, next_number, patient_outstanding, today_pkt
from app.modules.finance.models import EXPENSE_CATEGORIES, Expense
from app.modules.pharmacy.models import MedicineBatch, Purchase, Sale, SaleItem
from app.modules.requests.models import AdvanceRequest

router = APIRouter(prefix="/finance", tags=["Cash & profit/loss"])


class ExpenseIn(BaseModel):
    expense_date: date | None = None
    category: str
    description: str = Field(min_length=2, max_length=300)
    amount: Decimal = Field(gt=0, le=Decimal("100000000"))
    payment_method: str = "CASH"
    paid_to: str | None = Field(default=None, max_length=160)
    reference: str | None = Field(default=None, max_length=100)


def _period(start: date | None, end: date | None) -> tuple[date, date]:
    t = today_pkt()
    start = start or t.replace(day=1)
    end = end or date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
    if end < start:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    if (end - start).days > 366:
        raise HTTPException(status_code=400, detail="Choose a period of at most one year")
    return start, end


def _bounds(start: date, end: date):
    return datetime.combine(start, time.min, tzinfo=PKT), datetime.combine(end + timedelta(days=1), time.min, tzinfo=PKT)


def _day(dt: datetime) -> str:
    return dt.astimezone(PKT).date().isoformat()


def _exp_out(e: Expense, by: str | None = None) -> dict:
    return {"id": str(e.id), "expense_number": e.expense_number, "expense_date": e.expense_date.isoformat(), "category": e.category,
            "description": e.description, "amount": str(money(e.amount)), "payment_method": e.payment_method,
            "paid_to": e.paid_to, "reference": e.reference, "recorded_by": by, "created_at": e.created_at.isoformat()}


@router.get("/expenses")
def list_expenses(start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                  db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    start, end = _period(start, end)
    rows = db.execute(select(Expense, User.username).join(User, User.id == Expense.recorded_by)
                      .where(Expense.expense_date.between(start, end)).order_by(Expense.expense_date.desc(), Expense.created_at.desc())).all()
    return [_exp_out(e, u) for e, u in rows]


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
def add_expense(payload: ExpenseIn, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    if payload.category not in EXPENSE_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid expense category")
    if payload.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    d = payload.expense_date or today_pkt()
    if d > today_pkt():
        raise HTTPException(status_code=400, detail="An expense cannot be in the future")
    e = Expense(expense_number=next_number(db, "EXP"), expense_date=d, category=payload.category, description=payload.description.strip(),
                amount=money(payload.amount), payment_method=payload.payment_method, paid_to=(payload.paid_to or "").strip() or None,
                reference=(payload.reference or "").strip() or None, recorded_by=user.id)
    db.add(e)
    db.flush()
    db.add(AuditLog(actor_user_id=user.id, action="CREATE", entity_type="EXPENSE", entity_id=str(e.id), new_values={"amount": str(e.amount), "category": e.category}))
    notify(db, "finance")
    db.commit()
    return _exp_out(e, user.username)


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.add(AuditLog(actor_user_id=user.id, action="DELETE", entity_type="EXPENSE", entity_id=str(e.id),
                    old_values={"amount": str(e.amount), "category": e.category, "description": e.description}))
    db.delete(e)
    notify(db, "finance")
    db.commit()
    return {"status": "deleted"}


@router.get("/summary")
def summary(start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
            db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    start, end = _period(start, end)
    t0, t1 = _bounds(start, end)
    zero = Decimal("0")
    days = defaultdict(lambda: {"in": zero, "out": zero})
    in_by_method, out_by_method = defaultdict(lambda: zero), defaultdict(lambda: zero)

    # ---- money in
    patient_payments = zero
    for p in db.scalars(select(Payment).where(Payment.status == "POSTED", Payment.received_at >= t0, Payment.received_at < t1)):
        patient_payments += p.amount; in_by_method[p.payment_method] += p.amount; days[_day(p.received_at)]["in"] += p.amount
    walkin = zero
    for s in db.scalars(select(Sale).where(Sale.patient_id.is_(None), Sale.sold_at >= t0, Sale.sold_at < t1, Sale.paid_amount > 0)):
        walkin += s.paid_amount; in_by_method[s.payment_method or "CASH"] += s.paid_amount; days[_day(s.sold_at)]["in"] += s.paid_amount

    # ---- money out
    exp_by_cat = defaultdict(lambda: zero)
    expenses_total = zero
    for e in db.scalars(select(Expense).where(Expense.expense_date.between(start, end))):
        expenses_total += e.amount; exp_by_cat[e.category] += e.amount; out_by_method[e.payment_method] += e.amount
        days[e.expense_date.isoformat()]["out"] += e.amount
    advances = zero
    for a in db.scalars(select(AdvanceRequest).where(AdvanceRequest.status == "PAID", AdvanceRequest.paid_at >= t0, AdvanceRequest.paid_at < t1)):
        amt = a.approved_amount or a.amount
        advances += amt; out_by_method[a.payment_method or "CASH"] += amt; days[_day(a.paid_at)]["out"] += amt
    purchases = zero
    for pu in db.scalars(select(Purchase).where(Purchase.purchase_date.between(start, end))):
        purchases += pu.total_amount; out_by_method["SUPPLIER"] += pu.total_amount; days[pu.purchase_date.isoformat()]["out"] += pu.total_amount

    cash_in = patient_payments + walkin
    cash_out = expenses_total + advances + purchases

    # ---- profit & loss
    store_sales = money(db.scalar(select(func.coalesce(func.sum(Sale.total_amount), 0)).where(Sale.sold_at >= t0, Sale.sold_at < t1)))
    store_invoice_ids = select(Sale.invoice_id).where(Sale.invoice_id.is_not(None))
    other_charges = money(db.scalar(select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(
        Invoice.invoice_date.between(start, end), Invoice.status.not_in(("DRAFT", "CANCELLED", "VOID")), Invoice.id.not_in(store_invoice_ids))))
    cogs = money(db.scalar(select(func.coalesce(func.sum(SaleItem.quantity * MedicineBatch.purchase_price), 0))
                           .join(Sale, Sale.id == SaleItem.sale_id).join(MedicineBatch, MedicineBatch.id == SaleItem.batch_id)
                           .where(Sale.sold_at >= t0, Sale.sold_at < t1)))
    revenue = store_sales + other_charges
    gross = revenue - cogs
    net = gross - expenses_total - advances

    # outstanding patient dues right now (all patients with open invoices)
    open_patients = db.scalars(select(Invoice.patient_id).where(Invoice.status.in_(("UNPAID", "PARTIALLY_PAID"))).distinct()).all()
    outstanding = sum((patient_outstanding(db, pid) for pid in open_patients), zero)

    d, series = start, []
    while d <= end:
        v = days.get(d.isoformat(), {"in": zero, "out": zero})
        series.append({"date": d.isoformat(), "in": str(money(v["in"])), "out": str(money(v["out"]))})
        d += timedelta(days=1)
    m = lambda x: str(money(x))
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "cash": {"in": m(cash_in), "out": m(cash_out), "net": m(cash_in - cash_out),
                 "in_breakdown": {"patient_payments": m(patient_payments), "walk_in_store_sales": m(walkin)},
                 "out_breakdown": {"expenses": m(expenses_total), "staff_advances": m(advances), "medicine_purchases": m(purchases)},
                 "in_by_method": {k: m(v) for k, v in sorted(in_by_method.items())},
                 "out_by_method": {k: m(v) for k, v in sorted(out_by_method.items())}},
        "profit_loss": {"store_sales": m(store_sales), "other_patient_charges": m(other_charges), "revenue": m(revenue),
                        "cost_of_medicines_sold": m(cogs), "gross_profit": m(gross),
                        "expenses_by_category": {k: m(exp_by_cat.get(k, zero)) for k in EXPENSE_CATEGORIES},
                        "expenses": m(expenses_total), "staff_advances": m(advances), "net_profit": m(net)},
        "outstanding_dues": m(outstanding),
        "daily": series,
    }
