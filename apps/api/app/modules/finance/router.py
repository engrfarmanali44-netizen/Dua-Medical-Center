"""Cash management and profit & loss.

finance.read             Admin, Accountant (view only, as the client asked)
finance.expenses.manage  Admin (record / delete expenses and other income)

Cash book (money actually received / paid out)
  IN : patient payments (counter + store sales to patients), walk-in medical store sales, other income
  OUT: expenses, staff advances paid, medicine purchases from suppliers
Profit & loss (what was earned in the period)
  Revenue = medical store sales + other patient charges (invoices that are not store sales)
            + other income (except capital / opening cash, which is not earned)
  Cost of medicines sold = sold quantity x batch purchase price
  Net = revenue - cost of medicines sold - expenses - staff advances paid

Totals are computed with grouped SQL sums (a few queries however much data there is); the
transactions list is the only place that loads individual rows, and it is limited to 3 months.
"""
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import Date, cast, func, literal_column, select, union_all
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.core.realtime import notify
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.models import Invoice, Payment, PaymentAllocation
from app.modules.billing.service import OPEN_INVOICE_STATUSES, PAYMENT_METHODS, PKT, money, next_number, today_pkt
from app.modules.finance.models import EXPENSE_CATEGORIES, INCOME_CATEGORIES, NON_REVENUE_INCOME, Expense, OtherIncome
from app.modules.hospital.models import Employee
from app.modules.patients.models import Patient
from app.modules.pharmacy.models import MedicineBatch, Purchase, Sale, SaleItem, Supplier
from app.modules.requests.models import AdvanceRequest

router = APIRouter(prefix="/finance", tags=["Cash & profit/loss"])
ZERO = Decimal("0")
TX_MAX_DAYS = 92


class EntryIn(BaseModel):
    entry_date: date | None = Field(default=None, alias="expense_date")
    category: str
    description: str = Field(min_length=2, max_length=300)
    amount: Decimal = Field(gt=0, le=Decimal("100000000"))
    payment_method: str = "CASH"
    party: str | None = Field(default=None, alias="paid_to", max_length=160)
    reference: str | None = Field(default=None, max_length=100)
    model_config = {"populate_by_name": True}


class IncomeIn(BaseModel):
    income_date: date | None = None
    category: str
    description: str = Field(min_length=2, max_length=300)
    amount: Decimal = Field(gt=0, le=Decimal("100000000"))
    payment_method: str = "CASH"
    received_from: str | None = Field(default=None, max_length=160)
    reference: str | None = Field(default=None, max_length=100)


# ---------------------------------------------------------------- helpers
def _period(start: date | None, end: date | None, max_days: int = 366) -> tuple[date, date]:
    t = today_pkt()
    start = start or t.replace(day=1)
    end = end or date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
    if end < start:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    if (end - start).days >= max_days:
        raise HTTPException(status_code=400, detail=f"Choose a period of at most {max_days} days")
    return start, end


def _ts(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=PKT)


def _pkt_day(col):
    return cast(func.timezone("Asia/Karachi", col), Date)


def _check_entry(category: str, allowed, method: str, d: date) -> None:
    if category not in allowed:
        raise HTTPException(status_code=400, detail="Invalid category")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    if d > today_pkt():
        raise HTTPException(status_code=400, detail="The date cannot be in the future")


def _flows(db: Session, start: date | None, end: date, by_day: bool = True) -> list[tuple[str, str, str, str | None, Decimal]]:
    """Every rupee received or paid, grouped as (part, IN/OUT, method, day, amount).

    start=None means "from the very beginning" (used for cash in hand and opening balances).
    Purchases do not record how the supplier was paid, so their method is "SUPPLIER".
    """
    t1 = _ts(end + timedelta(days=1))
    t0 = _ts(start) if start else None
    parts = []  # one grouped SELECT per source, sent to the database as a single UNION ALL (one round trip)

    def run(part, direction, amount, method, day, conds):
        m = func.coalesce(method, literal_column("'CASH'")) if method is not None else literal_column("'SUPPLIER'")
        d = day if by_day else literal_column("NULL::date")
        grp = ([m] if method is not None else []) + ([d] if by_day else [])
        stmt = select(literal_column(f"'{part}'").label("part"), literal_column(f"'{direction}'").label("dir"),
                      m.label("method"), d.label("day"), func.coalesce(func.sum(amount), 0).label("amount")).where(*conds)
        parts.append(stmt.group_by(*grp) if grp else stmt)

    def ts_range(col):
        return [col < t1] + ([col >= t0] if t0 else [])

    def d_range(col):
        return [col <= end] + ([col >= start] if start else [])

    run("patient_payments", "IN", Payment.amount, Payment.payment_method, _pkt_day(Payment.received_at),
        [Payment.status == "POSTED", *ts_range(Payment.received_at)])
    run("walk_in_store_sales", "IN", Sale.paid_amount, Sale.payment_method, _pkt_day(Sale.sold_at),
        [Sale.patient_id.is_(None), Sale.paid_amount > 0, *ts_range(Sale.sold_at)])
    run("other_income", "IN", OtherIncome.amount, OtherIncome.payment_method, OtherIncome.income_date, d_range(OtherIncome.income_date))
    run("expenses", "OUT", Expense.amount, Expense.payment_method, Expense.expense_date, d_range(Expense.expense_date))
    run("staff_advances", "OUT", func.coalesce(AdvanceRequest.approved_amount, AdvanceRequest.amount), AdvanceRequest.payment_method,
        _pkt_day(AdvanceRequest.paid_at), [AdvanceRequest.status == "PAID", AdvanceRequest.paid_at.is_not(None), *ts_range(AdvanceRequest.paid_at)])
    run("medicine_purchases", "OUT", Purchase.total_amount, None, Purchase.purchase_date, d_range(Purchase.purchase_date))
    return [(r.part, r.dir, r.method, r.day.isoformat() if r.day else None, Decimal(r.amount))
            for r in db.execute(union_all(*parts)).all() if r.amount and Decimal(r.amount) != 0]


def _net(flows) -> Decimal:
    return sum((a if d == "IN" else -a for _, d, _, _, a in flows), ZERO)


def _cash(flows) -> dict:
    parts = defaultdict(lambda: ZERO)
    by_m = {"IN": defaultdict(lambda: ZERO), "OUT": defaultdict(lambda: ZERO)}
    tot = {"IN": ZERO, "OUT": ZERO}
    for part, d, m, _, a in flows:
        parts[part] += a; by_m[d][m] += a; tot[d] += a
    s = lambda x: str(money(x))
    return {"in": s(tot["IN"]), "out": s(tot["OUT"]), "net": s(tot["IN"] - tot["OUT"]),
            "in_breakdown": {k: s(parts[k]) for k in ("patient_payments", "walk_in_store_sales", "other_income")},
            "out_breakdown": {k: s(parts[k]) for k in ("expenses", "staff_advances", "medicine_purchases")},
            "in_by_method": {k: s(v) for k, v in sorted(by_m["IN"].items())},
            "out_by_method": {k: s(v) for k, v in sorted(by_m["OUT"].items())}}


def _profit_loss(db: Session, start: date, end: date) -> dict:
    t0, t1 = _ts(start), _ts(end + timedelta(days=1))
    store_invoice_ids = select(Sale.invoice_id).where(Sale.invoice_id.is_not(None))
    sub = lambda stmt: stmt.scalar_subquery()
    # all single totals in one round trip
    store_sales, other_charges, cogs, advances = (money(v) for v in db.execute(select(
        sub(select(func.coalesce(func.sum(Sale.total_amount), 0)).where(Sale.sold_at >= t0, Sale.sold_at < t1)),
        sub(select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(
            Invoice.invoice_date.between(start, end), Invoice.status.not_in(("DRAFT", "CANCELLED", "VOID")), Invoice.id.not_in(store_invoice_ids))),
        sub(select(func.coalesce(func.sum(SaleItem.quantity * MedicineBatch.purchase_price), 0))
            .join(Sale, Sale.id == SaleItem.sale_id).join(MedicineBatch, MedicineBatch.id == SaleItem.batch_id)
            .where(Sale.sold_at >= t0, Sale.sold_at < t1)),
        sub(select(func.coalesce(func.sum(func.coalesce(AdvanceRequest.approved_amount, AdvanceRequest.amount)), 0))
            .where(AdvanceRequest.status == "PAID", AdvanceRequest.paid_at >= t0, AdvanceRequest.paid_at < t1)),
    )).one())
    # income and expenses by category, also in one round trip
    inc_by_cat, exp_by_cat = {}, {}
    for kind, cat, amt in db.execute(union_all(
            select(literal_column("'I'").label("k"), OtherIncome.category, func.sum(OtherIncome.amount))
            .where(OtherIncome.income_date.between(start, end)).group_by(OtherIncome.category),
            select(literal_column("'E'").label("k"), Expense.category, func.sum(Expense.amount))
            .where(Expense.expense_date.between(start, end)).group_by(Expense.category))).all():
        (inc_by_cat if kind == "I" else exp_by_cat)[cat] = Decimal(amt)
    other_income = money(sum((v for k, v in inc_by_cat.items() if k not in NON_REVENUE_INCOME), ZERO))
    capital = money(sum((v for k, v in inc_by_cat.items() if k in NON_REVENUE_INCOME), ZERO))
    expenses = money(sum(exp_by_cat.values(), ZERO))
    revenue = store_sales + other_charges + other_income
    gross = revenue - cogs
    net = gross - expenses - advances
    s = lambda x: str(money(x))
    return {"store_sales": s(store_sales), "other_patient_charges": s(other_charges), "other_income": s(other_income),
            "income_by_category": {k: s(inc_by_cat.get(k, ZERO)) for k in INCOME_CATEGORIES if k not in NON_REVENUE_INCOME},
            "capital_added": s(capital), "revenue": s(revenue), "cost_of_medicines_sold": s(cogs), "gross_profit": s(gross),
            "expenses_by_category": {k: s(exp_by_cat.get(k, ZERO)) for k in EXPENSE_CATEGORIES},
            "expenses": s(expenses), "staff_advances": s(advances), "net_profit": s(net)}


def _outstanding(db: Session) -> Decimal:
    invoiced, allocated = (money(v) for v in db.execute(select(
        select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(Invoice.status.in_(OPEN_INVOICE_STATUSES)).scalar_subquery(),
        select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
        .join(Invoice, Invoice.id == PaymentAllocation.invoice_id).join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(Invoice.status.in_(OPEN_INVOICE_STATUSES), Payment.status == "POSTED").scalar_subquery())).one())
    return max(invoiced - allocated, ZERO)


# ---------------------------------------------------------------- summary, cash in hand, transactions
@router.get("/summary")
def summary(start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
            lite: bool = False, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    """Cash book + profit & loss for a period (default: this month). lite=true skips the daily series and dues
    (used for the 'compared with previous period' figures)."""
    start, end = _period(start, end)
    flows = _flows(db, start, end, by_day=not lite)
    out = {"period": {"from": start.isoformat(), "to": end.isoformat()}, "cash": _cash(flows), "profit_loss": _profit_loss(db, start, end)}
    if lite:
        return out
    days = defaultdict(lambda: {"IN": ZERO, "OUT": ZERO})
    for _, d, _, day, a in flows:
        days[day][d] += a
    series, d = [], start
    while d <= end:
        v = days.get(d.isoformat(), {"IN": ZERO, "OUT": ZERO})
        series.append({"date": d.isoformat(), "in": str(money(v["IN"])), "out": str(money(v["OUT"]))})
        d += timedelta(days=1)
    out["daily"] = series
    out["outstanding_dues"] = str(money(_outstanding(db)))
    return out


@router.get("/balance")
def balance(db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    """Money the hospital should have right now, per payment method (everything in minus everything out, all time)."""
    by_m = defaultdict(lambda: ZERO)
    flows = _flows(db, None, today_pkt(), by_day=False)
    for _, d, m, _, a in flows:
        by_m[m] += a if d == "IN" else -a
    order = [m for m in PAYMENT_METHODS if m in by_m] + [m for m in by_m if m not in PAYMENT_METHODS]
    return {"total": str(money(_net(flows))), "by_method": [{"method": m, "amount": str(money(by_m[m]))} for m in order],
            "as_of": today_pkt().isoformat()}


@router.get("/transactions")
def transactions(start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                 db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    """Day book: every money-in / money-out entry in the period, oldest first, with a running balance."""
    start, end = _period(start, end, TX_MAX_DAYS)
    t0, t1 = _ts(start), _ts(end + timedelta(days=1))
    opening = money(_net(_flows(db, None, start - timedelta(days=1), by_day=False)))
    rows: list[dict] = []

    def add(at, direction, kind, number, party, desc, method, amount):
        rows.append({"at": at, "direction": direction, "kind": kind, "number": number, "party": party,
                     "description": desc, "method": method, "amount": money(amount)})

    def on_day(d: date, created: datetime):  # date-only entries keep their entry time for ordering
        return datetime.combine(d, created.astimezone(PKT).time(), tzinfo=PKT)

    for p, fn, ln, mrn in db.execute(select(Payment, Patient.first_name, Patient.last_name, Patient.mrn).join(Patient, Patient.id == Payment.patient_id)
                                     .where(Payment.status == "POSTED", Payment.received_at >= t0, Payment.received_at < t1)):
        add(p.received_at, "IN", "PATIENT_PAYMENT", p.receipt_number, f"{fn} {ln or ''}".strip() + f" ({mrn})", p.reference_number, p.payment_method, p.amount)
    for s in db.scalars(select(Sale).where(Sale.patient_id.is_(None), Sale.paid_amount > 0, Sale.sold_at >= t0, Sale.sold_at < t1)):
        add(s.sold_at, "IN", "STORE_SALE", s.sale_number, s.customer_name or "Walk-in customer", "Medical store sale", s.payment_method or "CASH", s.paid_amount)
    for i in db.scalars(select(OtherIncome).where(OtherIncome.income_date.between(start, end))):
        add(on_day(i.income_date, i.created_at), "IN", f"INCOME_{i.category}", i.income_number, i.received_from, i.description, i.payment_method, i.amount)
    for e in db.scalars(select(Expense).where(Expense.expense_date.between(start, end))):
        add(on_day(e.expense_date, e.created_at), "OUT", f"EXPENSE_{e.category}", e.expense_number, e.paid_to, e.description, e.payment_method, e.amount)
    for a, name in db.execute(select(AdvanceRequest, Employee.full_name).join(Employee, Employee.id == AdvanceRequest.employee_id)
                              .where(AdvanceRequest.status == "PAID", AdvanceRequest.paid_at >= t0, AdvanceRequest.paid_at < t1)):
        add(a.paid_at, "OUT", "STAFF_ADVANCE", a.request_number, name, a.reason, a.payment_method or "CASH", a.approved_amount or a.amount)
    for pu, sup in db.execute(select(Purchase, Supplier.name).join(Supplier, Supplier.id == Purchase.supplier_id)
                              .where(Purchase.purchase_date.between(start, end))):
        add(on_day(pu.purchase_date, pu.created_at), "OUT", "MEDICINE_PURCHASE", pu.purchase_number, sup,
            f"Supplier invoice {pu.supplier_invoice_no}" if pu.supplier_invoice_no else "Medicine purchase", "SUPPLIER", pu.total_amount)

    rows.sort(key=lambda r: r["at"])
    run, tin, tout = opening, ZERO, ZERO
    for r in rows:
        if r["direction"] == "IN":
            run += r["amount"]; tin += r["amount"]
        else:
            run -= r["amount"]; tout += r["amount"]
        r["balance"] = str(money(run))
        r["amount"] = str(r["amount"])
        r["at"] = r["at"].astimezone(PKT).isoformat()
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "opening_balance": str(opening),
            "total_in": str(money(tin)), "total_out": str(money(tout)), "closing_balance": str(money(run)), "rows": rows}


# ---------------------------------------------------------------- expenses
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
def add_expense(payload: EntryIn, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    d = payload.entry_date or today_pkt()
    _check_entry(payload.category, EXPENSE_CATEGORIES, payload.payment_method, d)
    e = Expense(expense_number=next_number(db, "EXP"), expense_date=d, category=payload.category, description=payload.description.strip(),
                amount=money(payload.amount), payment_method=payload.payment_method, paid_to=(payload.party or "").strip() or None,
                reference=(payload.reference or "").strip() or None, recorded_by=user.id)
    db.add(e)
    db.flush()
    db.add(AuditLog(actor_user_id=user.id, action="CREATE", entity_type="EXPENSE", entity_id=str(e.id),
                    new_values={"number": e.expense_number, "amount": str(e.amount), "category": e.category, "description": e.description}))
    notify(db, "finance")
    db.commit()
    return _exp_out(e, user.username)


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.add(AuditLog(actor_user_id=user.id, action="DELETE", entity_type="EXPENSE", entity_id=str(e.id),
                    old_values={"number": e.expense_number, "amount": str(e.amount), "category": e.category, "description": e.description}))
    db.delete(e)
    notify(db, "finance")
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------- other income
def _inc_out(i: OtherIncome, by: str | None = None) -> dict:
    return {"id": str(i.id), "income_number": i.income_number, "income_date": i.income_date.isoformat(), "category": i.category,
            "description": i.description, "amount": str(money(i.amount)), "payment_method": i.payment_method,
            "received_from": i.received_from, "reference": i.reference, "recorded_by": by, "created_at": i.created_at.isoformat(),
            "is_revenue": i.category not in NON_REVENUE_INCOME}


@router.get("/income")
def list_income(start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                db: Session = Depends(get_db), user: User = Depends(require_permission("finance.read"))):
    start, end = _period(start, end)
    rows = db.execute(select(OtherIncome, User.username).join(User, User.id == OtherIncome.recorded_by)
                      .where(OtherIncome.income_date.between(start, end)).order_by(OtherIncome.income_date.desc(), OtherIncome.created_at.desc())).all()
    return [_inc_out(i, u) for i, u in rows]


@router.post("/income", status_code=status.HTTP_201_CREATED)
def add_income(payload: IncomeIn, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    d = payload.income_date or today_pkt()
    _check_entry(payload.category, INCOME_CATEGORIES, payload.payment_method, d)
    i = OtherIncome(income_number=next_number(db, "INC"), income_date=d, category=payload.category, description=payload.description.strip(),
                    amount=money(payload.amount), payment_method=payload.payment_method, received_from=(payload.received_from or "").strip() or None,
                    reference=(payload.reference or "").strip() or None, recorded_by=user.id)
    db.add(i)
    db.flush()
    db.add(AuditLog(actor_user_id=user.id, action="CREATE", entity_type="INCOME", entity_id=str(i.id),
                    new_values={"number": i.income_number, "amount": str(i.amount), "category": i.category, "description": i.description}))
    notify(db, "finance")
    db.commit()
    return _inc_out(i, user.username)


@router.delete("/income/{income_id}")
def delete_income(income_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("finance.expenses.manage"))):
    i = db.get(OtherIncome, income_id)
    if not i:
        raise HTTPException(status_code=404, detail="Income entry not found")
    db.add(AuditLog(actor_user_id=user.id, action="DELETE", entity_type="INCOME", entity_id=str(i.id),
                    old_values={"number": i.income_number, "amount": str(i.amount), "category": i.category, "description": i.description}))
    db.delete(i)
    notify(db, "finance")
    db.commit()
    return {"status": "deleted"}
