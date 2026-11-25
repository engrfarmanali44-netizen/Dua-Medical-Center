# Data Model Notes

## Identity boundaries
- `users` stores login identities.
- `employees` stores workforce identities; `user_id` is nullable because not every worker needs an account.
- `patients` stores patient identity; `user_id` is nullable until a patient portal account is provisioned.
- A single login identity may have multiple roles. Do not duplicate user accounts to represent roles.

## Clinical records
- Patient identity is stable and represented by MRN.
- `encounters` represent patient visits (visit 1, 2, 3...); a visit is finalized when the patient recovers.
- Clinical notes, diagnoses, allergies, prescriptions, vitals and orders must reference the appropriate patient/encounter.
- Signed records must be amended through a versioned amendment workflow, not overwritten.

## Inventory
The stock movement ledger is the source of truth. Do not directly edit on-hand quantities.
For each movement, store positive quantity and encode direction in `movement_type`.
A balance projection/materialized view can be introduced after the ledger workflow is tested.
Use FEFO for medicine batch selection.

## Billing
- Store money as `NUMERIC(14,2)`.
- Currency is PKR for this single-currency deployment.
- Posted invoices and payments must not be edited in place; use credit notes, reversals and refunds.
- Payment allocations must be validated transactionally so total allocations do not exceed payment amount or invoice balance.
- The starter schema is not yet a complete double-entry general ledger.

## Cross-module references
`source_module` + `source_reference_id` on invoice items is a polymorphic reference. PostgreSQL cannot enforce a normal FK across multiple source tables. Before production, replace this with a dedicated `department_charges` table or typed source-reference tables with explicit foreign keys.

## Required additions before production
- Staff attendance, shift, leave, payroll and salary payments.
- Lab test catalog, orders, samples, result observations, verification and report release.
- OT theatres, procedures, staff, anesthesia and consumables.
- General inventory and fixed assets (separate from pharmacy medicine batches).
- Nursing observations, medication administration and discharge summaries.
- Patient messaging, conversation participants, notifications and complaints.
- Double-entry accounting (accounts, journal entries and journal lines).
- Supplier purchase orders, goods receipts, returns and stock transfers.
- Row/record-level authorization and patient access audit.
