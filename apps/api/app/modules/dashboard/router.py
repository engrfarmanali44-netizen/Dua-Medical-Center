"""Role-specific dashboard data.

Each portal gets its own headline metrics, computed only from data that the portal's role is
entitled to see. A user may request a portal only if they hold that portal's role (admins,
who are superusers, may view every portal).
"""
from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.roles import PORTAL_ROLES
from app.modules.auth.models import User
from app.modules.billing.models import Invoice, Payment, PaymentAllocation
from app.modules.hospital.models import Department, Employee, Notification, StaffTask, TaskAssignment
from app.modules.visits.models import PatientCase, Visit
from app.modules.reviews.models import PatientReview
from app.modules.requests.models import AdvanceRequest, LeaveRequest
from app.modules.patients.models import Patient
from app.modules.pharmacy.models import Medicine, MedicineBatch, Sale

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

# Pakistan Standard Time has no daylight saving, so a fixed offset is exact.
PKT = timezone(timedelta(hours=5), name="PKT")

CLOSED_TASK_STATUSES = ("COMPLETED", "CANCELLED")
NON_RECEIVABLE_INVOICE_STATUSES = ("DRAFT", "PAID", "CANCELLED", "VOID")


class Ctx:
    """Shared per-request state for metric builders."""

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        now = datetime.now(PKT)
        self.today: date = now.date()
        self.day_start = datetime.combine(self.today, time.min, tzinfo=PKT)
        self.day_end = self.day_start + timedelta(days=1)
        self.month_start_date = self.today.replace(day=1)
        self.month_start = datetime.combine(self.month_start_date, time.min, tzinfo=PKT)
        self._employee_id = None
        self._employee_loaded = False

    def count(self, stmt) -> int:
        return int(self.db.scalar(stmt) or 0)

    def amount(self, stmt) -> str:
        return str(Decimal(self.db.scalar(stmt) or 0).quantize(Decimal("0.01")))

    @property
    def employee_id(self):
        if not self._employee_loaded:
            self._employee_id = self.db.scalar(select(Employee.id).where(Employee.user_id == self.user.id))
            self._employee_loaded = True
        return self._employee_id


def stat(key: str, label: str, value, fmt: str = "number", hint: str | None = None) -> dict:
    return {"key": key, "label": label, "value": value, "format": fmt, "hint": hint}


# ---------------------------------------------------------------- shared metrics

def _my_open_tasks(c: Ctx) -> int:
    return c.count(select(func.count()).select_from(StaffTask)
                   .join(TaskAssignment, TaskAssignment.task_id == StaffTask.id)
                   .where(TaskAssignment.assignee_user_id == c.user.id,
                          StaffTask.status.not_in(CLOSED_TASK_STATUSES)))


def _unread_notifications(c: Ctx) -> int:
    return c.count(select(func.count()).select_from(Notification)
                   .where(Notification.user_id == c.user.id, Notification.is_read.is_(False)))


def _patients_total(c: Ctx) -> int:
    return c.count(select(func.count()).select_from(Patient))


def _patients_registered_today(c: Ctx) -> int:
    return c.count(select(func.count()).select_from(Patient)
                   .where(Patient.created_at >= c.day_start, Patient.created_at < c.day_end))


def _open_visits(c: Ctx, doctor_id=None) -> int:
    """Patients under treatment = open cases (optionally: cases this doctor has seen)."""
    stmt = select(func.count()).select_from(PatientCase).where(PatientCase.status == "OPEN")
    if doctor_id is not None:
        stmt = stmt.where(PatientCase.id.in_(select(Visit.case_id).where(Visit.doctor_employee_id == doctor_id)))
    return c.count(stmt)


def _outstanding_receivables(c: Ctx, patient_id=None) -> str:
    invoiced = select(func.coalesce(func.sum(Invoice.total_amount), 0)).where(
        Invoice.status.not_in(NON_RECEIVABLE_INVOICE_STATUSES))
    allocated = (select(func.coalesce(func.sum(PaymentAllocation.allocated_amount), 0))
                 .join(Invoice, Invoice.id == PaymentAllocation.invoice_id)
                 .join(Payment, Payment.id == PaymentAllocation.payment_id)
                 .where(Invoice.status.not_in(NON_RECEIVABLE_INVOICE_STATUSES), Payment.status == "POSTED"))
    if patient_id is not None:
        invoiced = invoiced.where(Invoice.patient_id == patient_id)
        allocated = allocated.where(Invoice.patient_id == patient_id)
    balance = Decimal(c.db.scalar(invoiced) or 0) - Decimal(c.db.scalar(allocated) or 0)
    return str(max(balance, Decimal("0")).quantize(Decimal("0.01")))


def _collections_since(c: Ctx, since: datetime, received_by=None) -> str:
    stmt = (select(func.coalesce(func.sum(Payment.amount), 0))
            .where(Payment.status == "POSTED", Payment.received_at >= since))
    if received_by is not None:
        stmt = stmt.where(Payment.received_by == received_by)
    return c.amount(stmt)


def _store_sales_since(c: Ctx, since: datetime) -> str:
    return c.amount(select(func.coalesce(func.sum(Sale.total_amount), 0)).where(Sale.sold_at >= since))


def _batches_expiring(c: Ctx, days: int) -> int:
    return c.count(select(func.count()).select_from(MedicineBatch)
                   .where(MedicineBatch.expiry_date >= c.today,
                          MedicineBatch.expiry_date <= c.today + timedelta(days=days)))


def _active_employees(c: Ctx) -> int:
    return c.count(select(func.count()).select_from(Employee).where(Employee.employment_status == "ACTIVE"))


# ---------------------------------------------------------------- per-portal builders

def admin(c: Ctx) -> list[dict]:
    return [
        stat("patients_total", "Registered patients", _patients_total(c)),
        stat("patients_today", "New patients today", _patients_registered_today(c)),
        stat("open_visits", "Patients under treatment", _open_visits(c)),
        stat("employees_active", "Active staff", _active_employees(c)),
        stat("active_users", "Active user accounts",
             c.count(select(func.count()).select_from(User).where(User.is_active.is_(True)))),
        stat("store_sales_today", "Medical store sales today", _store_sales_since(c, c.day_start), "currency"),
        stat("collections_today", "Counter collections today", _collections_since(c, c.day_start), "currency"),
        stat("outstanding", "Outstanding patient dues", _outstanding_receivables(c), "currency"),
        stat("avg_rating", "Average patient rating",
             (lambda v: None if v is None else f"{float(v):.1f}")(c.db.scalar(select(func.avg(PatientReview.rating)))),
             "rating", hint=f"{c.count(select(func.count()).select_from(PatientReview))} reviews"),
        stat("leave_to_approve", "Leave awaiting your approval",
             c.count(select(func.count()).select_from(LeaveRequest).where(LeaveRequest.status == "PENDING", LeaveRequest.admin_decision == "PENDING"))),
        stat("advances_to_decide", "Advance requests to decide",
             c.count(select(func.count()).select_from(AdvanceRequest).where(AdvanceRequest.status.in_(("PENDING", "APPROVED"))))),
        stat("pending_tasks", "Open staff tasks",
             c.count(select(func.count()).select_from(StaffTask).where(StaffTask.status.not_in(CLOSED_TASK_STATUSES)))),
    ]


def doctor(c: Ctx) -> list[dict]:
    emp = c.employee_id
    if emp is None:
        return [stat("my_open_visits", "My patients under treatment", None,
                     hint="Your account is not linked to a staff record.")]
    return [
        stat("my_open_visits", "My patients under treatment", _open_visits(c, emp)),
        stat("my_visits_month", "Visits this month",
             c.count(select(func.count()).select_from(Visit)
                     .where(Visit.doctor_employee_id == emp, Visit.visit_date >= c.month_start))),
        stat("patients_today", "New patients today", _patients_registered_today(c)),
    ]


def nurse(c: Ctx) -> list[dict]:
    return [
        stat("open_visits", "Patients under treatment", _open_visits(c)),
        stat("patients_today", "New patients today", _patients_registered_today(c)),
    ]


def hr(c: Ctx) -> list[dict]:
    return [
        stat("leave_to_approve", "Leave awaiting your approval",
             c.count(select(func.count()).select_from(LeaveRequest).where(LeaveRequest.status == "PENDING", LeaveRequest.hr_decision == "PENDING"))),
        stat("on_leave_today", "Staff on leave today",
             c.count(select(func.count()).select_from(LeaveRequest).where(LeaveRequest.status == "APPROVED",
                     LeaveRequest.start_date <= c.today, LeaveRequest.end_date >= c.today))),
        stat("employees_active", "Active staff", _active_employees(c)),
        stat("employees_total", "Total staff", c.count(select(func.count()).select_from(Employee))),
        stat("joined_month", "Joined this month",
             c.count(select(func.count()).select_from(Employee).where(Employee.joining_date >= c.month_start_date))),
        stat("departments", "Departments",
             c.count(select(func.count()).select_from(Department).where(Department.is_active.is_(True)))),
    ]


def accountant(c: Ctx) -> list[dict]:
    month_invoices = Invoice.invoice_date >= c.month_start_date
    return [
        stat("store_sales_today", "Medical store sales today", _store_sales_since(c, c.day_start), "currency"),
        stat("collections_today", "Counter collections today", _collections_since(c, c.day_start), "currency"),
        stat("store_sales_month", "Store sales this month", _store_sales_since(c, c.month_start), "currency"),
        stat("collections_month", "Collections this month", _collections_since(c, c.month_start), "currency"),
        stat("billed_month", "Billed this month",
             c.amount(select(func.coalesce(func.sum(Invoice.total_amount), 0))
                      .where(month_invoices, Invoice.status.not_in(("DRAFT", "CANCELLED", "VOID")))), "currency"),
        stat("outstanding", "Outstanding patient dues", _outstanding_receivables(c), "currency"),
    ]


def counter(c: Ctx) -> list[dict]:
    return [
        stat("patients_today", "Registered today", _patients_registered_today(c)),
        stat("my_collections_today", "My collections today", _collections_since(c, c.day_start, c.user.id), "currency"),
        stat("outstanding", "Outstanding patient dues", _outstanding_receivables(c), "currency"),
        stat("patients_total", "Registered patients", _patients_total(c)),
    ]


def store(c: Ctx) -> list[dict]:
    return [
        stat("store_sales_today", "Sales today", _store_sales_since(c, c.day_start), "currency"),
        stat("medicines_active", "Active medicines",
             c.count(select(func.count()).select_from(Medicine).where(Medicine.is_active.is_(True)))),
        stat("batches_expiring_30", "Batches expiring in 30 days", _batches_expiring(c, 30)),
        stat("batches_expired", "Expired batches",
             c.count(select(func.count()).select_from(MedicineBatch).where(MedicineBatch.expiry_date < c.today))),
    ]


def patient(c: Ctx) -> list[dict]:
    patient_id = c.db.scalar(select(Patient.id).where(Patient.user_id == c.user.id))
    if patient_id is None:
        hint = "Your account is not linked to a patient record. Please contact the counter."
        return [stat("my_visits", "My visits", None, hint=hint),
                stat("my_balance", "Outstanding dues", None, "currency", hint=hint)]
    return [
        stat("my_visits", "My visits",
             c.count(select(func.count()).select_from(Visit).where(Visit.patient_id == patient_id))),
        stat("my_balance", "Outstanding dues", _outstanding_receivables(c, patient_id), "currency"),
    ]


def _none(_: Ctx) -> list[dict]:
    return []


BUILDERS: dict[str, Callable[[Ctx], list[dict]]] = {
    "admin": admin, "doctor": doctor, "nurse": nurse, "hr": hr, "accountant": accountant,
    "counter": counter, "store": store, "patient": patient, "cleaning": _none,
}
assert set(BUILDERS) == set(PORTAL_ROLES), "every portal needs a dashboard builder"


@router.get("/{portal}")
def portal_dashboard(portal: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    allowed_roles = PORTAL_ROLES.get(portal)
    if allowed_roles is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown portal")
    user_roles = {ur.role.name for ur in user.user_roles}
    if not user.is_superuser and not (user_roles & allowed_roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    c = Ctx(db, user)
    stats = BUILDERS[portal](c)
    # Personal workload is relevant in every staff portal; patients do not receive staff tasks.
    if portal != "patient":
        stats.append(stat("my_open_tasks", "My open tasks", _my_open_tasks(c)))
    stats.append(stat("unread_notifications", "Unread notifications", _unread_notifications(c)))

    my_tasks = []
    if portal != "patient":
        rows = db.scalars(
            select(StaffTask)
            .join(TaskAssignment, TaskAssignment.task_id == StaffTask.id)
            .where(TaskAssignment.assignee_user_id == user.id, StaffTask.status.not_in(CLOSED_TASK_STATUSES))
            .order_by(StaffTask.due_date.asc().nulls_last(), StaffTask.created_at.desc())
            .limit(5)
        ).all()
        my_tasks = [{"id": str(t.id), "title": t.title, "status": t.status, "priority": t.priority,
                     "due_date": t.due_date.isoformat() if t.due_date else None} for t in rows]

    return {"portal": portal, "date": c.today.isoformat(), "currency": "PKR", "stats": stats, "my_tasks": my_tasks}
