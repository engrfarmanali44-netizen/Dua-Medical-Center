"""Attendance API.

HR / Admin (attendance.manage) mark the daily register for all active staff and see monthly
reports. Every staff member can see their own attendance (/attendance/me).
"""
import calendar
from datetime import date, time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.core.realtime import notify
from app.modules.audit.models import AuditLog
from app.modules.auth.models import Role, User, UserRole
from app.modules.billing.service import today_pkt
from app.modules.hospital.models import Employee
from app.modules.attendance.models import ATTENDANCE_STATUSES, AttendanceRecord

router = APIRouter(prefix="/attendance", tags=["Attendance"])


class Entry(BaseModel):
    employee_id: UUID
    status: str | None = None  # None = clear the mark for that day
    check_in: time | None = None
    check_out: time | None = None
    note: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _check(self):
        if self.status is not None and self.status not in ATTENDANCE_STATUSES:
            raise ValueError(f"status must be one of {', '.join(ATTENDANCE_STATUSES)}")
        if self.check_in and self.check_out and self.check_out < self.check_in:
            raise ValueError("check-out time cannot be before check-in time")
        return self


class DayIn(BaseModel):
    date: date
    entries: list[Entry] = Field(min_length=1)


def _month_bounds(month: str | None) -> tuple[date, date]:
    if month:
        try:
            y, m = (int(x) for x in month.split("-"))
            start = date(y, m, 1)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="month must look like 2026-11")
    else:
        t = today_pkt()
        start = date(t.year, t.month, 1)
    return start, date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])


def _staff(db: Session) -> list[Employee]:
    """Active staff who should be on the register (patients are not employees)."""
    rows = db.scalars(select(Employee).join(User, User.id == Employee.user_id, isouter=True)
                      .where(Employee.employment_status != "LEFT")
                      .where((User.id.is_(None)) | (User.is_active.is_(True)))
                      .order_by(Employee.full_name)).unique().all()
    return list(rows)


def _roles_by_user(db: Session, user_ids) -> dict:
    ids = [i for i in user_ids if i]
    if not ids:
        return {}
    return dict(db.execute(select(UserRole.user_id, Role.name).join(Role, Role.id == UserRole.role_id)
                           .where(UserRole.user_id.in_(ids))).all())


def _rec_out(r: AttendanceRecord | None) -> dict | None:
    if r is None:
        return None
    return {"status": r.status, "check_in": r.check_in.strftime("%H:%M") if r.check_in else None,
            "check_out": r.check_out.strftime("%H:%M") if r.check_out else None, "note": r.note,
            "marked_at": r.marked_at.isoformat() if r.marked_at else None}


def _counts(records) -> dict:
    c = {s: 0 for s in ATTENDANCE_STATUSES}
    for r in records:
        c[r.status] += 1
    return c


@router.get("/day")
def get_day(day: date | None = Query(default=None, alias="date"), db: Session = Depends(get_db),
            user: User = Depends(require_permission("attendance.manage"))):
    day = day or today_pkt()
    staff = _staff(db)
    recs = {r.employee_id: r for r in db.scalars(select(AttendanceRecord).where(AttendanceRecord.work_date == day)).all()}
    roles = _roles_by_user(db, [e.user_id for e in staff])
    rows = [{"employee_id": str(e.id), "employee_code": e.employee_code, "full_name": e.full_name,
             "designation": e.designation, "department": e.department.name, "role": roles.get(e.user_id),
             "record": _rec_out(recs.get(e.id))} for e in staff]
    return {"date": day.isoformat(), "is_today": day == today_pkt(), "rows": rows,
            "summary": {**_counts(recs.values()), "unmarked": sum(1 for e in staff if e.id not in recs), "total": len(staff)}}


@router.put("/day")
def save_day(payload: DayIn, db: Session = Depends(get_db), user: User = Depends(require_permission("attendance.manage"))):
    if payload.date > today_pkt():
        raise HTTPException(status_code=400, detail="You cannot mark attendance for a future date")
    ids = {e.employee_id for e in payload.entries}
    found = set(db.scalars(select(Employee.id).where(Employee.id.in_(ids))).all())
    if ids - found:
        raise HTTPException(status_code=400, detail="Unknown staff member in the register")
    existing = {r.employee_id: r for r in db.scalars(
        select(AttendanceRecord).where(AttendanceRecord.work_date == payload.date, AttendanceRecord.employee_id.in_(ids))
        .with_for_update()).all()}
    changed = 0
    for e in payload.entries:
        rec = existing.get(e.employee_id)
        if e.status is None:
            if rec:
                db.delete(rec)
                changed += 1
            continue
        times = (e.check_in, e.check_out) if e.status in ("PRESENT", "LATE", "HALF_DAY") else (None, None)
        if rec is None:
            db.add(AttendanceRecord(employee_id=e.employee_id, work_date=payload.date, status=e.status,
                                    check_in=times[0], check_out=times[1], note=e.note, marked_by=user.id))
            changed += 1
        elif (rec.status, rec.check_in, rec.check_out, rec.note) != (e.status, times[0], times[1], e.note):
            rec.status, rec.check_in, rec.check_out, rec.note, rec.marked_by = e.status, times[0], times[1], e.note, user.id
            changed += 1
    if changed:
        db.add(AuditLog(actor_user_id=user.id, action="MARK", entity_type="ATTENDANCE", entity_id=payload.date.isoformat(),
                        new_values={"entries": changed}))
        notify(db, "attendance")
    db.commit()
    return get_day(day=payload.date, db=db, user=user)


@router.get("/month")
def month_report(month: str | None = None, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("attendance.manage"))):
    start, end = _month_bounds(month)
    staff = _staff(db)
    recs = db.scalars(select(AttendanceRecord).where(AttendanceRecord.work_date.between(start, end))).all()
    by_emp: dict = {}
    for r in recs:
        by_emp.setdefault(r.employee_id, []).append(r)
    days = (min(end, today_pkt()) - start).days + 1 if start <= today_pkt() else 0
    return {"month": start.strftime("%Y-%m"), "days_so_far": max(days, 0),
            "rows": [{"employee_id": str(e.id), "full_name": e.full_name, "employee_code": e.employee_code,
                      "department": e.department.name, "counts": _counts(by_emp.get(e.id, [])),
                      "days": {r.work_date.isoformat(): r.status for r in by_emp.get(e.id, [])}} for e in staff]}


@router.get("/me")
def my_attendance(month: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    emp = db.scalar(select(Employee).where(Employee.user_id == user.id))
    if not emp:
        raise HTTPException(status_code=404, detail="Your login is not linked to a staff record")
    start, end = _month_bounds(month)
    recs = db.scalars(select(AttendanceRecord).where(AttendanceRecord.employee_id == emp.id,
                                                     AttendanceRecord.work_date.between(start, end))
                      .order_by(AttendanceRecord.work_date)).all()
    return {"month": start.strftime("%Y-%m"), "full_name": emp.full_name, "counts": _counts(recs),
            "records": [{"date": r.work_date.isoformat(), **_rec_out(r)} for r in recs]}
