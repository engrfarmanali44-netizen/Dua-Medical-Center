# Database Migrations

Migrations live in `apps/api/alembic/versions` and run in order with `alembic upgrade head`.

| Revision | Contents |
|---|---|
| 20261120_0001 | Users, roles, permissions, sessions, departments, employees, patients, tasks, notifications, audit log |
| 20261120_0002 | Medicines, batches, stock ledger, invoices, payments; aligns earlier tables with the models |
| 20261121_0003 | Suppliers, purchases, sales, document numbers, invoice status rules |
| 20261121_0004 | Client role model (merge/rename/remove roles); drops appointments, wards, rooms, beds, admissions |

Rules
- Never edit a migration that has run on a shared database; add a new one.
- After changing models, run `alembic revision --autogenerate`, review it, then `alembic check`.
- Roles and permissions are not seeded by migrations: `python -m scripts.seed` syncs them to
  `app/core/roles.py`. On a new production database, run `python -m scripts.create_initial_admin`.
