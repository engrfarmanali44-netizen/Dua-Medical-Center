from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.modules.auth.router import router as auth_router
from app.modules.patients.router import router as patients_router
from app.api.v1.router import router as v1_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.pharmacy.router import router as pharmacy_router
from app.modules.billing.router import router as billing_router
from app.modules.staff.router import router as staff_router
from app.modules.visits.router import router as visits_router
from app.modules.attendance.router import router as attendance_router
from app.modules.chat.router import router as chat_router
from app.modules.reviews.router import router as reviews_router
from app.modules.tasks.router import router as tasks_router
from app.modules.requests.router import router as requests_router
from app.modules.inventory.router import router as inventory_router
from app.modules.finance.router import router as finance_router

# Import all model modules so Alembic discovers their metadata.
from app.modules.auth import models as auth_models  # noqa: F401
from app.modules.hospital import models as hospital_models  # noqa: F401
from app.modules.patients import models as patient_models  # noqa: F401
from app.modules.pharmacy import models as pharmacy_models  # noqa: F401
from app.modules.billing import models as billing_models  # noqa: F401
from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.auth import models_extra as auth_extra_models  # noqa: F401
from app.modules.visits import models as visit_models  # noqa: F401
from app.modules.attendance import models as attendance_models  # noqa: F401
from app.modules.chat import models as chat_models  # noqa: F401
from app.modules.reviews import models as review_models  # noqa: F401
from app.modules.requests import models as request_models  # noqa: F401
from app.modules.inventory import models as inventory_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(patients_router, prefix=settings.api_v1_prefix)
app.include_router(pharmacy_router, prefix=settings.api_v1_prefix)
app.include_router(billing_router, prefix=settings.api_v1_prefix)
app.include_router(staff_router, prefix=settings.api_v1_prefix)
app.include_router(visits_router, prefix=settings.api_v1_prefix)
app.include_router(attendance_router, prefix=settings.api_v1_prefix)
app.include_router(chat_router, prefix=settings.api_v1_prefix)
app.include_router(reviews_router, prefix=settings.api_v1_prefix)
app.include_router(tasks_router, prefix=settings.api_v1_prefix)
app.include_router(requests_router, prefix=settings.api_v1_prefix)
app.include_router(inventory_router, prefix=settings.api_v1_prefix)
app.include_router(finance_router, prefix=settings.api_v1_prefix)
app.include_router(v1_router, prefix=settings.api_v1_prefix)
# Registered after v1_router so /dashboard/summary is matched before /dashboard/{portal}.
app.include_router(dashboard_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "hms-api"}


@app.get("/ready", tags=["Health"])
def ready():
    return {"status": "ready"}
