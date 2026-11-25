"""Single source of truth for roles, permissions and portals (client requirements, 2026-11).

Roles
    ADMIN           full access to everything (also flagged is_superuser)
    Staff types     DOCTOR, NURSE, MEDICAL_STORE, CLEANING_STAFF, ACCOUNTANT, HR, COUNTER
    PATIENT         own reports, dues and chat only

Each role logs into exactly one portal and sees only that portal's dashboard. The web app's
apps/web/src/config/portals.ts must use the same role names and portal ids.
"""

ADMIN = "ADMIN"
DOCTOR = "DOCTOR"
NURSE = "NURSE"
MEDICAL_STORE = "MEDICAL_STORE"
CLEANING_STAFF = "CLEANING_STAFF"
ACCOUNTANT = "ACCOUNTANT"
HR = "HR"
COUNTER = "COUNTER"
PATIENT = "PATIENT"

ROLES = [ADMIN, DOCTOR, NURSE, MEDICAL_STORE, CLEANING_STAFF, ACCOUNTANT, HR, COUNTER, PATIENT]
STAFF_ROLES = [DOCTOR, NURSE, MEDICAL_STORE, CLEANING_STAFF, ACCOUNTANT, HR, COUNTER]

ROLE_DESCRIPTIONS = {
    ADMIN: "Administrator: full access to everything",
    DOCTOR: "Doctor",
    NURSE: "Nurse",
    MEDICAL_STORE: "Medical store: add sales and purchases (no edit or delete)",
    CLEANING_STAFF: "Cleaning staff",
    ACCOUNTANT: "Accountant: views all store sales and counter collections",
    HR: "Human resources: staff, attendance and hospital inventory",
    COUNTER: "Counter: registers patients and records their payments",
    PATIENT: "Patient: own reports, dues and chat",
}

# Portal id (URL segment in the web app) for each role.
ROLE_PORTAL = {
    ADMIN: "admin", DOCTOR: "doctor", NURSE: "nurse", MEDICAL_STORE: "store",
    CLEANING_STAFF: "cleaning", ACCOUNTANT: "accountant", HR: "hr", COUNTER: "counter", PATIENT: "patient",
}
PORTAL_ROLES = {portal: {role} for role, portal in ROLE_PORTAL.items()}

PERMISSIONS = {
    "users.create": "Create user accounts",
    "users.read": "View user accounts",
    "users.update": "Edit user accounts and reset passwords",
    "users.deactivate": "Activate / deactivate user accounts",
    "roles.manage": "Assign roles and view permissions",
    "employees.create": "Add staff records",
    "employees.read": "View staff records",
    "employees.update": "Edit staff records",
    "patients.create": "Register patients",
    "patients.read": "View patients",
    "patients.update": "Edit patient details",
    "patients.portal.manage": "Create patient portal logins and reset their passwords",
    "pharmacy.stock.read": "View medicines and stock",
    "pharmacy.medicines.create": "Add new medicines to the catalog",
    "pharmacy.medicines.manage": "Edit or deactivate medicines",
    "pharmacy.purchases.create": "Record purchases and add suppliers",
    "pharmacy.suppliers.manage": "Edit or deactivate suppliers",
    "pharmacy.sales.create": "Record medical store sales",
    "pharmacy.sales.read": "View medical store sales",
    "billing.read": "View invoices, payments and dues",
    "billing.payments.create": "Record patient payments",
    "billing.invoices.create": "Create invoices",
    "visits.read": "View patient visits, medicines and uploaded reports",
    "visits.create": "Open a new case or visit for a patient",
    "visits.write": "Record visit details, medicines and upload slips / lab reports",
    "visits.finalize": "Finalize a case when the patient has recovered",
    "visits.reopen": "Reopen a finalized case",
    "reviews.read": "See patient reviews of their treatment (Admin only)",
    "leave.request": "Request leave",
    "leave.approve": "Approve or reject leave requests (Admin and HR both must approve)",
    "advances.request": "Request an advance payment",
    "advances.approve": "Approve, reject and pay advance requests",
    "inventory.manage": "Add, edit and adjust hospital inventory (chairs, tables, equipment...)",
    "inventory.delete": "Delete hospital inventory items",
    "finance.read": "View cash book, expenses and profit & loss",
    "finance.expenses.manage": "Record and delete hospital expenses and other income",
    "attendance.manage": "Mark daily staff attendance and see attendance reports",
    "tasks.assign": "Assign daily tasks to staff",
    "reports.read": "View reports",
    "audit.read": "View the audit log",
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    ADMIN: list(PERMISSIONS),
    # pharmacy.stock.read: view-only medicine list, so the visit form can suggest medicine names.
    DOCTOR: ["patients.read", "visits.read", "visits.create", "visits.write", "visits.finalize", "pharmacy.stock.read", "leave.request", "advances.request"],
    NURSE: ["patients.read", "visits.read", "visits.create", "visits.write", "pharmacy.stock.read", "leave.request", "advances.request"],
    # Medical store may ADD sales, purchases, suppliers and new medicines, never edit or delete.
    MEDICAL_STORE: ["pharmacy.stock.read", "pharmacy.medicines.create", "pharmacy.purchases.create",
                    "pharmacy.sales.create", "pharmacy.sales.read", "patients.read", "leave.request", "advances.request"],
    CLEANING_STAFF: ["leave.request", "advances.request"],
    # Accountant only views: all store sales and all counter collections.
    ACCOUNTANT: ["pharmacy.sales.read", "pharmacy.stock.read", "billing.read", "patients.read", "reports.read", "finance.read", "leave.request", "advances.request"],
    HR: ["users.create", "users.read", "employees.create", "employees.read", "employees.update", "attendance.manage",
         "tasks.assign", "reports.read", "leave.request", "advances.request", "leave.approve", "inventory.manage"],
    COUNTER: ["patients.create", "patients.read", "patients.update", "patients.portal.manage", "billing.read", "billing.payments.create",
              "visits.read", "visits.create", "leave.request", "advances.request"],
    PATIENT: ["patients.read"],
}

# Old role names from the starter kit and what they became (used by the migration).
RENAMED_ROLES = {"SUPER_ADMIN": ADMIN, "HOSPITAL_ADMIN": ADMIN, "PHARMACIST": MEDICAL_STORE, "RECEPTIONIST": COUNTER}
REMOVED_ROLES = ["LAB_TECHNICIAN", "RADIOLOGIST", "OT_STAFF", "INVENTORY_MANAGER"]
