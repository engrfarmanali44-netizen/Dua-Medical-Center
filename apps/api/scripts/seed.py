"""Idempotent base data + development demo data.

Roles and permissions are SYNCED to app/core/roles.py on every run: missing ones are added and
anything no longer listed there is removed, so the database always matches the client's rules.
"""
import os
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select, text

from app.core import roles as R
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import Permission, Role, RolePermission, User, UserRole
from app.modules.hospital.models import Department, Employee, Hospital, HospitalSettings
from app.modules.patients.models import Patient
from app.modules.pharmacy.models import MAIN_PHARMACY_LOCATION, InventoryLocation

DEPARTMENTS = [
    ("ADM", "Administration"), ("MED", "Medicine"), ("NUR", "Nursing"),
    ("PHR", "Medical Store"), ("ACC", "Accounts"), ("HRM", "Human Resources"),
    ("FRD", "Front Desk"), ("HKP", "Housekeeping"),
]


def sync_roles_and_permissions(db) -> dict[str, Role]:
    permissions = {p.key: p for p in db.scalars(select(Permission)).all()}
    for key, description in R.PERMISSIONS.items():
        if key not in permissions:
            permissions[key] = Permission(key=key, module=key.split(".", 1)[0], description=description)
            db.add(permissions[key])
        else:
            permissions[key].description = description

    roles = {r.name: r for r in db.scalars(select(Role)).all()}
    for name in R.ROLES:
        if name not in roles:
            roles[name] = Role(name=name)
            db.add(roles[name])
        roles[name].description = R.ROLE_DESCRIPTIONS[name]
    db.flush()

    # Remove roles and permissions that the client's role model no longer has.
    stale_roles = [r.id for n, r in roles.items() if n not in R.ROLES]
    stale_perms = [p.id for k, p in permissions.items() if k not in R.PERMISSIONS]
    if stale_roles:
        db.execute(delete(UserRole).where(UserRole.role_id.in_(stale_roles)))
        db.execute(delete(RolePermission).where(RolePermission.role_id.in_(stale_roles)))
        db.execute(delete(Role).where(Role.id.in_(stale_roles)))
    if stale_perms:
        db.execute(delete(RolePermission).where(RolePermission.permission_id.in_(stale_perms)))
        db.execute(delete(Permission).where(Permission.id.in_(stale_perms)))

    # Make each role's grants exactly match ROLE_PERMISSIONS.
    for name in R.ROLES:
        role = roles[name]
        wanted = {permissions[k].id for k in R.ROLE_PERMISSIONS[name]}
        have = set(db.scalars(select(RolePermission.permission_id).where(RolePermission.role_id == role.id)).all())
        for pid in wanted - have:
            db.add(RolePermission(role_id=role.id, permission_id=pid))
        if have - wanted:
            db.execute(delete(RolePermission).where(RolePermission.role_id == role.id,
                                                    RolePermission.permission_id.in_(have - wanted)))
    db.flush()
    return {n: roles[n] for n in R.ROLES}


def seed():
    with SessionLocal.begin() as db:
        hospital = db.scalar(select(Hospital).where(Hospital.code == "MAIN"))
        if not hospital:
            hospital = Hospital(name="Dua Medical Hospital", code="MAIN", address="Pakistan")
            db.add(hospital)
            db.flush()
            db.add(HospitalSettings(hospital_id=hospital.id))

        if not db.scalar(select(InventoryLocation.id).where(InventoryLocation.code == MAIN_PHARMACY_LOCATION)):
            db.add(InventoryLocation(code=MAIN_PHARMACY_LOCATION, name="Medical Store"))

        for code, name in DEPARTMENTS:
            if not db.scalar(select(Department.id).where(Department.code == code)):
                db.add(Department(code=code, name=name))

        roles = sync_roles_and_permissions(db)

        if settings.uses_supabase:
            # Supabase publishes the public schema through its Data API. RLS with no policies blocks
            # that API (publishable key) completely; the HMS API connects as owner and is unaffected.
            tables = db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity")).scalars().all()
            for name in tables:
                db.execute(text(f'ALTER TABLE public."{name}" ENABLE ROW LEVEL SECURITY'))
            if tables:
                print(f"Row Level Security enabled on {len(tables)} table(s).")

        if settings.app_env.lower() != "development" or os.getenv("SEED_DEMO_DATA", "true").lower() == "false":
            print("Seeded base data (no demo accounts or sample data).")
            return

        password = os.getenv("DEV_SEED_PASSWORD")
        if not password or len(password) < 12:
            print("Skipping demo accounts: DEV_SEED_PASSWORD is missing or shorter than 12 characters.")
            return

        users_by_name = {}
        for username, (role_name, _dept, _title) in DEMO_USERS.items():
            user = db.scalar(select(User).where(User.username == username))
            if not user:
                user = User(username=username, password_hash=hash_password(password), is_active=True,
                            is_superuser=(role_name == R.ADMIN), must_change_password=False)
                db.add(user)
                db.flush()
            if not db.scalar(select(UserRole).where(UserRole.user_id == user.id,
                                                     UserRole.role_id == roles[role_name].id)):
                db.add(UserRole(user_id=user.id, role_id=roles[role_name].id))
            _link_demo_profile(db, user, username, role_name)
            users_by_name[username] = user
        _seed_demo_pharmacy(db, users_by_name["store"])


# username -> (role, department code, designation). Development only.
DEMO_USERS = {
    "admin": (R.ADMIN, "ADM", "Administrator"),
    "doctor": (R.DOCTOR, "MED", "Consultant Physician"),
    "nurse": (R.NURSE, "NUR", "Staff Nurse"),
    "store": (R.MEDICAL_STORE, "PHR", "Medical Store"),
    "cleaning": (R.CLEANING_STAFF, "HKP", "Cleaning Staff"),
    "accountant": (R.ACCOUNTANT, "ACC", "Accountant"),
    "hr": (R.HR, "HRM", "HR Officer"),
    "counter": (R.COUNTER, "FRD", "Counter"),
    "patient": (R.PATIENT, None, None),
}


def _link_demo_profile(db, user: User, username: str, role_name: str) -> None:
    db.flush()
    if role_name == R.PATIENT:
        if not db.scalar(select(Patient.id).where(Patient.user_id == user.id)):
            db.add(Patient(mrn="DEV-000001", user_id=user.id, first_name="Demo",
                           last_name="Patient", phone="03000000000"))
        return
    if db.scalar(select(Employee.id).where(Employee.user_id == user.id)):
        return
    _role, dept_code, designation = DEMO_USERS[username]
    department_id = db.scalar(select(Department.id).where(Department.code == dept_code))
    db.add(Employee(user_id=user.id, department_id=department_id,
                    employee_code=f"DEV-{username.upper()}", full_name=f"Demo {designation}",
                    designation=designation, joining_date=date.today()))


# (code, generic, brand, strength, form, category, unit, reorder, [(batch, days_to_expiry, qty, cost, sell)])
DEMO_MEDICINES = [
    ("PARA500", "Paracetamol", "Panadol", "500mg", "Tablet", "Analgesic", "tablet", 200, [("PN-2401", 400, 1000, 1.6, 2.5)]),
    ("AMOX625", "Amoxicillin + Clavulanic acid", "Augmentin", "625mg", "Tablet", "Antibiotic", "tablet", 60, [("AG-1187", 20, 30, 38, 52), ("AG-1302", 300, 120, 39, 54)]),
    ("IBU400", "Ibuprofen", "Brufen", "400mg", "Tablet", "NSAID", "tablet", 100, [("BR-0912", 250, 500, 3.2, 5)]),
    ("MET400", "Metronidazole", "Flagyl", "400mg", "Tablet", "Antibiotic", "tablet", 100, [("FL-7731", 180, 300, 2.8, 4.5)]),
    ("OME20", "Omeprazole", "Risek", "20mg", "Capsule", "Antacid / PPI", "capsule", 60, [("RK-5520", 330, 280, 12, 18)]),
    ("MTF500", "Metformin", "Glucophage", "500mg", "Tablet", "Antidiabetic", "tablet", 150, [("GL-3310", 365, 600, 2.1, 3.5)]),
    ("SALB100", "Salbutamol", "Ventolin", "100mcg", "Inhaler", "Bronchodilator", "inhaler", 10, [("VT-0044", 420, 6, 380, 480)]),
    ("ORS", "Oral rehydration salts", "ORS", "27.9g", "Sachet", "Electrolyte", "sachet", 50, [("OR-9001", 500, 200, 18, 30)]),
    ("CEF500", "Cefixime", "Cefspan", "400mg", "Capsule", "Antibiotic", "capsule", 40, [("CF-6612", 210, 90, 55, 75)]),
    ("NS500", "Sodium chloride 0.9%", "Normal Saline", "500ml", "Drip", "IV fluid", "bottle", 30, [("NS-2209", 600, 80, 95, 140)]),
]


def _seed_demo_pharmacy(db, actor: User) -> None:
    """Development-only sample catalog and stock, created once when the catalog is empty."""
    from app.modules.billing.service import today_pkt
    from app.modules.pharmacy.models import Medicine, Supplier
    from app.modules.pharmacy.service import PurchaseLine, post_purchase
    if db.scalar(select(Medicine.id).limit(1)):
        return
    suppliers = [Supplier(name="Muller & Phipps Pakistan", contact_person="Sales desk", phone="021-111-000-111"),
                 Supplier(name="Premier Distributors Lahore", contact_person="Imran", phone="042-3500-0000")]
    db.add_all(suppliers)
    db.flush()
    lines_by_supplier: dict[int, list] = {0: [], 1: []}
    for n, (code, generic, brand, strength, form, cat, unit, reorder, batches) in enumerate(DEMO_MEDICINES):
        m = Medicine(medicine_code=code, generic_name=generic, brand_name=brand, strength=strength, dosage_form=form,
                     category=cat, unit=unit, reorder_level=Decimal(reorder))
        db.add(m)
        db.flush()
        for batch, days, quantity, cost, sell in batches:
            lines_by_supplier[n % 2].append(PurchaseLine(medicine_id=m.id, batch_number=batch,
                                                         expiry_date=today_pkt() + timedelta(days=days),
                                                         quantity=Decimal(quantity), unit_cost=Decimal(str(cost)),
                                                         selling_price=Decimal(str(sell))))
    for i, lines in lines_by_supplier.items():
        post_purchase(db, supplier_id=suppliers[i].id, lines=lines, actor_id=actor.id,
                      supplier_invoice_no=f"DEMO-{i + 1}", notes="Sample opening stock (development only)")


if __name__ == "__main__":
    seed()
