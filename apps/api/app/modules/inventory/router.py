"""Hospital inventory API. HR and Admin add / edit / adjust items (inventory.manage); only Admin deletes (inventory.delete)."""
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import require_permission
from app.core.realtime import notify
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.billing.service import money, next_number
from app.modules.hospital.models import Employee
from app.modules.inventory.models import ASSET_CATEGORIES, ASSET_CONDITIONS, AssetAdjustment, AssetItem

router = APIRouter(prefix="/inventory", tags=["Hospital inventory"])


class ItemIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: str
    location: str | None = Field(default=None, max_length=160)
    quantity: int = Field(ge=0, le=1_000_000)
    unit: str = Field(default="piece", min_length=1, max_length=30)
    condition: str = "GOOD"
    unit_cost: Decimal | None = Field(default=None, ge=0)
    purchase_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    category: str | None = None
    location: str | None = Field(default=None, max_length=160)
    unit: str | None = Field(default=None, min_length=1, max_length=30)
    condition: str | None = None
    unit_cost: Decimal | None = Field(default=None, ge=0)
    purchase_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class AdjustIn(BaseModel):
    change: int = Field(ge=-1_000_000, le=1_000_000)
    note: str = Field(min_length=3, max_length=500)


def _check(category=None, condition=None):
    if category is not None and category not in ASSET_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if condition is not None and condition not in ASSET_CONDITIONS:
        raise HTTPException(status_code=400, detail="Invalid condition")


def _out(a: AssetItem) -> dict:
    return {"id": str(a.id), "item_code": a.item_code, "name": a.name, "category": a.category, "location": a.location,
            "quantity": a.quantity, "unit": a.unit, "condition": a.condition,
            "unit_cost": str(money(a.unit_cost)) if a.unit_cost is not None else None,
            "total_value": str(money(a.unit_cost * a.quantity)) if a.unit_cost is not None else None,
            "purchase_date": a.purchase_date.isoformat() if a.purchase_date else None, "notes": a.notes,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None}


def _log(db, item: AssetItem, change: int, note: str, user: User):
    db.add(AssetAdjustment(item_id=item.id, change=change, quantity_after=item.quantity, note=note, performed_by=user.id))


@router.get("")
def list_items(q: str | None = None, category: str | None = None, condition: str | None = None,
               db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.manage"))):
    stmt = select(AssetItem).order_by(AssetItem.category, AssetItem.name)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(AssetItem.name.ilike(like), AssetItem.location.ilike(like), AssetItem.item_code.ilike(like)))
    if category in ASSET_CATEGORIES:
        stmt = stmt.where(AssetItem.category == category)
    if condition in ASSET_CONDITIONS:
        stmt = stmt.where(AssetItem.condition == condition)
    items = db.scalars(stmt).all()
    by_cat = dict(db.execute(select(AssetItem.category, func.sum(AssetItem.quantity)).group_by(AssetItem.category)).all())
    by_cond = dict(db.execute(select(AssetItem.condition, func.sum(AssetItem.quantity)).group_by(AssetItem.condition)).all())
    value = db.scalar(select(func.coalesce(func.sum(AssetItem.unit_cost * AssetItem.quantity), 0)))
    return {"summary": {"items": db.scalar(select(func.count()).select_from(AssetItem)), "pieces": int(sum(by_cat.values() or [0])),
                        "by_category": {c: int(by_cat.get(c) or 0) for c in ASSET_CATEGORIES},
                        "needs_repair": int(by_cond.get("NEEDS_REPAIR") or 0), "damaged": int(by_cond.get("DAMAGED") or 0),
                        "value": str(money(value))},
            "items": [_out(a) for a in items]}


@router.post("", status_code=status.HTTP_201_CREATED)
def add_item(payload: ItemIn, db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.manage"))):
    _check(payload.category, payload.condition)
    a = AssetItem(item_code=next_number(db, "AST"), created_by=user.id,
                  **{**payload.model_dump(), "name": payload.name.strip(), "location": (payload.location or "").strip() or None})
    db.add(a)
    db.flush()
    _log(db, a, a.quantity, "Item added", user)
    db.add(AuditLog(actor_user_id=user.id, action="CREATE", entity_type="INVENTORY", entity_id=str(a.id), new_values={"name": a.name, "qty": a.quantity}))
    notify(db, "inventory")
    db.commit()
    return _out(a)


@router.patch("/{item_id}")
def update_item(item_id: UUID, payload: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.manage"))):
    a = db.get(AssetItem, item_id)
    if not a:
        raise HTTPException(status_code=404, detail="Item not found")
    changes = payload.model_dump(exclude_unset=True)
    _check(changes.get("category"), changes.get("condition"))
    notes = []
    if "condition" in changes and changes["condition"] != a.condition:
        notes.append(f"Condition {a.condition.replace('_', ' ').lower()} -> {changes['condition'].replace('_', ' ').lower()}")
    if "location" in changes and (changes["location"] or None) != a.location:
        notes.append(f"Moved to {changes['location'] or 'no location'}")
    for k, v in changes.items():
        setattr(a, k, v.strip() if isinstance(v, str) else v)
    if notes:
        _log(db, a, 0, "; ".join(notes), user)
    db.add(AuditLog(actor_user_id=user.id, action="UPDATE", entity_type="INVENTORY", entity_id=str(a.id), new_values={k: str(v) for k, v in changes.items()}))
    notify(db, "inventory")
    db.commit()
    return _out(a)


@router.post("/{item_id}/adjust")
def adjust(item_id: UUID, payload: AdjustIn, db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.manage"))):
    a = db.scalar(select(AssetItem).where(AssetItem.id == item_id).with_for_update())
    if not a:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.change == 0:
        raise HTTPException(status_code=400, detail="Enter how many were added (+) or removed (-)")
    if a.quantity + payload.change < 0:
        raise HTTPException(status_code=400, detail=f"Only {a.quantity} {a.unit} in stock")
    a.quantity += payload.change
    _log(db, a, payload.change, payload.note.strip(), user)
    notify(db, "inventory")
    db.commit()
    return _out(a)


@router.get("/{item_id}/history")
def history(item_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.manage"))):
    rows = db.execute(select(AssetAdjustment, User.username).join(User, User.id == AssetAdjustment.performed_by)
                      .where(AssetAdjustment.item_id == item_id).order_by(AssetAdjustment.created_at.desc()).limit(200)).all()
    names = {e.user_id: e.full_name for e in db.scalars(select(Employee).where(Employee.user_id.in_({r.performed_by for r, _ in rows})))} if rows else {}
    return [{"change": r.change, "quantity_after": r.quantity_after, "note": r.note, "at": r.created_at.isoformat(),
             "by": names.get(r.performed_by, u)} for r, u in rows]


@router.delete("/{item_id}")
def delete_item(item_id: UUID, db: Session = Depends(get_db), user: User = Depends(require_permission("inventory.delete"))):
    a = db.get(AssetItem, item_id)
    if not a:
        raise HTTPException(status_code=404, detail="Item not found")
    db.add(AuditLog(actor_user_id=user.id, action="DELETE", entity_type="INVENTORY", entity_id=str(a.id), old_values={"name": a.name, "qty": a.quantity}))
    db.delete(a)
    notify(db, "inventory")
    db.commit()
    return {"status": "deleted"}
