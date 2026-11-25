"""Leave requests (Admin AND HR approve) and advance payment requests (Admin approves).

Leave: any staff member requests; Admin decides the Admin part and HR the HR part. Overall
APPROVED only when both approved (then attendance is marked LEAVE for those days); REJECTED as soon
as either side rejects. Nobody decides their own request. If the requester is the only active HR
person, an Admin may record the HR part too (otherwise it could never be approved).

Advance: any staff member requests an amount; Admin approves (optionally a different amount) or
rejects, then marks it PAID when the money is handed over.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core import roles as R
from app.core.database import get_db
from app.core.dependencies import get_current_user, granted_permissions, require_permission
from app.core.realtime import notify
from app.modules.attendance.models import AttendanceRecord
from app.modules.audit.models import AuditLog
from app.modules.auth.models import Role, User, UserRole
from app.modules.billing.service import PAYMENT_METHODS, money, next_number, today_pkt
from app.modules.hospital.models import Employee
from app.modules.requests.models import LEAVE_TYPES, AdvanceRequest, LeaveRequest

router = APIRouter(tags=["Staff requests"])


# ------------------------------------------------------------------ helpers

def _roles(user: User) -> set[str]:
    return {ur.role.name for ur in user.user_roles}


def _my_employee(db: Session, user: User) -> Employee:
    e = db.scalar(select(Employee).where(Employee.user_id == user.id))
    if not e:
        raise HTTPException(status_code=404, detail="Your login is not linked to a staff record")
    return e


def _names(db: Session, user_ids) -> dict:
    ids = [i for i in set(user_ids) if i]
    if not ids:
        return {}
    out = {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
    for e in db.scalars(select(Employee).where(Employee.user_id.in_(ids))).all():
        out[e.user_id] = e.full_name
    return out


def _audit(db, actor, action, entity, entity_id, values):
    db.add(AuditLog(actor_user_id=actor.id, action=action, entity_type=entity, entity_id=str(entity_id), new_values=values))


# ------------------------------------------------------------------ leave

class LeaveIn(BaseModel):
    leave_type: str
    start_date: date
    end_date: date
    reason: str = Field(min_length=3, max_length=1000)


class DecisionIn(BaseModel):
    decision: str  # APPROVE | REJECT
    comment: str | None = Field(default=None, max_length=500)
    side: str | None = None  # "ADMIN" | "HR"; normally derived from your role


def _leave_out(db: Session, r: LeaveRequest, employees: dict | None = None) -> dict:
    e = (employees or {}).get(r.employee_id) or db.get(Employee, r.employee_id)
    names = _names(db, [r.admin_by, r.hr_by])
    return {"id": str(r.id), "leave_type": r.leave_type, "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat(),
            "days": (r.end_date - r.start_date).days + 1, "reason": r.reason, "status": r.status, "created_at": r.created_at.isoformat(),
            "employee": {"id": str(e.id), "name": e.full_name, "designation": e.designation, "department": e.department.name},
            "admin": {"decision": r.admin_decision, "by": names.get(r.admin_by), "at": r.admin_at.isoformat() if r.admin_at else None, "comment": r.admin_comment},
            "hr": {"decision": r.hr_decision, "by": names.get(r.hr_by), "at": r.hr_at.isoformat() if r.hr_at else None, "comment": r.hr_comment}}


def _only_hr_is(db: Session, user_id) -> bool:
    """True when the given user is the only active HR person."""
    hr_ids = set(db.scalars(select(User.id).join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id)
                            .where(Role.name == R.HR, User.is_active.is_(True))).all())
    return hr_ids == {user_id}


@router.post("/leave/requests", status_code=status.HTTP_201_CREATED)
def request_leave(payload: LeaveIn, db: Session = Depends(get_db), user: User = Depends(require_permission("leave.request"))):
    e = _my_employee(db, user)
    if payload.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail="Choose casual, sick, annual or other leave")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="The end date is before the start date")
    if (payload.end_date - payload.start_date).days > 89:
        raise HTTPException(status_code=400, detail="A single leave request can be at most 90 days")
    if payload.start_date < today_pkt() - timedelta(days=30):
        raise HTTPException(status_code=400, detail="Leave cannot start more than 30 days in the past")
    clash = db.scalar(select(LeaveRequest.id).where(LeaveRequest.employee_id == e.id, LeaveRequest.status.in_(("PENDING", "APPROVED")),
                                                    LeaveRequest.start_date <= payload.end_date, LeaveRequest.end_date >= payload.start_date))
    if clash:
        raise HTTPException(status_code=409, detail="You already have leave requested or approved on some of these days")
    r = LeaveRequest(employee_id=e.id, requested_by=user.id, leave_type=payload.leave_type, start_date=payload.start_date,
                     end_date=payload.end_date, reason=payload.reason.strip())
    db.add(r)
    db.flush()
    _audit(db, user, "REQUEST", "LEAVE", r.id, {"from": str(r.start_date), "to": str(r.end_date)})
    notify(db, "leave")
    db.commit()
    return _leave_out(db, r)


@router.get("/leave/mine")
def my_leave(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = _my_employee(db, user)
    rows = db.scalars(select(LeaveRequest).where(LeaveRequest.employee_id == e.id).order_by(LeaveRequest.start_date.desc())).all()
    return [_leave_out(db, r, {e.id: e}) for r in rows]


@router.post("/leave/requests/{request_id}/cancel")
def cancel_leave(request_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(LeaveRequest, request_id)
    if not r or r.requested_by != user.id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if r.status != "PENDING":
        raise HTTPException(status_code=409, detail="Only a pending request can be cancelled")
    r.status = "CANCELLED"
    notify(db, "leave")
    db.commit()
    return _leave_out(db, r)


@router.get("/leave/requests")
def list_leave(status_: str | None = Query(default=None, alias="status"), db: Session = Depends(get_db),
               user: User = Depends(require_permission("leave.approve"))):
    stmt = select(LeaveRequest).order_by((LeaveRequest.status == "PENDING").desc(), LeaveRequest.start_date.desc())
    if status_ in ("PENDING", "APPROVED", "REJECTED", "CANCELLED"):
        stmt = stmt.where(LeaveRequest.status == status_)
    rows = db.scalars(stmt.limit(500)).all()
    emps = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_({r.employee_id for r in rows}))).all()} if rows else {}
    out = [_leave_out(db, r, emps) for r in rows]
    roles = _roles(user)
    for o, r in zip(out, rows):
        o["can_decide"] = {"admin": R.ADMIN in roles and r.requested_by != user.id and r.status == "PENDING" and r.admin_decision == "PENDING",
                           "hr": r.requested_by != user.id and r.status == "PENDING" and r.hr_decision == "PENDING"
                                 and (R.HR in roles or (R.ADMIN in roles and _only_hr_is(db, r.requested_by)))}
    return out


@router.post("/leave/requests/{request_id}/decision")
def decide_leave(request_id: UUID, payload: DecisionIn, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("leave.approve"))):
    r = db.scalar(select(LeaveRequest).where(LeaveRequest.id == request_id).with_for_update())
    if not r:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if r.requested_by == user.id:
        raise HTTPException(status_code=403, detail="You cannot decide on your own leave request")
    if r.status != "PENDING":
        raise HTTPException(status_code=409, detail="This request has already been decided")
    if payload.decision not in ("APPROVE", "REJECT"):
        raise HTTPException(status_code=400, detail="decision must be APPROVE or REJECT")
    roles = _roles(user)
    side = payload.side or ("HR" if R.HR in roles and R.ADMIN not in roles else "ADMIN")
    if side == "ADMIN" and R.ADMIN not in roles:
        raise HTTPException(status_code=403, detail="Only an Admin can give the Admin approval")
    if side == "HR" and R.HR not in roles and not (R.ADMIN in roles and _only_hr_is(db, r.requested_by)):
        raise HTTPException(status_code=403, detail="Only HR can give the HR approval")
    value = "APPROVED" if payload.decision == "APPROVE" else "REJECTED"
    now = datetime.now(timezone.utc)
    comment = (payload.comment or "").strip() or None
    if side == "ADMIN":
        if r.admin_decision != "PENDING":
            raise HTTPException(status_code=409, detail="The Admin decision was already given")
        r.admin_decision, r.admin_by, r.admin_at, r.admin_comment = value, user.id, now, comment
    else:
        if r.hr_decision != "PENDING":
            raise HTTPException(status_code=409, detail="The HR decision was already given")
        r.hr_decision, r.hr_by, r.hr_at, r.hr_comment = value, user.id, now, comment

    if "REJECTED" in (r.admin_decision, r.hr_decision):
        r.status = "REJECTED"
    elif r.admin_decision == r.hr_decision == "APPROVED":
        r.status = "APPROVED"
        _mark_attendance_leave(db, r, user)
    _audit(db, user, value, "LEAVE", r.id, {"side": side, "status": r.status})
    notify(db, "leave", "attendance") if r.status == "APPROVED" else notify(db, "leave")
    db.commit()
    return _leave_out(db, r)


def _mark_attendance_leave(db: Session, r: LeaveRequest, actor: User) -> None:
    existing = {a.work_date: a for a in db.scalars(select(AttendanceRecord).where(
        AttendanceRecord.employee_id == r.employee_id, AttendanceRecord.work_date.between(r.start_date, r.end_date))).all()}
    d = r.start_date
    while d <= r.end_date:
        rec = existing.get(d)
        note = f"Approved {r.leave_type.lower()} leave"
        if rec:
            rec.status, rec.check_in, rec.check_out, rec.note, rec.marked_by = "LEAVE", None, None, note, actor.id
        else:
            db.add(AttendanceRecord(employee_id=r.employee_id, work_date=d, status="LEAVE", note=note, marked_by=actor.id))
        d += timedelta(days=1)


# ------------------------------------------------------------------ advances

class AdvanceIn(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("10000000"))
    reason: str = Field(min_length=3, max_length=1000)


class AdvanceDecisionIn(BaseModel):
    decision: str  # APPROVE | REJECT
    approved_amount: Decimal | None = Field(default=None, gt=0)
    comment: str | None = Field(default=None, max_length=500)


class AdvancePaidIn(BaseModel):
    payment_method: str
    payment_reference: str | None = Field(default=None, max_length=100)


def _adv_out(db: Session, a: AdvanceRequest, employees: dict | None = None) -> dict:
    e = (employees or {}).get(a.employee_id) or db.get(Employee, a.employee_id)
    names = _names(db, [a.decided_by, a.paid_by])
    return {"id": str(a.id), "request_number": a.request_number, "amount": str(money(a.amount)), "reason": a.reason, "status": a.status,
            "approved_amount": str(money(a.approved_amount)) if a.approved_amount is not None else None,
            "created_at": a.created_at.isoformat(),
            "employee": {"id": str(e.id), "name": e.full_name, "designation": e.designation, "department": e.department.name},
            "decided_by": names.get(a.decided_by), "decided_at": a.decided_at.isoformat() if a.decided_at else None,
            "decision_comment": a.decision_comment, "paid_by": names.get(a.paid_by),
            "paid_at": a.paid_at.isoformat() if a.paid_at else None, "payment_method": a.payment_method,
            "payment_reference": a.payment_reference}


@router.post("/advances", status_code=status.HTTP_201_CREATED)
def request_advance(payload: AdvanceIn, db: Session = Depends(get_db), user: User = Depends(require_permission("advances.request"))):
    e = _my_employee(db, user)
    if db.scalar(select(func.count()).select_from(AdvanceRequest).where(AdvanceRequest.employee_id == e.id, AdvanceRequest.status == "PENDING")):
        raise HTTPException(status_code=409, detail="You already have a pending advance request")
    a = AdvanceRequest(request_number=next_number(db, "ADV"), employee_id=e.id, requested_by=user.id,
                       amount=money(payload.amount), reason=payload.reason.strip())
    db.add(a)
    db.flush()
    _audit(db, user, "REQUEST", "ADVANCE", a.id, {"amount": str(a.amount)})
    notify(db, "advances")
    db.commit()
    return _adv_out(db, a)


@router.get("/advances/mine")
def my_advances(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    e = _my_employee(db, user)
    rows = db.scalars(select(AdvanceRequest).where(AdvanceRequest.employee_id == e.id).order_by(AdvanceRequest.created_at.desc())).all()
    return [_adv_out(db, a, {e.id: e}) for a in rows]


@router.post("/advances/{advance_id}/cancel")
def cancel_advance(advance_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    a = db.get(AdvanceRequest, advance_id)
    if not a or a.requested_by != user.id:
        raise HTTPException(status_code=404, detail="Advance request not found")
    if a.status != "PENDING":
        raise HTTPException(status_code=409, detail="Only a pending request can be cancelled")
    a.status = "CANCELLED"
    notify(db, "advances")
    db.commit()
    return _adv_out(db, a)


@router.get("/advances")
def list_advances(status_: str | None = Query(default=None, alias="status"), db: Session = Depends(get_db),
                  user: User = Depends(require_permission("advances.approve"))):
    stmt = select(AdvanceRequest).order_by((AdvanceRequest.status == "PENDING").desc(), (AdvanceRequest.status == "APPROVED").desc(),
                                           AdvanceRequest.created_at.desc())
    if status_ in ("PENDING", "APPROVED", "REJECTED", "PAID", "CANCELLED"):
        stmt = stmt.where(AdvanceRequest.status == status_)
    rows = db.scalars(stmt.limit(500)).all()
    emps = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_({a.employee_id for a in rows}))).all()} if rows else {}
    paid_month = money(db.scalar(select(func.coalesce(func.sum(AdvanceRequest.approved_amount), 0)).where(
        AdvanceRequest.status == "PAID", AdvanceRequest.paid_at >= datetime.combine(today_pkt().replace(day=1), datetime.min.time(), tzinfo=timezone(timedelta(hours=5))))))
    return {"summary": {"pending": sum(1 for a in rows if a.status == "PENDING"), "to_pay": sum(1 for a in rows if a.status == "APPROVED"),
                        "paid_this_month": str(paid_month)},
            "requests": [_adv_out(db, a, emps) for a in rows]}


@router.post("/advances/{advance_id}/decision")
def decide_advance(advance_id: UUID, payload: AdvanceDecisionIn, db: Session = Depends(get_db),
                   user: User = Depends(require_permission("advances.approve"))):
    a = db.scalar(select(AdvanceRequest).where(AdvanceRequest.id == advance_id).with_for_update())
    if not a:
        raise HTTPException(status_code=404, detail="Advance request not found")
    if a.requested_by == user.id:
        raise HTTPException(status_code=403, detail="You cannot decide on your own advance request")
    if a.status != "PENDING":
        raise HTTPException(status_code=409, detail="This request has already been decided")
    if payload.decision not in ("APPROVE", "REJECT"):
        raise HTTPException(status_code=400, detail="decision must be APPROVE or REJECT")
    a.status = "APPROVED" if payload.decision == "APPROVE" else "REJECTED"
    a.approved_amount = money(payload.approved_amount or a.amount) if a.status == "APPROVED" else None
    a.decided_by, a.decided_at, a.decision_comment = user.id, datetime.now(timezone.utc), (payload.comment or "").strip() or None
    _audit(db, user, a.status, "ADVANCE", a.id, {"approved_amount": str(a.approved_amount) if a.approved_amount else None})
    notify(db, "advances")
    db.commit()
    return _adv_out(db, a)


@router.post("/advances/{advance_id}/paid")
def mark_advance_paid(advance_id: UUID, payload: AdvancePaidIn, db: Session = Depends(get_db),
                      user: User = Depends(require_permission("advances.approve"))):
    a = db.scalar(select(AdvanceRequest).where(AdvanceRequest.id == advance_id).with_for_update())
    if not a:
        raise HTTPException(status_code=404, detail="Advance request not found")
    if a.status != "APPROVED":
        raise HTTPException(status_code=409, detail="Only an approved advance can be marked as paid")
    if payload.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Choose a payment method")
    a.status, a.paid_by, a.paid_at = "PAID", user.id, datetime.now(timezone.utc)
    a.payment_method, a.payment_reference = payload.payment_method, (payload.payment_reference or "").strip() or None
    _audit(db, user, "PAID", "ADVANCE", a.id, {"amount": str(a.approved_amount), "method": a.payment_method})
    notify(db, "advances")
    db.commit()
    return _adv_out(db, a)
