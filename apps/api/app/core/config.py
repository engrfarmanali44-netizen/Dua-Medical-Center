from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_db_url(url: str) -> str:
    """Accept the URI exactly as Supabase shows it and make it usable by SQLAlchemy + psycopg 3.

    postgresql://... -> postgresql+psycopg://...; remote hosts get sslmode=require.
    """
    url = url.strip()
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix):]
            break
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    if parts.hostname not in ("localhost", "127.0.0.1", "::1", "db") and "sslmode" not in query:
        query["sslmode"] = "require"
    return urlunsplit(parts._replace(query=urlencode(query)))


class Settings(BaseSettings):
    app_name: str = "Hospital Management System"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    secret_key: str
    access_token_expire_minutes: int = 20
    database_url: str = ""
    # Supabase Postgres (Connect > Session pooler URI). When set, it is THE database.
    supabase_db_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    cors_origins: str = "http://localhost:3000"
    default_currency: str = "PKR"
    hospital_timezone: str = "Asia/Karachi"
    # Supabase: Realtime "changed" signals (server-only secret key). Empty = realtime disabled.
    supabase_url: str = ""
    supabase_secret_key: str = ""
    realtime_channel: str = "hms-events"
    # Private file storage for slip photos / lab reports (Supabase Storage bucket).
    storage_bucket: str = "hms-files"
    max_upload_bytes: int = 10 * 1024 * 1024

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _pick_database(self):
        if self.supabase_db_url:
            self.database_url = self.supabase_db_url
        if not self.database_url:
            raise ValueError("Set SUPABASE_DB_URL (cloud) or DATABASE_URL (local) in .env")
        self.database_url = normalize_db_url(self.database_url)
        return self

    @property
    def uses_supabase(self) -> bool:
        return ".supabase.co" in self.database_url or ".supabase.com" in self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
