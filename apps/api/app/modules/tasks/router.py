"""Daily task assignment.

Admin / HR (tasks.assign) assign tasks to staff for a date; assigning to several people creates
one task per person so each person's progress is tracked on its own. Every staff member sees
their own tasks and moves them PENDING -> IN_PROGRESS -> COMPLETED (with an optional note).
"""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, granted_permissions, require_permission
from app.core.realtime import notify
from app.modules.auth.models import Role, User, UserRole
from app.modules.billing.service import today_pkt
from app.modules.hospital.models import TASK_PRIORITIES, TASK_STATUSES, Employee, StaffTask, TaskAssignment

router = APIRouter(prefix="/tasks", tags=["Daily tasks"])


class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    priority: str = "NORMAL"
    due_date: date | None = None
    assignee_user_ids: list[UUID] = Field(min_length=1, max_length=100)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    priority: str | None = None
    due_date: date | None = None


class StatusIn(BaseModel):
    status: str
    note: str | None = Field(default=None, max_length=500)


def _is_assigner(user: User) -> bool:
    return user.is_superuser or "tasks.assign" in granted_permissions(user)


def _people(db: Session, user_ids) -> dict:
    ids = [i for i in set(user_ids) if i]
    if not ids:
        return {}
    out = {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
    for e in db.scalars(select(Employee).where(Employee.user_id.in_(ids))).all():
        out[e.user_id] = e.full_name
    return out


def _rows(db: Session, stmt) -> list[dict]:
    rows = db.execute(stmt).all()
    names = _people(db, [a.assignee_user_id for _, a in rows] + [t.created_by for t, _ in rows])
    today = today_pkt()
    return [{"id": str(t.id), "title": t.title, "description": t.description, "priority": t.priority, "status": t.status,
             "due_date": t.due_date.isoformat() if t.due_date else None,
             "overdue": bool(t.due_date and t.due_date < today and t.status in ("PENDING", "IN_PROGRESS")),
             "assignee": {"user_id": str(a.assignee_user_id), "name": names.get(a.assignee_user_id)},
             "assigned_by": names.get(t.created_by), "created_at": t.created_at.isoformat(),
             "completed_at": t.completed_at.isoformat() if t.completed_at else None, "completion_note": t.completion_note}
            for t, a in rows]


def _base():
    return select(StaffTask, TaskAssignment).join(TaskAssignment, TaskAssignment.task_id == StaffTask.id)


def _get(db: Session, task_id: UUID) -> tuple[StaffTask, TaskAssignment]:
    row = db.execute(_base().where(StaffTask.id == task_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return row


@router.get("/assignees")
def assignees(db: Session = Depends(get_db), user: User = Depends(require_permission("tasks.assign"))):
    """Active staff (not patients) who can receive tasks."""
    rows = db.execute(select(Employee, Role.name).join(User, User.id == Employee.user_id)
                      .join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id)
                      .where(User.is_active.is_(True), Employee.employment_status != "LEFT", Role.name != "PATIENT")
                      .order_by(Employee.full_name)).all()
    return [{"user_id": str(e.user_id), "name": e.full_name, "designation": e.designation, "role": role} for e, role in rows]


@router.get("/mine")
def my_tasks(scope: str = Query(default="open", pattern="^(open|done|all)$"), db: Session = Depends(get_db),
             user: User = Depends(get_current_user)):
    stmt = _base().where(TaskAssignment.assignee_user_id == user.id)
    if scope == "open":
        stmt = stmt.where(StaffTask.status.in_(("PENDING", "IN_PROGRESS")))
    elif scope == "done":
        stmt = stmt.where(StaffTask.status.in_(("COMPLETED", "CANCELLED")))
    return _rows(db, stmt.order_by(StaffTask.due_date.asc().nulls_last(), StaffTask.created_at.desc()).limit(300))


@router.get("")
def list_tasks(day: date | None = Query(default=None, alias="date"), assignee: UUID | None = None,
               status_: str | None = Query(default=None, alias="status"), db: Session = Depends(get_db),
               user: User = Depends(require_permission("tasks.assign"))):
    """Tasks for a date (default today) plus anything still open from earlier days."""
    day = day or today_pkt()
    stmt = _base().where(or_(StaffTask.due_date == day,
                             and_(StaffTask.due_date < day, StaffTask.status.in_(("PENDING", "IN_PROGRESS")))))
    if assignee:
        stmt = stmt.where(TaskAssignment.assignee_user_id == assignee)
    if status_ in TASK_STATUSES:
        stmt = stmt.where(StaffTask.status == status_)
    return _rows(db, stmt.order_by(StaffTask.due_date.asc(), StaffTask.priority.desc(), StaffTask.created_at))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_tasks(payload: TaskIn, db: Session = Depends(get_db), user: User = Depends(require_permission("tasks.assign"))):
    if payload.priority not in TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    if payload.due_date and payload.due_date < today_pkt():
        raise HTTPException(status_code=400, detail="The task date cannot be in the past")
    ids = list(dict.fromkeys(payload.assignee_user_ids))
    valid = set(db.scalars(select(User.id).join(Employee, Employee.user_id == User.id)
                           .where(User.id.in_(ids), User.is_active.is_(True))).all())
    if set(ids) - valid:
        raise HTTPException(status_code=400, detail="Tasks can only be assigned to active staff")
    created = []
    for uid in ids:
        t = StaffTask(title=payload.title.strip(), description=(payload.description or "").strip() or None,
                      priority=payload.priority, status="PENDING", due_date=payload.due_date or today_pkt(), created_by=user.id)
        db.add(t)
        db.flush()
        db.add(TaskAssignment(task_id=t.id, assignee_user_id=uid))
        created.append(t.id)
    notify(db, "tasks")
    db.commit()
    return _rows(db, _base().where(StaffTask.id.in_(created)))


@router.patch("/{task_id}")
def update_task(task_id: UUID, payload: TaskUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission("tasks.assign"))):
    t, _ = _get(db, task_id)
    if t.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=409, detail="This task is already closed")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("priority") and changes["priority"] not in TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    for k, v in changes.items():
        setattr(t, k, v.strip() if isinstance(v, str) else v)
    notify(db, "tasks")
    db.commit()
    return _rows(db, _base().where(StaffTask.id == t.id))[0]


@router.post("/{task_id}/status")
def set_status(task_id: UUID, payload: StatusIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t, a = _get(db, task_id)
    mine = a.assignee_user_id == user.id
    if not mine and not _is_assigner(user):
        raise HTTPException(status_code=404, detail="Task not found")
    if payload.status not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if payload.status == "CANCELLED" and not _is_assigner(user):
        raise HTTPException(status_code=403, detail="Only Admin or HR can cancel a task")
    t.status = payload.status
    t.completed_at = datetime.now(timezone.utc) if payload.status == "COMPLETED" else None
    if payload.note is not None:
        t.completion_note = payload.note.strip() or None
    notify(db, "tasks")
    db.commit()
    return _rows(db, _base().where(StaffTask.id == t.id))[0]
