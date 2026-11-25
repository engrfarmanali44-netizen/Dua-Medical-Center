"""Staff management (client requirement: Admin registers staff with a role; HR can add staff).

Every staff member = an employee record + a login with exactly one role. The role decides which
portal they see. Rules:
- Admin and HR can register staff and edit staff details.
- Only Admin can change roles, reset passwords, and activate/deactivate accounts.
- HR can never create, edit or see the password controls of an Admin account.
- Nobody can deactivate their own account (prevents locking yourself out).
"""
import re
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core import roles as R
from app.core.database import get_db
from app.core.dependencies import granted_permissions, require_permission, require_permissions
from app.core.realtime import notify
from app.core.security import hash_password
from app.modules.audit.models import AuditLog
from app.modules.auth.models import Role, User, UserRole
from app.modules.auth.models_extra import UserSession
from app.modules.billing.service import next_number
from app.modules.hospital.models import Department, Employee

router = APIRouter(prefix="/staff", tags=["Staff"])

EMPLOYMENT_STATUSES = ("ACTIVE", "ON_LEAVE", "LEFT")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,40}$")


# ------------------------------------------------------------------ schemas

def _clean_cnic(v: str | None) -> str | None:
    if v is None or not v.strip():
        return None
    digits = re.sub(r"\D", "", v)
    if len(digits) != 13:
        raise ValueError("CNIC must have 13 digits (e.g. 35202-1234567-1)")
    return digits


class StaffCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=180)
    role: str
    department_id: UUID
    designation: str = Field(min_length=2, max_length=100)
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=12, max_length=128)
    cnic: str | None = None
    phone: str = Field(min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = None
    joining_date: date | None = None

    @field_validator("cnic")
    @classmethod
    def _cnic(cls, v: str | None) -> str | None:
        return _clean_cnic(v)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("Use 3-40 letters, numbers, dots, dashes or underscores (no spaces)")
        return v


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=180)
    department_id: UUID | None = None
    designation: str | None = Field(default=None, min_length=2, max_length=100)
    cnic: str | None = None
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = None
    joining_date: date | None = None
    employment_status: str | None = None

    @field_validator("cnic")
    @classmethod
    def _cnic(cls, v: str | None) -> str | None:
        return _clean_cnic(v)


class RoleChange(BaseModel):
    role: str


class StatusChange(BaseModel):
    is_active: bool


class PasswordReset(BaseModel):
    password: str = Field(min_length=12, max_length=128)


# ------------------------------------------------------------------ helpers

def _role_of(user: User | None) -> str | None:
    return user.user_roles[0].role.name if user and user.user_roles else None


def _is_admin(user: User) -> bool:
    return user.is_superuser or R.ADMIN in {ur.role.name for ur in user.user_roles}


def _assignable_roles(actor: User) -> list[str]:
    return [R.ADMIN, *R.STAFF_ROLES] if _is_admin(actor) else list(R.STAFF_ROLES)


def _fmt_cnic(c: str | None) -> str | None:
    return f"{c[:5]}-{c[5:12]}-{c[12]}" if c and len(c) == 13 else c


def _out(e: Employee) -> dict:
    u = e.user
    return {
        "id": str(e.id), "employee_code": e.employee_code, "full_name": e.full_name, "designation": e.designation,
        "department": {"id": str(e.department.id), "name": e.department.name},
        "cnic": _fmt_cnic(e.cnic), "phone": e.phone, "address": e.address,
        "joining_date": e.joining_date.isoformat() if e.joining_date else None,
        "employment_status": e.employment_status,
        "user": None if u is None else {
            "id": str(u.id), "username": u.username, "email": u.email, "is_active": u.is_active,
            "role": _role_of(u), "must_change_password": u.must_change_password,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        },
    }


def _get(db: Session, employee_id: UUID) -> Employee:
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return e


def _guard_admin_target(actor: User, e: Employee) -> None:
    """HR (non-admin) may not modify Admin accounts."""
    if not _is_admin(actor) and e.user and _role_of(e.user) == R.ADMIN:
        raise HTTPException(status_code=403, detail="Only an Admin can change an Admin's record")


def _role(db: Session, name: str) -> Role:
    role = db.scalar(select(Role).where(Role.name == name))
    if not role:
        raise HTTPException(status_code=400, detail="Unknown role")
    return role


def _check_unique(db: Session, *, username: str | None = None, email: str | None = None,
                  cnic: str | None = None, exclude_user=None, exclude_employee=None) -> None:
    if username and db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
        raise HTTPException(status_code=409, detail=f"Username '{username}' is already taken")
    if email:
        stmt = select(User.id).where(func.lower(User.email) == email.lower())
        if exclude_user is not None:
            stmt = stmt.where(User.id != exclude_user)
        if db.scalar(stmt):
            raise HTTPException(status_code=409, detail="This email is already used by another account")
    if cnic:
        stmt = select(Employee.id).where(Employee.cnic == cnic)
        if exclude_employee is not None:
            stmt = stmt.where(Employee.id != exclude_employee)
        if db.scalar(stmt):
            raise HTTPException(status_code=409, detail="A staff member with this CNIC already exists")


def _revoke_sessions(db: Session, user_id) -> None:
    db.execute(update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
               .values(revoked_at=datetime.now(timezone.utc)))


def _audit(db: Session, actor: User, action: str, e: Employee, values: dict) -> None:
    db.add(AuditLog(actor_user_id=actor.id, action=action, entity_type="STAFF", entity_id=str(e.id), new_values=values))


# ------------------------------------------------------------------ endpoints

@router.get("/options")
def options(db: Session = Depends(get_db), actor: User = Depends(require_permission("employees.read"))):
    """Departments and the roles this user may assign."""
    depts = db.scalars(select(Department).where(Department.is_active.is_(True)).order_by(Department.name)).all()
    return {"departments": [{"id": str(d.id), "name": d.name} for d in depts],
            "roles": [{"name": r, "label": R.ROLE_DESCRIPTIONS[r]} for r in _assignable_roles(actor)],
            "statuses": list(EMPLOYMENT_STATUSES),
            "can": {"change_role": "roles.manage" in granted_permissions(actor),
                    "deactivate": "users.deactivate" in granted_permissions(actor),
                    "reset_password": "users.update" in granted_permissions(actor),
                    "edit": "employees.update" in granted_permissions(actor),
                    "create": {"users.create", "employees.create"} <= granted_permissions(actor)}}


@router.get("")
def list_staff(q: str | None = None, role: str | None = None, active: bool | None = None,
               db: Session = Depends(get_db), actor: User = Depends(require_permission("employees.read"))):
    stmt = select(Employee).outerjoin(User, User.id == Employee.user_id).order_by(Employee.full_name)
    if q:
        like = f"%{q.strip()}%"
        conds = [Employee.full_name.ilike(like), Employee.employee_code.ilike(like), User.username.ilike(like),
                 Employee.phone.ilike(like), Employee.designation.ilike(like)]
        # Search CNICs only when the text looks like (part of) a CNIC: 4+ digits, dashes/spaces allowed.
        if re.fullmatch(r"[\d\s-]+", q.strip()) and len(re.sub(r"\D", "", q)) >= 4:
            conds.append(Employee.cnic.like(f"%{re.sub(r'[^0-9]', '', q)}%"))
        stmt = stmt.where(or_(*conds))
    if active is not None:
        stmt = stmt.where(User.is_active.is_(active))
    if role:
        stmt = stmt.where(Employee.user_id.in_(
            select(UserRole.user_id).join(Role, Role.id == UserRole.role_id).where(Role.name == role)))
    return [_out(e) for e in db.scalars(stmt).unique().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db),
                 actor: User = Depends(require_permissions("users.create", "employees.create"))):
    if payload.role not in _assignable_roles(actor):
        raise HTTPException(status_code=403, detail="You cannot assign this role")
    if not db.get(Department, payload.department_id):
        raise HTTPException(status_code=400, detail="Department not found")
    _check_unique(db, username=payload.username, email=payload.email, cnic=payload.cnic)

    user = User(username=payload.username, email=payload.email or None, phone=payload.phone,
                password_hash=hash_password(payload.password), is_active=True,
                is_superuser=payload.role == R.ADMIN, must_change_password=True)
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=_role(db, payload.role).id))
    e = Employee(user_id=user.id, department_id=payload.department_id, employee_code=next_number(db, "EMP"),
                 full_name=payload.full_name.strip(), designation=payload.designation.strip(), cnic=payload.cnic,
                 phone=payload.phone, address=payload.address, joining_date=payload.joining_date,
                 employment_status="ACTIVE")
    db.add(e)
    db.flush()
    _audit(db, actor, "CREATE", e, {"name": e.full_name, "username": user.username, "role": payload.role})
    notify(db, "staff")
    db.commit()
    db.refresh(e)
    return _out(e)


@router.get("/{employee_id}")
def get_staff(employee_id: UUID, db: Session = Depends(get_db),
              actor: User = Depends(require_permission("employees.read"))):
    return _out(_get(db, employee_id))


@router.patch("/{employee_id}")
def update_staff(employee_id: UUID, payload: StaffUpdate, db: Session = Depends(get_db),
                 actor: User = Depends(require_permission("employees.update"))):
    e = _get(db, employee_id)
    _guard_admin_target(actor, e)
    changes = payload.model_dump(exclude_unset=True)
    if "employment_status" in changes and changes["employment_status"] not in EMPLOYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid employment status")
    if changes.get("department_id") and not db.get(Department, changes["department_id"]):
        raise HTTPException(status_code=400, detail="Department not found")
    _check_unique(db, email=changes.get("email"), cnic=changes.get("cnic"),
                  exclude_user=e.user_id, exclude_employee=e.id)
    for key in ("full_name", "department_id", "designation", "cnic", "phone", "address", "joining_date", "employment_status"):
        if key in changes:
            setattr(e, key, changes[key])
    if e.user and "email" in changes:
        e.user.email = changes["email"] or None
    if e.user and "phone" in changes:
        e.user.phone = changes["phone"]
    _audit(db, actor, "UPDATE", e, {k: str(v) for k, v in changes.items()})
    notify(db, "staff")
    db.commit()
    db.refresh(e)
    return _out(e)


@router.put("/{employee_id}/role")
def change_role(employee_id: UUID, payload: RoleChange, db: Session = Depends(get_db),
                actor: User = Depends(require_permission("roles.manage"))):
    e = _get(db, employee_id)
    if not e.user:
        raise HTTPException(status_code=400, detail="This staff member has no login")
    if payload.role not in _assignable_roles(actor):
        raise HTTPException(status_code=403, detail="You cannot assign this role")
    if e.user.id == actor.id and payload.role != R.ADMIN:
        raise HTTPException(status_code=400, detail="You cannot remove your own Admin role")
    old = _role_of(e.user)
    db.execute(UserRole.__table__.delete().where(UserRole.user_id == e.user.id))
    db.add(UserRole(user_id=e.user.id, role_id=_role(db, payload.role).id))
    e.user.is_superuser = payload.role == R.ADMIN
    _revoke_sessions(db, e.user.id)  # they sign in again and land in the new portal
    _audit(db, actor, "ROLE_CHANGE", e, {"from": old, "to": payload.role})
    notify(db, "staff")
    db.commit()
    db.expire_all()
    return _out(_get(db, employee_id))


@router.put("/{employee_id}/status")
def set_status(employee_id: UUID, payload: StatusChange, db: Session = Depends(get_db),
               actor: User = Depends(require_permission("users.deactivate"))):
    e = _get(db, employee_id)
    if not e.user:
        raise HTTPException(status_code=400, detail="This staff member has no login")
    if e.user.id == actor.id and not payload.is_active:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    e.user.is_active = payload.is_active
    if not payload.is_active:
        _revoke_sessions(db, e.user.id)
    _audit(db, actor, "ACTIVATE" if payload.is_active else "DEACTIVATE", e, {"username": e.user.username})
    notify(db, "staff")
    db.commit()
    db.refresh(e)
    return _out(e)


@router.post("/{employee_id}/reset-password")
def reset_password(employee_id: UUID, payload: PasswordReset, db: Session = Depends(get_db),
                   actor: User = Depends(require_permission("users.update"))):
    e = _get(db, employee_id)
    if not e.user:
        raise HTTPException(status_code=400, detail="This staff member has no login")
    e.user.password_hash = hash_password(payload.password)
    e.user.must_change_password = True
    _revoke_sessions(db, e.user.id)
    _audit(db, actor, "PASSWORD_RESET", e, {"username": e.user.username})
    db.commit()
    return {"status": "password_reset", "must_change_password": True}
