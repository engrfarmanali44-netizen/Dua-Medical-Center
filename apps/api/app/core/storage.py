"""Private file storage (Supabase Storage today; swap this module for Cloudflare R2 later).

Files live in a PRIVATE bucket. Nobody gets a permanent public link: after the API has checked
the user's permission it hands out a signed link that expires after a few minutes.
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from fastapi import HTTPException

from app.core.config import settings

log = logging.getLogger("hms.storage")
# Links expire after 5 minutes. Note: Supabase's CDN may keep serving a just-opened file to someone
# who already holds its link until that link expires, even after the file is deleted.
SIGNED_URL_SECONDS = 300
_bucket_ready = False


def _headers(extra: dict | None = None) -> dict:
    key = settings.supabase_secret_key
    return {"apikey": key, "Authorization": f"Bearer {key}", **(extra or {})}


def _request(method: str, path: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 60):
    if not (settings.supabase_url and settings.supabase_secret_key):
        raise HTTPException(status_code=503, detail="File storage is not configured")
    req = urllib.request.Request(f"{settings.supabase_url.rstrip('/')}/storage/v1/{path}", data=data,
                                 method=method, headers=_headers(headers))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode(errors="replace")
        log.warning("Storage %s %s -> %s %s", method, path, e.code, detail)
        raise HTTPException(status_code=502, detail="File storage error. Please try again.") from None
    except urllib.error.URLError as e:
        log.warning("Storage unreachable: %s", e)
        raise HTTPException(status_code=502, detail="File storage is unreachable. Please try again.") from None


def _ensure_bucket() -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    body = json.dumps({"id": settings.storage_bucket, "name": settings.storage_bucket, "public": False,
                       "file_size_limit": settings.max_upload_bytes}).encode()
    try:
        _request("POST", "bucket", body, {"Content-Type": "application/json"}, timeout=20)
    except HTTPException:
        pass  # already exists (or will fail loudly on upload)
    _bucket_ready = True


def _quote(path: str) -> str:
    return urllib.parse.quote(path, safe="/")


def upload(path: str, data: bytes, content_type: str) -> None:
    _ensure_bucket()
    _request("POST", f"object/{settings.storage_bucket}/{_quote(path)}", data,
             {"Content-Type": content_type, "x-upsert": "false", "Cache-Control": "private, max-age=0"}, timeout=120)


def signed_url(path: str, download_name: str | None = None) -> str:
    body = {"expiresIn": SIGNED_URL_SECONDS}
    res = _request("POST", f"object/sign/{settings.storage_bucket}/{_quote(path)}", json.dumps(body).encode(),
                   {"Content-Type": "application/json"}, timeout=20)
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1{res['signedURL']}"
    if download_name:
        url += "&download=" + urllib.parse.quote(download_name)
    return url


def delete(path: str) -> None:
    try:
        _request("DELETE", f"object/{settings.storage_bucket}", json.dumps({"prefixes": [path]}).encode(),
                 {"Content-Type": "application/json"}, timeout=20)
    except HTTPException:
        log.warning("Could not delete stored file %s (left orphaned)", path)
