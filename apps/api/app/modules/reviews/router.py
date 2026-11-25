"""Patient reviews.

Patients (own data only) review each FINALIZED treatment case once (and may edit it).
Only Admin (permission reviews.read) can see reviews; no other staff role, including the doctor.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_permission
from app.core.realtime import notify
from app.modules.auth.models import User
from app.modules.hospital.models import Employee
from app.modules.patients.models import Patient
from app.modules.reviews.models import PatientReview
from app.modules.visits.models import PatientCase

router = APIRouter(prefix="/reviews", tags=["Patient reviews"])


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


def _my_patient(db: Session, user: User) -> Patient:
    p = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if not p:
        raise HTTPException(status_code=404, detail="No patient record is linked to this account")
    return p


def _review_out(r: PatientReview | None) -> dict | None:
    if not r:
        return None
    return {"rating": r.rating, "comment": r.comment, "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat() if r.updated_at else None}


@router.get("/me")
def my_reviewable_cases(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The patient's treatment cases with their review (if any). Only finalized cases can be reviewed."""
    p = _my_patient(db, user)
    cases = db.scalars(select(PatientCase).where(PatientCase.patient_id == p.id)
                       .options(selectinload(PatientCase.visits)).order_by(PatientCase.opened_at.desc())).all()
    reviews = {r.case_id: r for r in db.scalars(select(PatientReview).where(PatientReview.patient_id == p.id)).all()}
    doctor_ids = {c.visits[-1].doctor_employee_id for c in cases if c.visits and c.visits[-1].doctor_employee_id}
    doctors = {e.id: e.full_name for e in db.scalars(select(Employee).where(Employee.id.in_(doctor_ids)))} if doctor_ids else {}
    return [{"case_id": str(c.id), "case_number": c.case_number, "title": c.title, "status": c.status,
             "finalized_at": c.finalized_at.isoformat() if c.finalized_at else None,
             "visit_count": len(c.visits),
             "doctor_name": doctors.get(c.visits[-1].doctor_employee_id) if c.visits else None,
             "can_review": c.status == "FINALIZED", "review": _review_out(reviews.get(c.id))} for c in cases]


@router.put("/me/{case_id}")
def save_my_review(case_id: UUID, payload: ReviewIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _my_patient(db, user)
    c = db.scalar(select(PatientCase).where(PatientCase.id == case_id).options(selectinload(PatientCase.visits)))
    if not c or c.patient_id != p.id:
        raise HTTPException(status_code=404, detail="Treatment not found")
    if c.status != "FINALIZED":
        raise HTTPException(status_code=409, detail="You can review a treatment once it is finished")
    r = db.scalar(select(PatientReview).where(PatientReview.case_id == c.id))
    comment = (payload.comment or "").strip() or None
    if r is None:
        r = PatientReview(case_id=c.id, patient_id=p.id, rating=payload.rating, comment=comment,
                          doctor_employee_id=c.visits[-1].doctor_employee_id if c.visits else None)
        db.add(r)
    else:
        r.rating, r.comment, r.updated_at = payload.rating, comment, datetime.now(timezone.utc)
    notify(db, "reviews")
    db.commit()
    db.refresh(r)
    return _review_out(r)


@router.get("")
def list_reviews(rating: int | None = Query(default=None, ge=1, le=5), q: str | None = None,
                 limit: int = Query(default=200, ge=1, le=1000), db: Session = Depends(get_db),
                 user: User = Depends(require_permission("reviews.read"))):
    """Admin only: all reviews with a summary."""
    stmt = (select(PatientReview, Patient, PatientCase, Employee.full_name)
            .join(Patient, Patient.id == PatientReview.patient_id)
            .join(PatientCase, PatientCase.id == PatientReview.case_id)
            .outerjoin(Employee, Employee.id == PatientReview.doctor_employee_id)
            .order_by(PatientReview.updated_at.desc()))
    if rating:
        stmt = stmt.where(PatientReview.rating == rating)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.first_name.ilike(like), Patient.last_name.ilike(like), Patient.mrn.ilike(like),
                              PatientCase.case_number.ilike(like), PatientCase.title.ilike(like),
                              Employee.full_name.ilike(like), PatientReview.comment.ilike(like)))
    rows = db.execute(stmt.limit(limit)).all()
    dist = dict(db.execute(select(PatientReview.rating, func.count()).group_by(PatientReview.rating)).all())
    total = sum(dist.values())
    avg = round(sum(k * v for k, v in dist.items()) / total, 2) if total else None
    return {
        "summary": {"count": total, "average": avg, "distribution": {str(s): dist.get(s, 0) for s in range(5, 0, -1)}},
        "reviews": [{"id": str(r.id), "rating": r.rating, "comment": r.comment, "created_at": r.created_at.isoformat(),
                     "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                     "patient": {"id": str(p.id), "name": f"{p.first_name} {p.last_name or ''}".strip(), "mrn": p.mrn},
                     "case": {"id": str(c.id), "case_number": c.case_number, "title": c.title},
                     "doctor_name": doc} for r, p, c, doc in rows],
    }
