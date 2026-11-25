from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core import roles as R
from app.core.database import get_db
from app.core.dependencies import granted_permissions, require_permission
from app.core.realtime import notify
from app.core.security import hash_password
from app.modules.audit.models import AuditLog
from app.modules.auth.models import Role, User, UserRole
from app.modules.auth.models_extra import UserSession
from app.modules.billing.service import next_number
from app.modules.patients.models import Patient
from app.modules.patients.schemas import PasswordIn, PatientCreate, PatientRead, PatientUpdate, PortalLogin

router = APIRouter(prefix="/patients", tags=["Patients"])


def _is_patient_only(actor: User) -> bool:
    roles = {ur.role.name for ur in actor.user_roles}
    return "PATIENT" in roles and not actor.is_superuser and roles == {"PATIENT"}


def _set_age(patient: Patient, age: int | None) -> None:
    patient.age_years = age
    patient.age_recorded_on = date.today() if age is not None else None


def _create_login(db: Session, patient: Patient, login: PortalLogin) -> User:
    """Create the patient's portal account (role PATIENT) and link it to the patient record."""
    if patient.user_id:
        raise HTTPException(status_code=409, detail="This patient already has a login")
    if db.scalar(select(User.id).where(func.lower(User.username) == login.username.lower())):
        raise HTTPException(status_code=409, detail=f"Username '{login.username}' is already taken")
    if patient.email and db.scalar(select(User.id).where(func.lower(User.email) == patient.email.lower())):
        raise HTTPException(status_code=409, detail="This email is already used by another account")
    user = User(username=login.username, email=patient.email or None, phone=patient.phone,
                password_hash=hash_password(login.password), is_active=True, is_superuser=False,
                must_change_password=True)
    db.add(user)
    db.flush()
    role = db.scalar(select(Role).where(Role.name == R.PATIENT))
    db.add(UserRole(user_id=user.id, role_id=role.id))
    patient.user_id = user.id
    return user


def _require_portal_permission(actor: User) -> None:
    if not (actor.is_superuser or "patients.portal.manage" in granted_permissions(actor)):
        raise HTTPException(status_code=403, detail="You cannot create patient logins")


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate, db: Session = Depends(get_db),
                   actor: User = Depends(require_permission("patients.create"))):
    data = payload.model_dump(exclude={"age", "login"})
    data["mrn"] = (data["mrn"] or "").strip().upper() or next_number(db, "MRN")
    data["email"] = (data.get("email") or "").strip() or None
    if db.scalar(select(Patient.id).where(Patient.mrn == data["mrn"])):
        raise HTTPException(status_code=409, detail="MRN already exists")
    patient = Patient(**data)
    _set_age(patient, payload.age)
    db.add(patient)
    db.flush()
    if payload.login:
        _require_portal_permission(actor)
        _create_login(db, patient, payload.login)
    db.add(AuditLog(actor_user_id=actor.id, action="CREATE", entity_type="PATIENT",
                    entity_id=str(patient.id), new_values={"mrn": patient.mrn, "login": bool(payload.login)}))
    notify(db, "patients")
    db.commit()
    db.refresh(patient)
    return patient


@router.get("/{patient_id}", response_model=PatientRead)
def get_patient(patient_id: UUID, db: Session = Depends(get_db),
                actor: User = Depends(require_permission("patients.read"))):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if _is_patient_only(actor) and patient.user_id != actor.id:
        raise HTTPException(status_code=403, detail="Cannot access another patient's record")
    return patient


@router.patch("/{patient_id}", response_model=PatientRead)
def update_patient(patient_id: UUID, payload: PatientUpdate, db: Session = Depends(get_db),
                   actor: User = Depends(require_permission("patients.update"))):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    changes = payload.model_dump(exclude_unset=True)
    old = {k: str(getattr(patient, k, None)) for k in changes}
    if "age" in changes:
        _set_age(patient, changes.pop("age"))
    for key, value in changes.items():
        setattr(patient, key, value)
    if patient.user and ("phone" in changes or "email" in changes):
        patient.user.phone = patient.phone
        patient.user.email = patient.email or None
    db.add(AuditLog(actor_user_id=actor.id, action="UPDATE", entity_type="PATIENT", entity_id=str(patient.id),
                    old_values=old, new_values={k: str(v) for k, v in payload.model_dump(exclude_unset=True).items()}))
    notify(db, "patients")
    db.commit()
    db.refresh(patient)
    return patient


@router.post("/{patient_id}/login", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
def create_portal_login(patient_id: UUID, payload: PortalLogin, db: Session = Depends(get_db),
                        actor: User = Depends(require_permission("patients.portal.manage"))):
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    _create_login(db, patient, payload)
    db.add(AuditLog(actor_user_id=actor.id, action="CREATE_LOGIN", entity_type="PATIENT", entity_id=str(patient.id),
                    new_values={"username": payload.username}))
    notify(db, "patients")
    db.commit()
    db.refresh(patient)
    return patient


@router.post("/{patient_id}/login/reset-password", response_model=PatientRead)
def reset_portal_password(patient_id: UUID, payload: PasswordIn, db: Session = Depends(get_db),
                          actor: User = Depends(require_permission("patients.portal.manage"))):
    patient = db.get(Patient, patient_id)
    if not patient or not patient.user:
        raise HTTPException(status_code=404, detail="This patient has no login")
    patient.user.password_hash = hash_password(payload.password)
    patient.user.must_change_password = True
    db.execute(update(UserSession).where(UserSession.user_id == patient.user.id, UserSession.revoked_at.is_(None))
               .values(revoked_at=datetime.now(timezone.utc)))
    db.add(AuditLog(actor_user_id=actor.id, action="PASSWORD_RESET", entity_type="PATIENT", entity_id=str(patient.id),
                    new_values={"username": patient.user.username}))
    db.commit()
    db.refresh(patient)
    return patient


@router.get("", response_model=list[PatientRead])
def list_patients(q: str | None = None, limit: int = Query(default=50, ge=1, le=200),
                  db: Session = Depends(get_db),
                  actor: User = Depends(require_permission("patients.read"))):
    stmt = select(Patient).order_by(Patient.created_at.desc())
    if _is_patient_only(actor):
        stmt = stmt.where(Patient.user_id == actor.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.mrn.ilike(like), Patient.first_name.ilike(like),
                              Patient.last_name.ilike(like), Patient.phone.ilike(like)))
    return db.scalars(stmt.limit(limit)).unique().all()
