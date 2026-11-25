from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.realtime import notify
from app.core.database import get_db
from app.core.dependencies import require_permission
from app.core.security import hash_password
from app.modules.auth.models import User, Role, Permission, UserRole
from app.modules.hospital.models import Department, Employee, StaffTask, TaskAssignment, Notification
from app.modules.patients.models import Patient
from app.modules.audit.models import AuditLog
from pydantic import BaseModel, Field

router = APIRouter(tags=["Foundation"])


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: str | None = None
    password: str = Field(min_length=12, max_length=128)
    role_names: list[str] = []
    is_active: bool = True


class UserUpdate(BaseModel):
    email: str | None = None
    is_active: bool | None = None
    must_change_password: bool | None = None


class EmployeeCreate(BaseModel):
    department_id: UUID
    employee_code: str = Field(min_length=2, max_length=40)
    full_name: str = Field(min_length=2, max_length=180)
    designation: str = Field(min_length=2, max_length=100)
    user_id: UUID | None = None


@router.get("/users")
def list_users(q: str | None = None, limit: int = Query(default=50, ge=1, le=200),
              db: Session = Depends(get_db),
              user: User = Depends(require_permission("users.read"))):
    stmt = select(User)
    if q:
        stmt = stmt.where(User.username.ilike(f"%{q}%"))
    rows = db.scalars(stmt.limit(limit)).all()
    return [{"id": str(x.id), "username": x.username, "email": x.email,
             "is_active": x.is_active, "must_change_password": x.must_change_password,
             "roles": [ur.role.name for ur in x.user_roles]} for x in rows]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db),
                actor: User = Depends(require_permission("users.create"))):
    if db.scalar(select(User.id).where(User.username == payload.username)):
        raise HTTPException(status_code=409, detail="Username already exists")
    roles = list(db.scalars(select(Role).where(Role.name.in_(payload.role_names))).all())
    if len(roles) != len(set(payload.role_names)):
        raise HTTPException(status_code=400, detail="One or more roles are invalid")
    user = User(username=payload.username, email=payload.email, password_hash=hash_password(payload.password),
                is_active=payload.is_active, must_change_password=True)
    db.add(user)
    db.flush()
    for role in roles:
        db.add(UserRole(user_id=user.id, role_id=role.id))
    db.add(AuditLog(actor_user_id=actor.id, action="CREATE", entity_type="USER",
                    entity_id=str(user.id), new_values={"username": user.username}))
    db.commit()
    return {"id": str(user.id), "username": user.username}


@router.patch("/users/{user_id}")
def update_user(user_id: UUID, payload: UserUpdate, db: Session = Depends(get_db),
                actor: User = Depends(require_permission("users.update"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    changes = payload.model_dump(exclude_unset=True)
    old = {"email": user.email, "is_active": user.is_active,
           "must_change_password": user.must_change_password}
    for key, value in changes.items():
        setattr(user, key, value)
    db.add(AuditLog(actor_user_id=actor.id, action="UPDATE", entity_type="USER",
                    entity_id=str(user.id), old_values=old, new_values=changes))
    db.commit()
    return {"id": str(user.id), "username": user.username}


@router.patch("/users/{user_id}/status")
def set_status(user_id: UUID, is_active: bool, db: Session = Depends(get_db),
               actor: User = Depends(require_permission("users.deactivate"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = is_active
    db.commit()
    return {"id": str(user.id), "is_active": is_active}


@router.put("/users/{user_id}/roles")
def set_roles(user_id: UUID, role_names: list[str], db: Session = Depends(get_db),
              actor: User = Depends(require_permission("roles.manage"))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    roles = list(db.scalars(select(Role).where(Role.name.in_(role_names))).all())
    if len(roles) != len(set(role_names)):
        raise HTTPException(status_code=400, detail="One or more roles are invalid")
    db.query(UserRole).filter(UserRole.user_id == user.id).delete()
    for role in roles:
        db.add(UserRole(user_id=user.id, role_id=role.id))
    db.commit()
    return {"roles": role_names}


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: UUID, password: str, db: Session = Depends(get_db),
                   actor: User = Depends(require_permission("users.update"))):
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must contain at least 12 characters")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(password)
    user.must_change_password = True
    db.commit()
    return {"status": "password_reset"}


@router.get("/roles")
def roles(db: Session = Depends(get_db), user: User = Depends(require_permission("roles.manage"))):
    return [{"id": str(r.id), "name": r.name, "description": r.description,
             "permissions": [p.key for p in r.permissions]} for r in db.scalars(select(Role)).all()]


@router.get("/permissions")
def permissions(db: Session = Depends(get_db), user: User = Depends(require_permission("roles.manage"))):
    return [{"id": str(p.id), "key": p.key, "module": p.module, "description": p.description}
            for p in db.scalars(select(Permission)).all()]


@router.get("/departments")
def departments(db: Session = Depends(get_db), user: User = Depends(require_permission("employees.read"))):
    return [{"id": str(d.id), "code": d.code, "name": d.name, "is_active": d.is_active}
            for d in db.scalars(select(Department)).all()]


@router.post("/departments")
def create_department(code: str, name: str, db: Session = Depends(get_db),
                      actor: User = Depends(require_permission("employees.create"))):
    if db.scalar(select(Department.id).where((Department.code == code) | (Department.name == name))):
        raise HTTPException(status_code=409, detail="Department already exists")
    item = Department(code=code, name=name)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.patch("/departments/{department_id}")
def update_department(department_id: UUID, code: str | None = None, name: str | None = None,
                      is_active: bool | None = None, db: Session = Depends(get_db),
                      actor: User = Depends(require_permission("employees.update"))):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    for key, value in {"code": code, "name": name, "is_active": is_active}.items():
        if value is not None:
            setattr(department, key, value)
    db.commit()
    return {"id": str(department.id), "code": department.code, "name": department.name,
            "is_active": department.is_active}


@router.get("/employees")
def employees(db: Session = Depends(get_db), user: User = Depends(require_permission("employees.read"))):
    return [{"id": str(e.id), "employee_code": e.employee_code, "full_name": e.full_name,
             "designation": e.designation, "employment_status": e.employment_status,
             "department_id": str(e.department_id)} for e in db.scalars(select(Employee)).all()]


@router.post("/employees", status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db),
                    actor: User = Depends(require_permission("employees.create"))):
    if not db.get(Department, payload.department_id):
        raise HTTPException(status_code=404, detail="Department not found")
    if db.scalar(select(Employee.id).where(Employee.employee_code == payload.employee_code)):
        raise HTTPException(status_code=409, detail="Employee code already exists")
    employee = Employee(**payload.model_dump())
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return {"id": str(employee.id), "employee_code": employee.employee_code,
            "full_name": employee.full_name}


@router.get("/notifications")
def notifications(db: Session = Depends(get_db), user: User = Depends(require_permission("users.read"))):
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id).limit(50)).all()
    return [{"id": str(n.id), "title": n.title, "body": n.body, "is_read": n.is_read}
            for n in rows]


@router.get("/audit-logs")
def audit_logs(q: str | None = None, entity: str | None = None, action: str | None = None,
               before: str | None = None, limit: int = Query(default=100, ge=1, le=500),
               db: Session = Depends(get_db), user: User = Depends(require_permission("audit.read"))):
    """Who did what, when (newest first). `before` = created_at of the last row, to load older entries."""
    stmt = select(AuditLog, User.username).outerjoin(User, User.id == AuditLog.actor_user_id).order_by(AuditLog.created_at.desc())
    if entity:
        stmt = stmt.where(AuditLog.entity_type == entity.upper())
    if action:
        stmt = stmt.where(AuditLog.action == action.upper())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where((User.username.ilike(like)) | (AuditLog.entity_id.ilike(like)) | (AuditLog.entity_type.ilike(like)))
    if before:
        stmt = stmt.where(AuditLog.created_at < before)
    rows = db.execute(stmt.limit(limit)).all()
    names = {e.user_id: e.full_name for e in db.scalars(select(Employee).where(Employee.user_id.in_({a.actor_user_id for a, _ in rows if a.actor_user_id})))} if rows else {}
    entities = sorted(db.scalars(select(AuditLog.entity_type).distinct()).all())
    return {"entities": entities, "has_more": len(rows) == limit,
            "rows": [{"id": str(a.id), "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id,
                      "actor": names.get(a.actor_user_id) or uname, "actor_username": uname,
                      "old_values": a.old_values, "new_values": a.new_values, "created_at": a.created_at.isoformat()} for a, uname in rows]}


@router.get("/dashboard/summary")
def dashboard(db: Session = Depends(get_db), user: User = Depends(require_permission("reports.read"))):
    return {
        "total_registered_patients": db.scalar(select(func.count()).select_from(Patient)) or 0,
        "total_employees": db.scalar(select(func.count()).select_from(Employee)) or 0,
        "total_departments": db.scalar(select(func.count()).select_from(Department)) or 0,
        "active_user_accounts": db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0,
        "pending_staff_tasks": db.scalar(select(func.count()).select_from(StaffTask).where(StaffTask.status == "PENDING")) or 0,
    }
