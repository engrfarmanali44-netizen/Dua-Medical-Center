"""Chat API with the client's rules on who may talk to whom.

    Doctor  <-> Patient, Admin, HR, Nurse, Doctor
    Patient <-> Doctor, Admin only
    Admin   <-> everyone who uses chat
A pair may chat only if BOTH sides' rules allow it; the rule is re-checked on every message, so a
role change applies to existing conversations immediately. Message text never goes through the
realtime channel: clients get a "chat changed" signal and fetch messages through this API.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core import roles as R
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.realtime import notify
from app.modules.auth.models import Role, User, UserRole
from app.modules.chat.models import Conversation, Message, Participant
from app.modules.hospital.models import Employee
from app.modules.patients.models import Patient

router = APIRouter(prefix="/chat", tags=["Chat"])

ALLOWED: dict[str, set[str]] = {
    R.DOCTOR: {R.PATIENT, R.ADMIN, R.HR, R.NURSE, R.DOCTOR},
    R.PATIENT: {R.DOCTOR, R.ADMIN},
    R.ADMIN: {R.DOCTOR, R.NURSE, R.HR, R.PATIENT, R.ADMIN},
    R.HR: {R.DOCTOR, R.ADMIN},
    R.NURSE: {R.DOCTOR, R.ADMIN},
}


class StartIn(BaseModel):
    user_id: UUID


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


# ------------------------------------------------------------------ helpers

def _role(db: Session, user_id) -> str | None:
    return db.scalar(select(Role.name).join(UserRole, UserRole.role_id == Role.id).where(UserRole.user_id == user_id))


def _my_role(user: User) -> str:
    role = user.user_roles[0].role.name if user.user_roles else None
    if role not in ALLOWED:
        raise HTTPException(status_code=403, detail="Chat is not available for your role")
    return role


def _may_chat(a: str | None, b: str | None) -> bool:
    return bool(a and b and b in ALLOWED.get(a, set()) and a in ALLOWED.get(b, set()))


def _display(db: Session, user_ids) -> dict:
    """user_id -> {name, role, active} using staff / patient names where available."""
    ids = list({i for i in user_ids if i})
    if not ids:
        return {}
    out = {u.id: {"name": u.username, "role": None, "active": u.is_active}
           for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
    for uid, name in db.execute(select(UserRole.user_id, Role.name).join(Role, Role.id == UserRole.role_id).where(UserRole.user_id.in_(ids))).all():
        out[uid]["role"] = name
    for e in db.scalars(select(Employee).where(Employee.user_id.in_(ids))).all():
        out[e.user_id]["name"] = e.full_name
        out[e.user_id]["detail"] = e.designation
    for p in db.scalars(select(Patient).where(Patient.user_id.in_(ids))).all():
        out[p.user_id]["name"] = f"{p.first_name} {p.last_name or ''}".strip()
        out[p.user_id]["detail"] = p.mrn
    return out


def _participant(db: Session, conversation_id: UUID, user: User) -> Participant:
    p = db.get(Participant, (conversation_id, user.id))
    if not p:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return p


def _other_id(db: Session, conversation_id: UUID, me) -> UUID | None:
    return db.scalar(select(Participant.user_id).where(Participant.conversation_id == conversation_id, Participant.user_id != me))


def _msg_out(m: Message, me) -> dict:
    return {"id": str(m.id), "body": m.body, "created_at": m.created_at.isoformat(), "mine": m.sender_id == me,
            "sender_id": str(m.sender_id)}


def _unread_count(db: Session, conversation_id, user_id, last_read_at) -> int:
    stmt = select(func.count()).select_from(Message).where(Message.conversation_id == conversation_id, Message.sender_id != user_id)
    if last_read_at:
        stmt = stmt.where(Message.created_at > last_read_at)
    return int(db.scalar(stmt) or 0)


# ------------------------------------------------------------------ endpoints

@router.get("/contacts")
def contacts(q: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """People this user is allowed to start a chat with."""
    mine = _my_role(user)
    roles = sorted(r for r in ALLOWED[mine] if _may_chat(mine, r))
    stmt = (select(User.id).join(UserRole, UserRole.user_id == User.id).join(Role, Role.id == UserRole.role_id)
            .where(Role.name.in_(roles), User.is_active.is_(True), User.id != user.id))
    if q:
        like = f"%{q.strip()}%"
        stmt = (stmt.outerjoin(Employee, Employee.user_id == User.id).outerjoin(Patient, Patient.user_id == User.id)
                .where(or_(User.username.ilike(like), Employee.full_name.ilike(like), Patient.first_name.ilike(like),
                           Patient.last_name.ilike(like), Patient.mrn.ilike(like))))
    ids = db.scalars(stmt.limit(200)).all()
    people = _display(db, ids)
    return sorted(({"user_id": str(i), **people[i]} for i in ids), key=lambda p: (p["role"] != R.DOCTOR, p["name"].lower()))


@router.get("/conversations")
def conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _my_role(user)
    rows = db.execute(select(Conversation, Participant.last_read_at)
                      .join(Participant, and_(Participant.conversation_id == Conversation.id, Participant.user_id == user.id))
                      .order_by(Conversation.last_message_at.desc().nulls_last())).all()
    others = {c.id: _other_id(db, c.id, user.id) for c, _ in rows}
    people = _display(db, others.values())
    out = []
    for c, last_read in rows:
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.created_at.desc()).limit(1))
        other = people.get(others[c.id], {"name": "Unknown", "role": None, "active": False})
        out.append({"id": str(c.id), "with": {"user_id": str(others[c.id]), **other},
                    "last_message": None if not last else {"body": last.body[:120], "created_at": last.created_at.isoformat(), "mine": last.sender_id == user.id},
                    "unread": _unread_count(db, c.id, user.id, last_read)})
    return out


@router.get("/unread")
def unread_total(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    role = user.user_roles[0].role.name if user.user_roles else None
    if role not in ALLOWED:
        return {"unread": 0}
    rows = db.execute(select(Participant.conversation_id, Participant.last_read_at).where(Participant.user_id == user.id)).all()
    return {"unread": sum(_unread_count(db, cid, user.id, lr) for cid, lr in rows)}


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def start(payload: StartIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mine = _my_role(user)
    other = db.get(User, payload.user_id)
    if not other or not other.is_active or other.id == user.id:
        raise HTTPException(status_code=404, detail="Person not found")
    if not _may_chat(mine, _role(db, other.id)):
        raise HTTPException(status_code=403, detail="You are not allowed to chat with this person")
    a, b = sorted([str(user.id), str(other.id)])
    key = f"{a}|{b}"
    conv = db.scalar(select(Conversation).where(Conversation.pair_key == key))
    if not conv:
        conv = Conversation(pair_key=key)
        db.add(conv)
        db.flush()
        db.add_all([Participant(conversation_id=conv.id, user_id=user.id), Participant(conversation_id=conv.id, user_id=other.id)])
        db.commit()
    return {"id": str(conv.id), "with": {"user_id": str(other.id), **_display(db, [other.id])[other.id]}}


@router.get("/conversations/{conversation_id}/messages")
def messages(conversation_id: UUID, before: datetime | None = None, limit: int = Query(default=50, ge=1, le=200),
             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _my_role(user)
    _participant(db, conversation_id, user)
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before:
        stmt = stmt.where(Message.created_at < before)
    rows = list(db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit)).all())
    other = _other_id(db, conversation_id, user.id)
    other_read = db.scalar(select(Participant.last_read_at).where(Participant.conversation_id == conversation_id, Participant.user_id == other))
    return {"messages": [_msg_out(m, user.id) for m in reversed(rows)], "has_more": len(rows) == limit,
            "other_last_read_at": other_read.isoformat() if other_read else None,
            "can_send": _may_chat(_my_role(user), _role(db, other)) and bool(db.scalar(select(User.is_active).where(User.id == other)))}


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def send(conversation_id: UUID, payload: MessageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    mine = _my_role(user)
    me = _participant(db, conversation_id, user)
    other = _other_id(db, conversation_id, user.id)
    other_user = db.get(User, other) if other else None
    if not other_user or not other_user.is_active or not _may_chat(mine, _role(db, other)):
        raise HTTPException(status_code=403, detail="You can no longer send messages in this conversation")
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message is empty")
    now = datetime.now(timezone.utc)
    m = Message(conversation_id=conversation_id, sender_id=user.id, body=body, created_at=now)
    db.add(m)
    db.get(Conversation, conversation_id).last_message_at = now
    me.last_read_at = now
    notify(db, "chat")
    db.commit()
    return _msg_out(m, user.id)


@router.post("/conversations/{conversation_id}/read")
def mark_read(conversation_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _participant(db, conversation_id, user)
    p.last_read_at = datetime.now(timezone.utc)
    notify(db, "chat")  # lets the sender see "seen"
    db.commit()
    return {"status": "ok"}
