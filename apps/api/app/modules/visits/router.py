"""Patient cases and visits API.

Permissions
    visits.read      view cases / visits / files            (Admin, Doctor, Nurse, Counter)
    visits.create    open a case or add the next visit       (Admin, Doctor, Nurse, Counter)
    visits.write     record details, medicines, upload files (Admin, Doctor, Nurse)
    visits.finalize  finalize a case (patient recovered)     (Admin, Doctor)
    visits.reopen    reopen a finalized case                 (Admin)
A patient can read their own cases (and open their own files) through /visits/me.
Finalized cases are read-only.
"""
import uuid
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core import storage
from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, granted_permissions, require_permission
from app.core.realtime import notify
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.service import next_number
from app.modules.hospital.models import Employee
from app.modules.patients.models import Patient
from app.modules.pharmacy.models import Medicine
from app.modules.visits.models import ATTACHMENT_KINDS, PatientCase, Visit, VisitAttachment, VisitMedicine

router = APIRouter(prefix="/visits", tags=["Patient visits"])

# Accepted uploads, recognised by their first bytes (not by the file name the browser sends).
FILE_SIGNATURES = [
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"%PDF-", "application/pdf", "pdf"),
]


def _sniff(data: bytes) -> tuple[str, str] | None:
    for magic, ctype, ext in FILE_SIGNATURES:
        if data.startswith(magic):
            return ctype, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"mif1", b"msf1"):
        return "image/heic", "heic"
    return None


# ------------------------------------------------------------------ schemas

class MedicineLine(BaseModel):
    medicine_id: UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    dosage: str | None = Field(default=None, max_length=80)
    frequency: str | None = Field(default=None, max_length=80)
    duration: str | None = Field(default=None, max_length=80)
    instructions: str | None = Field(default=None, max_length=255)


class VisitFields(BaseModel):
    doctor_employee_id: UUID | None = None
    complaint: str | None = None
    analysis: str | None = None
    notes: str | None = None
    follow_up_date: date | None = None
    medicines: list[MedicineLine] | None = None  # None = leave unchanged; [] = clear


class CaseCreate(VisitFields):
    patient_id: UUID
    title: str = Field(min_length=2, max_length=200)


class FinalizeIn(BaseModel):
    final_notes: str | None = None


# ------------------------------------------------------------------ helpers

def _actor_employee_id(db: Session, user: User):
    return db.scalar(select(Employee.id).where(Employee.user_id == user.id))


def _doctor_names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {e.id: e.full_name for e in db.scalars(select(Employee).where(Employee.id.in_(ids))).all()}


def _user_names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(ids))).all()}


def _visit_out(v: Visit, doctors: dict, users: dict) -> dict:
    return {
        "id": str(v.id), "visit_number": v.visit_number, "visit_date": v.visit_date.isoformat(),
        "doctor_employee_id": str(v.doctor_employee_id) if v.doctor_employee_id else None,
        "doctor_name": doctors.get(v.doctor_employee_id), "complaint": v.complaint, "analysis": v.analysis,
        "notes": v.notes, "follow_up_date": v.follow_up_date.isoformat() if v.follow_up_date else None,
        "created_by": users.get(v.created_by), "updated_at": v.updated_at.isoformat() if v.updated_at else None,
        "medicines": [{"id": str(m.id), "medicine_id": str(m.medicine_id) if m.medicine_id else None, "name": m.name,
                       "dosage": m.dosage, "frequency": m.frequency, "duration": m.duration,
                       "instructions": m.instructions} for m in v.medicines],
        "attachments": [{"id": str(a.id), "kind": a.kind, "file_name": a.file_name, "content_type": a.content_type,
                         "size_bytes": a.size_bytes, "uploaded_by": users.get(a.uploaded_by),
                         "created_at": a.created_at.isoformat()} for a in v.attachments],
    }


def _case_out(db: Session, c: PatientCase, patient: Patient | None = None, with_visits: bool = True) -> dict:
    patient = patient or db.get(Patient, c.patient_id)
    visits = c.visits
    d = {
        "id": str(c.id), "case_number": c.case_number, "title": c.title, "status": c.status,
        "opened_at": c.opened_at.isoformat(), "finalized_at": c.finalized_at.isoformat() if c.finalized_at else None,
        "final_notes": c.final_notes, "visit_count": len(visits),
        "last_visit_date": visits[-1].visit_date.isoformat() if visits else None,
        "patient": {"id": str(patient.id), "mrn": patient.mrn, "phone": patient.phone,
                    "name": f"{patient.first_name} {patient.last_name or ''}".strip()},
    }
    if with_visits:
        doctors = _doctor_names(db, [v.doctor_employee_id for v in visits])
        users = _user_names(db, [v.created_by for v in visits] + [a.uploaded_by for v in visits for a in v.attachments]
                            + [c.opened_by, c.finalized_by])
        d["opened_by"] = users.get(c.opened_by)
        d["finalized_by"] = users.get(c.finalized_by)
        d["visits"] = [_visit_out(v, doctors, users) for v in visits]
    else:
        last = visits[-1] if visits else None
        d["last_doctor"] = _doctor_names(db, [last.doctor_employee_id]).get(last.doctor_employee_id) if last else None
    return d


def _load_case(db: Session, case_id: UUID) -> PatientCase:
    c = db.scalar(select(PatientCase).where(PatientCase.id == case_id).options(
        selectinload(PatientCase.visits).selectinload(Visit.medicines),
        selectinload(PatientCase.visits).selectinload(Visit.attachments)))
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    return c


def _load_visit(db: Session, visit_id: UUID) -> Visit:
    v = db.get(Visit, visit_id)
    if not v:
        raise HTTPException(status_code=404, detail="Visit not found")
    return v


def _require_open(c: PatientCase) -> None:
    if c.status != "OPEN":
        raise HTTPException(status_code=409, detail="This case is finalized. Ask an Admin to reopen it to make changes.")


def _can(user: User, perm: str) -> bool:
    return user.is_superuser or perm in granted_permissions(user)


def _require(user: User, perm: str) -> None:
    if not _can(user, perm):
        raise HTTPException(status_code=403, detail="Permission denied")


def _apply_fields(db: Session, v: Visit, f: VisitFields, actor: User) -> None:
    data = f.model_dump(exclude_unset=True, exclude={"medicines", "patient_id", "title"})
    if data.get("doctor_employee_id") and not db.get(Employee, data["doctor_employee_id"]):
        raise HTTPException(status_code=400, detail="Doctor not found")
    for k, val in data.items():
        setattr(v, k, val.strip() if isinstance(val, str) else val)
    if f.medicines is not None:
        v.medicines.clear()
        db.flush()
        for i, m in enumerate(f.medicines):
            name = m.name.strip()
            if m.medicine_id:
                med = db.get(Medicine, m.medicine_id)
                if not med:
                    raise HTTPException(status_code=400, detail="Unknown medicine")
                if not name:
                    name = f"{med.generic_name} {med.strength or ''}".strip()
            v.medicines.append(VisitMedicine(position=i, medicine_id=m.medicine_id, name=name, dosage=m.dosage,
                                             frequency=m.frequency, duration=m.duration, instructions=m.instructions))


def _audit(db: Session, actor: User, action: str, entity: str, entity_id, values: dict) -> None:
    db.add(AuditLog(actor_user_id=actor.id, action=action, entity_type=entity, entity_id=str(entity_id), new_values=values))


# ------------------------------------------------------------------ reads

@router.get("/doctors")
def doctors(db: Session = Depends(get_db), user: User = Depends(require_permission("visits.read"))):
    """Staff who can be recorded as the visit's doctor."""
    from app.core import roles as R
    from app.modules.auth.models import Role, UserRole
    rows = db.execute(select(Employee).join(UserRole, UserRole.user_id == Employee.user_id)
                      .join(Role, Role.id == UserRole.role_id).join(User, User.id == Employee.user_id)
                      .where(Role.name == R.DOCTOR, User.is_active.is_(True)).order_by(Employee.full_name)).scalars().unique().all()
    return [{"id": str(e.id), "name": e.full_name, "designation": e.designation} for e in rows]


@router.get("/cases")
def list_cases(status_: str | None = Query(default=None, alias="status"), patient_id: UUID | None = None,
               q: str | None = None, limit: int = Query(default=100, ge=1, le=500),
               db: Session = Depends(get_db), user: User = Depends(require_permission("visits.read"))):
    stmt = (select(PatientCase, Patient).join(Patient, Patient.id == PatientCase.patient_id)
            .options(selectinload(PatientCase.visits)).order_by(PatientCase.opened_at.desc()).limit(limit))
    if status_ in ("OPEN", "FINALIZED"):
        stmt = stmt.where(PatientCase.status == status_)
    if patient_id:
        stmt = stmt.where(PatientCase.patient_id == patient_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(PatientCase.case_number.ilike(like), PatientCase.title.ilike(like), Patient.mrn.ilike(like),
                              Patient.first_name.ilike(like), Patient.last_name.ilike(like), Patient.phone.ilike(like)))
    return [_case_out(db, c, p, with_visits=False) for c, p in db.execute(stmt).all()]


@router.get("/cases/{case_id}")
def get_case(case_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _load_case(db, case_id)
    if not _can(user, "visits.read"):
        patient = db.get(Patient, c.patient_id)
        if not patient or patient.user_id != user.id:
            raise HTTPException(status_code=403, detail="Permission denied")
    return _case_out(db, c)


@router.get("/me")
def my_cases(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """A logged-in patient's own cases, visits, medicines and reports."""
    patient = db.scalar(select(Patient).where(Patient.user_id == user.id))
    if not patient:
        raise HTTPException(status_code=404, detail="No patient record is linked to this account")
    cases = db.scalars(select(PatientCase).where(PatientCase.patient_id == patient.id)
                       .options(selectinload(PatientCase.visits).selectinload(Visit.medicines),
                                selectinload(PatientCase.visits).selectinload(Visit.attachments))
                       .order_by(PatientCase.opened_at.desc())).all()
    return [_case_out(db, c, patient) for c in cases]


@router.get("/attachments/{attachment_id}/url")
def attachment_url(attachment_id: UUID, download: bool = False, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    a = db.get(VisitAttachment, attachment_id)
    if not a:
        raise HTTPException(status_code=404, detail="File not found")
    if not _can(user, "visits.read"):
        v = db.get(Visit, a.visit_id)
        patient = db.get(Patient, v.patient_id) if v else None
        if not patient or patient.user_id != user.id:
            raise HTTPException(status_code=403, detail="Permission denied")
    return {"url": storage.signed_url(a.storage_path, a.file_name if download else None),
            "expires_in": storage.SIGNED_URL_SECONDS, "content_type": a.content_type, "file_name": a.file_name}


# ------------------------------------------------------------------ writes

@router.post("/cases", status_code=status.HTTP_201_CREATED)
def open_case(payload: CaseCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("visits.create"))):
    patient = db.get(Patient, payload.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if payload.medicines or payload.analysis:
        _require(user, "visits.write")
    c = PatientCase(case_number=next_number(db, "CASE"), patient_id=patient.id, title=payload.title.strip(),
                    status="OPEN", opened_by=user.id)
    db.add(c)
    db.flush()
    v = Visit(case_id=c.id, patient_id=patient.id, visit_number=1, created_by=user.id,
              doctor_employee_id=payload.doctor_employee_id or _actor_employee_id_if_doctor(db, user))
    c.visits.append(v)
    _apply_fields(db, v, payload, user)
    db.flush()
    _audit(db, user, "CREATE", "CASE", c.id, {"case": c.case_number, "patient": patient.mrn, "title": c.title})
    notify(db, "visits", "patients")
    db.commit()
    return _case_out(db, _load_case(db, c.id))


def _actor_employee_id_if_doctor(db: Session, user: User):
    from app.core import roles as R
    return _actor_employee_id(db, user) if R.DOCTOR in {ur.role.name for ur in user.user_roles} else None


@router.post("/cases/{case_id}/visits", status_code=status.HTTP_201_CREATED)
def add_visit(case_id: UUID, payload: VisitFields, db: Session = Depends(get_db),
              user: User = Depends(require_permission("visits.create"))):
    c = db.scalar(select(PatientCase).where(PatientCase.id == case_id).with_for_update())  # serialize visit numbers
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    _require_open(c)
    if payload.medicines or payload.analysis:
        _require(user, "visits.write")
    n = (db.scalar(select(func.max(Visit.visit_number)).where(Visit.case_id == c.id)) or 0) + 1
    v = Visit(case_id=c.id, patient_id=c.patient_id, visit_number=n, created_by=user.id,
              doctor_employee_id=payload.doctor_employee_id or _actor_employee_id_if_doctor(db, user))
    db.add(v)
    db.flush()
    _apply_fields(db, v, payload, user)
    _audit(db, user, "CREATE", "VISIT", v.id, {"case": c.case_number, "visit": n})
    notify(db, "visits")
    db.commit()
    return _case_out(db, _load_case(db, c.id))


@router.patch("/{visit_id}")
def update_visit(visit_id: UUID, payload: VisitFields, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("visits.write"))):
    v = _load_visit(db, visit_id)
    c = db.get(PatientCase, v.case_id)
    _require_open(c)
    _apply_fields(db, v, payload, user)
    v.updated_at = datetime.now(timezone.utc)
    _audit(db, user, "UPDATE", "VISIT", v.id, {"case": c.case_number, "visit": v.visit_number,
                                                "fields": sorted(payload.model_dump(exclude_unset=True))})
    notify(db, "visits")
    db.commit()
    return _case_out(db, _load_case(db, c.id))


@router.post("/{visit_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(visit_id: UUID, kind: str = Form(...), file: UploadFile = File(...),
                            db: Session = Depends(get_db), user: User = Depends(require_permission("visits.write"))):
    if kind not in ATTACHMENT_KINDS:
        raise HTTPException(status_code=400, detail="Choose: prescription slip, lab report or other")
    v = _load_visit(db, visit_id)
    c = db.get(PatientCase, v.case_id)
    _require_open(c)
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"File is too large (max {settings.max_upload_bytes // (1024 * 1024)} MB)")
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    sniffed = _sniff(data)
    if not sniffed:
        raise HTTPException(status_code=415, detail="Only photos (JPG, PNG, WEBP, HEIC) and PDF files can be uploaded")
    ctype, ext = sniffed
    path = f"patients/{v.patient_id}/cases/{c.id}/visit-{v.visit_number}/{kind.lower()}-{uuid.uuid4().hex}.{ext}"
    storage.upload(path, data, ctype)
    name = (file.filename or f"{kind.lower()}.{ext}").replace("\\", "/").split("/")[-1][:200]
    a = VisitAttachment(visit_id=v.id, kind=kind, file_name=name, content_type=ctype, size_bytes=len(data),
                        storage_path=path, uploaded_by=user.id)
    db.add(a)
    try:
        db.flush()
        _audit(db, user, "UPLOAD", "VISIT_FILE", a.id, {"case": c.case_number, "visit": v.visit_number, "kind": kind})
        notify(db, "visits")
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(path)  # don't leave an orphaned file behind
        raise
    return _case_out(db, _load_case(db, c.id))


@router.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("visits.write"))):
    a = db.get(VisitAttachment, attachment_id)
    if not a:
        raise HTTPException(status_code=404, detail="File not found")
    v = db.get(Visit, a.visit_id)
    c = db.get(PatientCase, v.case_id)
    _require_open(c)
    if a.uploaded_by != user.id and not user.is_superuser:
        raise HTTPException(status_code=403, detail="Only the person who uploaded the file (or an Admin) can remove it")
    path = a.storage_path
    db.delete(a)
    _audit(db, user, "DELETE", "VISIT_FILE", attachment_id, {"case": c.case_number, "file": a.file_name})
    notify(db, "visits")
    db.commit()
    storage.delete(path)
    return _case_out(db, _load_case(db, c.id))


@router.post("/cases/{case_id}/finalize")
def finalize_case(case_id: UUID, payload: FinalizeIn, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("visits.finalize"))):
    c = _load_case(db, case_id)
    _require_open(c)
    c.status, c.finalized_at, c.finalized_by = "FINALIZED", datetime.now(timezone.utc), user.id
    c.final_notes = (payload.final_notes or "").strip() or None
    _audit(db, user, "FINALIZE", "CASE", c.id, {"case": c.case_number, "visits": len(c.visits)})
    notify(db, "visits", "patients")
    db.commit()
    return _case_out(db, _load_case(db, c.id))


@router.post("/cases/{case_id}/reopen")
def reopen_case(case_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("visits.reopen"))):
    c = _load_case(db, case_id)
    if c.status != "FINALIZED":
        raise HTTPException(status_code=409, detail="Case is already open")
    c.status, c.finalized_at, c.finalized_by = "OPEN", None, None
    _audit(db, user, "REOPEN", "CASE", c.id, {"case": c.case_number})
    notify(db, "visits", "patients")
    db.commit()
    return _case_out(db, _load_case(db, c.id))
