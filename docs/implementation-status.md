# Implementation Status

Scope follows the client's requirements (see the Roles table in README.md).

## Done
- FastAPI backend, PostgreSQL schema and Alembic migrations (0001-0004)
- Argon2 passwords, JWT access tokens, HTTP-only refresh cookies, session rotation and logout
- Client role model: Admin, Doctor, Nurse, Medical Store, Cleaning Staff, Accountant, HR, Counter, Patient
  (single source of truth: `apps/api/app/core/roles.py`; the seed syncs the database to it)
- Role portals and dashboards; each role sees only its own portal
- Medical store: medicines, suppliers, purchases (stock in), earliest-expiry-first sales, stock, expiry alerts;
  the store can add but not edit or delete
- Patient registration (auto MRN), invoices with paid / partially paid / unpaid status, payments, dues
- Audit log of create/update actions

## Removed (outside the client's scope)
- Lab technician, radiologist, OT staff and inventory-manager roles and portals
- Appointments, wards, rooms, beds, admissions; OPD/IPD/emergency, lab workflow, radiology, OT, payroll
- Redis

## To do
- Admin/HR registers staff with a role
- Patient visits (visit 1..n, problem, analysis, medicines, slip photo + lab report upload, finalize)
- Daily tasks, attendance, leave requests (Admin AND HR approve), advance requests (Admin approves)
- Hospital inventory (chairs, tables, stools...), cash management and profit/loss, chat
- Cloud: Supabase database, Cloudflare R2 files, Vercel + Render hosting
- Hosting with HTTPS (needed for installing the app on phones)
