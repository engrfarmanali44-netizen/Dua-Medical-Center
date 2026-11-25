"""Client role model: merge/rename/remove roles; drop appointments, wards, rooms, beds, admissions.

- SUPER_ADMIN and HOSPITAL_ADMIN merge into ADMIN (their users become superusers).
- PHARMACIST -> MEDICAL_STORE, RECEPTIONIST -> COUNTER.
- LAB_TECHNICIAN, RADIOLOGIST, OT_STAFF, INVENTORY_MANAGER are removed.
- Permissions are re-synced by scripts/seed.py (app/core/roles.py is the source of truth).

Revision ID: 20261121_0004
Revises: 20261121_0003
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261121_0004"
down_revision = "20261121_0003"
branch_labels = None
depends_on = None

RENAMED = {"SUPER_ADMIN": "ADMIN", "HOSPITAL_ADMIN": "ADMIN", "PHARMACIST": "MEDICAL_STORE", "RECEPTIONIST": "COUNTER"}
REMOVED = ["LAB_TECHNICIAN", "RADIOLOGIST", "OT_STAFF", "INVENTORY_MANAGER"]


def _role_id(conn, name):
    return conn.execute(sa.text("SELECT id FROM roles WHERE name = :n"), {"n": name}).scalar()


def upgrade():
    conn = op.get_bind()

    # 1. Roles: move users from old roles onto their new role, then delete the old roles.
    for old, new in RENAMED.items():
        old_id = _role_id(conn, old)
        if old_id is None:
            continue
        new_id = _role_id(conn, new)
        if new_id is None:
            new_id = uuid.uuid4()
            conn.execute(sa.text("INSERT INTO roles (id, name) VALUES (:id, :n)"), {"id": new_id, "n": new})
        conn.execute(sa.text("""
            INSERT INTO user_roles (user_id, role_id)
            SELECT ur.user_id, :new FROM user_roles ur
            WHERE ur.role_id = :old
              AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = ur.user_id AND x.role_id = :new)
        """), {"old": old_id, "new": new_id})
        if new == "ADMIN":
            conn.execute(sa.text("UPDATE users SET is_superuser = TRUE WHERE id IN "
                                 "(SELECT user_id FROM user_roles WHERE role_id = :old)"), {"old": old_id})
        for table in ("user_roles", "role_permissions"):
            conn.execute(sa.text(f"DELETE FROM {table} WHERE role_id = :old"), {"old": old_id})
        conn.execute(sa.text("DELETE FROM roles WHERE id = :old"), {"old": old_id})
    for name in REMOVED:
        rid = _role_id(conn, name)
        if rid is not None:
            for table in ("user_roles", "role_permissions"):
                conn.execute(sa.text(f"DELETE FROM {table} WHERE role_id = :r"), {"r": rid})
            conn.execute(sa.text("DELETE FROM roles WHERE id = :r"), {"r": rid})

    # 2. Tables outside the client's scope (no clinical admissions / appointments / wards).
    op.drop_constraint("encounters_appointment_id_fkey", "encounters", type_="foreignkey")
    op.drop_column("encounters", "appointment_id")
    for table in ("bed_assignments", "admissions", "beds", "rooms", "wards", "appointments"):
        op.drop_table(table)


def downgrade():
    # Recreates the dropped tables empty. Role renames/removals are not reversed.
    op.create_table("appointments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("patient_id", sa.UUID(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("doctor_employee_id", sa.UUID(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("department_id", sa.UUID(), sa.ForeignKey("departments.id"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('BOOKED','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW')", name="ck_appointment_status"))
    op.create_table("wards",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("department_id", sa.UUID(), sa.ForeignKey("departments.id")),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("ward_type", sa.String(40), nullable=False))
    op.create_table("rooms",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("ward_id", sa.UUID(), sa.ForeignKey("wards.id"), nullable=False),
        sa.Column("room_number", sa.String(30), nullable=False),
        sa.Column("room_type", sa.String(40), nullable=False),
        sa.UniqueConstraint("ward_id", "room_number", name="uq_room_ward_number"))
    op.create_table("beds",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("room_id", sa.UUID(), sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column("bed_number", sa.String(30), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.UniqueConstraint("room_id", "bed_number", name="uq_bed_room_number"))
    op.create_table("admissions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("patient_id", sa.UUID(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("admission_number", sa.String(40), nullable=False, unique=True),
        sa.Column("attending_doctor_id", sa.UUID(), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("admitted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("discharged_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(30), nullable=False))
    op.create_table("bed_assignments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("admission_id", sa.UUID(), sa.ForeignKey("admissions.id"), nullable=False),
        sa.Column("bed_id", sa.UUID(), sa.ForeignKey("beds.id"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.Column("assigned_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False))
    op.add_column("encounters", sa.Column("appointment_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("encounters_appointment_id_fkey", "encounters", "appointments", ["appointment_id"], ["id"])
