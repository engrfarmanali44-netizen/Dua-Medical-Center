# Dua Medical Hospital Management System

A single-hospital HMS for Dua Medical (PKR), built to the client's requirements.

## Stack
- Backend: FastAPI, Python 3.12, SQLAlchemy 2.x, Alembic, Pydantic Settings
- Database: PostgreSQL (Supabase in the cloud)
- File storage: Cloudflare R2 (prescription-slip photos and lab reports), planned
- Frontend: Next.js App Router, TypeScript, Tailwind CSS
- Apps: ONE web app, installable as an app on phones and computers (PWA: "Install app" / "Not now").
  No separate desktop or mobile apps.
- Hosting (planned): Vercel (web) + Render (API)
- Currency: PKR (store monetary values as `NUMERIC`, never floating point). No payment gateway.

## Roles
Admin registers staff with a role; each role signs in to its own portal only.
Roles and permissions are defined in one place: `apps/api/app/core/roles.py`.

| Role | Can do |
|---|---|
| Admin | Everything: add, edit and delete |
| Doctor | Patients, visits, chat |
| Nurse | Patients, visits, chat |
| Medical Store | **Add** sales, purchases, suppliers and medicines (no edit or delete) |
| Accountant | View all medical store sales and counter collections; cash and profit/loss |
| HR | Add staff, daily attendance, leave approvals, hospital inventory |
| Counter | Register patients and record how much they paid / still owe |
| Cleaning Staff | Own tasks, attendance, leave and advance requests |
| Patient | Own visits and reports, outstanding dues, chat with doctor and admin |

## Status
Built: login and role portals, dashboards, medical store (medicines, suppliers, purchases, sales,
stock, expiry alerts), patient registration, invoices with paid / partially paid / unpaid dues,
payments, audit log.

Planned: staff registration by Admin, patient visits with slip and lab-report uploads, daily tasks,
attendance, leave (Admin and HR approval), advance requests, hospital inventory, cash and
profit/loss, cloud deployment.

## Run it

From the project root:

```powershell
npm run dev
```

- **Cloud-based:** all data is stored in **Supabase** (`SUPABASE_DB_URL` in `.env`). Nothing is stored
  on the PC; it only runs the API and the web app. Without `SUPABASE_DB_URL` it refuses to start.
- It prints two addresses: **This PC** (`http://localhost:3000`, or the next free port) and
  **Phones / other PCs** on the same Wi-Fi. Add `-- --this-pc-only` to keep it private to this PC.
- Press `Ctrl+C` to stop. After changing backend code, run `npm run dev` again.

## Installing the app (PWA)

Open HMS in Chrome or Edge and choose **Install app** in the banner (or the install icon in the
address bar). On iPhone/iPad: **Share → Add to Home Screen**. Installed, it opens in its own window
with the Dua HMS icon; "Not now" hides the offer for 7 days.

Browsers only allow installing on **HTTPS** sites (or `localhost` on the same PC), so installing
on phones and other computers works once HMS is hosted with HTTPS. The app never stores patient or
financial data on the device; without internet it shows an offline page.

Files: `apps/web/src/app/manifest.ts`, `apps/web/public/sw.js`, `apps/web/src/components/install-app.tsx`,
icons in `apps/web/public/icons/`.

## Manual start (without the launcher)

```bash
cd apps/api && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/alembic upgrade head && .venv/Scripts/python -m scripts.seed
.venv/Scripts/uvicorn app.main:app --host 127.0.0.1 --port 8000
# first Admin on a new database:
.venv/Scripts/python -m scripts.create_initial_admin --username admin --password '<12+ characters>'

cd apps/web && npm install && npm run dev
```

API docs: http://localhost:8000/docs · Web: http://localhost:3000

## Important security notes
- Do not expose PostgreSQL publicly. Replace development secrets before deployment.
- The Supabase secret key is server-only (root `.env`); the web app only gets the publishable key.
- Use HTTPS in production, encrypted backups, monitoring and tested restore procedures.
- All patient and business data goes through the authorized API; browsers never read the database.
- Have the hospital's legal/compliance adviser review applicable Pakistani requirements.

## Project layout
```text
hms-engineering-starter/
├── apps/
│   ├── api/   FastAPI backend (app/core, app/modules, alembic, scripts)
│   └── web/   Next.js web app (installable PWA)
├── supabase/  schema.sql for a fresh Supabase database
├── scripts/   dev.js launcher (npm run dev)
├── docs/
└── .env.example
```
