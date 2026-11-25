"use client";
import type { ComponentType, ReactElement } from "react";
import { DuesPage, InvoicesPage, MyAccountPage, PaymentsPage } from "@/components/billing/pages";
import { PatientDetailPage, PatientsPage, RegisterPatientPage } from "@/components/patients/pages";
import { ExpiryAlertsPage, MedicinesPage, MovementsPage, PurchasesPage, StockPage, SuppliersPage } from "@/components/pharmacy/catalog";
import { SalesPage } from "@/components/pharmacy/sales";
import { ProfilePage } from "@/components/profile";
import { findLink } from "@/config/portals";
import { StaffPage } from "@/components/staff/pages";
import { CaseDetailPage, CasesPage, MyVisitsPage } from "@/components/visits/pages";
import { AttendancePage, MyAttendancePage } from "@/components/attendance/pages";
import { ChatPage } from "@/components/chat/pages";
import { AdminReviewsPage, MyReviewsPage } from "@/components/reviews/pages";
import { MyTasksPage, TasksBoardPage } from "@/components/tasks/pages";
import { AdvanceApprovalsPage, LeaveApprovalsPage, MyAdvancesPage, MyLeavePage } from "@/components/requests/pages";
import { InventoryPage } from "@/components/inventory/pages";
import { FinancePage } from "@/components/finance/pages";
import { AuditLogPage } from "@/components/audit/pages";

/** HR approves leave AND requests their own leave on the same page. */
const HrLeavePage = () => <LeaveApprovalsPage withMyTab />;

/**
 * Implemented screens, keyed by portal then by menu slug. Anything not listed here falls back
 * to the "Coming soon" placeholder, so new modules can be switched on one entry at a time.
 */
const STORE_PAGES: Record<string, ComponentType> = {
  sales: SalesPage, purchases: PurchasesPage, medicines: MedicinesPage, suppliers: SuppliersPage,
  stock: StockPage, "expiry-alerts": ExpiryAlertsPage,
};

const PAGES: Record<string, Record<string, ComponentType>> = {
  admin: {
    ...STORE_PAGES, staff: StaffPage, visits: CasesPage, attendance: AttendancePage, reviews: AdminReviewsPage, tasks: TasksBoardPage, leave: LeaveApprovalsPage, advances: AdvanceApprovalsPage, inventory: InventoryPage, finance: FinancePage, "audit-logs": AuditLogPage, patients: PatientsPage, "patients/register": RegisterPatientPage,
    invoices: InvoicesPage, payments: PaymentsPage, dues: DuesPage,
  },
  store: { ...STORE_PAGES, "stock-movements": MovementsPage },
  accountant: { finance: FinancePage, "store-sales": SalesPage, payments: PaymentsPage, invoices: InvoicesPage, dues: DuesPage, purchases: PurchasesPage },
  counter: { patients: PatientsPage, "patients/new": RegisterPatientPage, visits: CasesPage, payments: PaymentsPage, dues: DuesPage },
  doctor: { patients: PatientsPage, visits: CasesPage },
  nurse: { patients: PatientsPage, visits: CasesPage },
  hr: { staff: StaffPage, attendance: AttendancePage, tasks: TasksBoardPage, leave: HrLeavePage, inventory: InventoryPage },
  patient: { dues: MyAccountPage, visits: MyVisitsPage, reviews: MyReviewsPage },
};

/** Portals whose staff may open a patient's detail page at /<portal>/patients/<id>. */
const PATIENT_DETAIL_PORTALS = new Set(["admin", "counter", "doctor", "nurse", "accountant", "store"]);

/** Portals whose staff may open a case page at /<portal>/visits/<id>. */
const VISIT_PORTALS = new Set(["admin", "doctor", "nurse", "counter"]);

/** Screens shared by every portal whose menu offers them. */
const SHARED = new Set(["chat", "my-attendance", "tasks", "my-leave", "my-advances"]);

/** Returns the screen for a portal path, or null for modules that are not built yet. */
export function renderPage(portal: string, slug: string): ReactElement | null {
  const Direct = PAGES[portal]?.[slug];
  if (Direct) return <Direct />;
  if (slug === "profile") return <ProfilePage />;
  // Shared by every portal whose menu offers them (menus decide who sees what; the API enforces it).
  if (slug === "chat" && findLink(portal, "chat")) return <ChatPage />;
  if (slug === "tasks" && findLink(portal, "tasks")) return <MyTasksPage />;
  if (slug === "my-leave" && findLink(portal, "my-leave")) return <MyLeavePage />;
  if (slug === "my-advances" && findLink(portal, "my-advances")) return <MyAdvancesPage />;
  if (slug === "my-attendance" && findLink(portal, "my-attendance")) return <MyAttendancePage />;
  const m = /^patients\/([0-9a-f-]{36})$/i.exec(slug);
  if (m && PATIENT_DETAIL_PORTALS.has(portal)) return <PatientDetailPage key={m[1]} patientId={m[1]} />;
  const v = /^visits\/([0-9a-f-]{36})$/i.exec(slug);
  if (v && VISIT_PORTALS.has(portal)) return <CaseDetailPage key={v[1]} caseId={v[1]} />;
  return null;
}

export function isImplemented(portal: string, slug: string) {
  return slug === "profile" || (SHARED.has(slug) && Boolean(findLink(portal, slug))) || Boolean(PAGES[portal]?.[slug]);
}
