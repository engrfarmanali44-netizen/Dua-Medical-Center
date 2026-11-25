"""Live updates via Supabase Realtime (broadcast "ping, then refetch").

When data changes, the API broadcasts only WHICH kind of data changed (e.g. {"topics": ["sales"]}),
never the data itself. Open screens that show that kind of data refetch it through the API, where
the normal login and permission checks apply. So no patient data ever goes through Supabase.

Usage inside a request:
    notify(db, "sales", "stock")   # sent only if the transaction commits
"""
import json
import logging
import threading
import urllib.request

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import settings

log = logging.getLogger("hms.realtime")
_KEY = "realtime_topics"

# Topics the web app listens to. Keep in sync with apps/web/src/lib/realtime.ts.
TOPICS = {"sales", "purchases", "stock", "medicines", "suppliers", "patients", "billing", "tasks", "staff", "visits", "attendance", "chat", "reviews", "leave", "advances", "inventory", "finance", "dashboard"}


# Topics that never change dashboard numbers (avoid needless dashboard reloads).
NO_DASHBOARD = {"chat"}


def enabled() -> bool:
    return bool(settings.supabase_url and settings.supabase_secret_key)


def notify(db: Session, *topics: str) -> None:
    unknown = set(topics) - TOPICS
    if unknown:
        raise ValueError(f"Unknown realtime topics: {unknown}")
    db.info.setdefault(_KEY, set()).update(topics)
    if set(topics) - NO_DASHBOARD:
        db.info[_KEY].add("dashboard")  # data changes can move a dashboard number


def _send(topics: list[str]) -> None:
    body = json.dumps({"messages": [{"topic": settings.realtime_channel, "event": "changed",
                                     "payload": {"topics": topics}}]}).encode()
    req = urllib.request.Request(f"{settings.supabase_url.rstrip('/')}/realtime/v1/api/broadcast", data=body,
                                 method="POST", headers={"Content-Type": "application/json",
                                                         "apikey": settings.supabase_secret_key})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            if r.status >= 300:
                log.warning("Realtime broadcast returned HTTP %s", r.status)
    except Exception as exc:  # live updates are best-effort; never break the request
        log.warning("Realtime broadcast failed: %s", exc)


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    topics = session.info.pop(_KEY, None)
    if topics and enabled():
        threading.Thread(target=_send, args=(sorted(topics),), daemon=True).start()


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(_KEY, None)
