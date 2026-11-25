import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight, Banknote, CalendarCheck, CalendarOff, ChartColumn, ClipboardList, Clock, CreditCard,
  FileHeart, HandCoins, Star, LayoutDashboard, Layers, ListChecks, MessageSquare, Package, PackagePlus, Pill,
  ReceiptText, ScrollText, Search, ShoppingCart, Stethoscope, TriangleAlert, Truck, User, UserPlus, UsersRound,
} from "lucide-react";

export type PortalLink = {
  label: string;
  slug: string;
  icon: LucideIcon;
  description: string;
  /** Dashboard section the option is listed under. */
  group: string;
};

export type Portal = {
  label: string;
  roles: string[];
  /** Short line shown under the dashboard greeting. */
  tagline: string;
  /** Slugs promoted to the dashboard's quick-action bar. */
  quickActions: string[];
  navigation: PortalLink[];
};

// Role names must match apps/api/app/core/roles.py.

const dashboard = (description: string): PortalLink =>
  ({ label: "Dashboard", slug: "dashboard", icon: LayoutDashboard, description, group: "Overview" });

const link = (group: string, label: string, slug: string, icon: LucideIcon, description: string): PortalLink =>
  ({ group, label, slug, icon, description });

const profile = link("My Account", "Profile", "profile", User, "Your personal details and password.");

/** Every staff member can see their tasks and attendance, and request leave or an advance. */
const selfService = (opts: { chat?: boolean } = {}): PortalLink[] => [
  link("My Work", "My Tasks", "tasks", ListChecks, "Tasks assigned to you for today."),
  link("My Work", "My Attendance", "my-attendance", Clock, "Your attendance record."),
  link("My Work", "Leave Requests", "my-leave", CalendarOff, "Request leave. Approved when both Admin and HR accept."),
  link("My Work", "Advance Requests", "my-advances", HandCoins, "Request an advance payment from Admin."),
  ...(opts.chat ? [link("My Work", "Chat", "chat", MessageSquare, "Messages with patients and colleagues.")] : []),
  profile,
];

/* ---------------------------------------------------------------- shared links */

const patients = (group: string) => link(group, "Patients", "patients", Search, "Search patients by MRN, name or phone.");
const visits = (group: string) => link(group, "Patient Visits", "visits", Stethoscope, "Visit 1, 2, 3...: problem, analysis, medicines, slip and lab report photos.");
const storeLinks = (group: string): PortalLink[] => [
  link(group, "Sales", "sales", ShoppingCart, "Sell medicines to walk-in customers or patients."),
  link(group, "Purchases", "purchases", PackagePlus, "Receive medicines from suppliers into stock."),
  link(group, "Medicines", "medicines", Pill, "Medicine list with live stock."),
  link(group, "Suppliers", "suppliers", Truck, "Companies you buy medicines from."),
  link(group, "Stock", "stock", Layers, "Quantity in every batch."),
  link(group, "Expiry Alerts", "expiry-alerts", TriangleAlert, "Batches expired or expiring soon."),
];

export const PORTALS: Record<string, Portal> = {
  admin: {
    label: "Administration",
    roles: ["ADMIN"],
    tagline: "Full control of patients, staff, medical store and finances.",
    quickActions: ["staff", "patients", "sales", "finance"],
    navigation: [
      dashboard("Hospital-wide overview."),
      link("People", "Staff", "staff", UsersRound, "Register staff, assign their role and manage accounts."),
      patients("People"),
      link("People", "Register Patient", "patients/register", UserPlus, "Register a new patient and issue an MRN."),
      visits("Patient Care"),
      ...storeLinks("Medical Store"),
      link("Finance", "Invoices", "invoices", ReceiptText, "Every charge to a patient."),
      link("Finance", "Payments", "payments", CreditCard, "Money received from patients."),
      link("Finance", "Outstanding Dues", "dues", Banknote, "Patients with unpaid balances."),
      link("Finance", "Cash & Profit/Loss", "finance", ChartColumn, "Income, expenses and profit or loss."),
      link("Staff Management", "Attendance", "attendance", Clock, "Daily staff attendance."),
      link("Staff Management", "Leave Requests", "leave", CalendarOff, "Approve or reject staff leave."),
      link("Staff Management", "Advance Requests", "advances", HandCoins, "Approve or reject advance payments."),
      link("Staff Management", "Daily Tasks", "tasks", ListChecks, "Assign and track daily staff tasks."),
      link("Staff Management", "Hospital Inventory", "inventory", Package, "Chairs, tables, stools and other items."),
      link("Communication", "Chat", "chat", MessageSquare, "Messages with doctors, staff and patients."),
      link("Patient Care", "Patient Reviews", "reviews", Star, "Patients' ratings and comments after their treatment."),
      link("System", "Audit Log", "audit-logs", ScrollText, "Who changed what, and when."),
    ],
  },
  doctor: {
    label: "Doctor",
    roles: ["DOCTOR"],
    tagline: "Your patients, their visits and messages.",
    quickActions: ["visits", "patients", "chat"],
    navigation: [dashboard("Your patients at a glance."), patients("Patient Care"), visits("Patient Care"), ...selfService({ chat: true })],
  },
  nurse: {
    label: "Nurse",
    roles: ["NURSE"],
    tagline: "Patients under treatment and your daily tasks.",
    quickActions: ["visits", "patients", "tasks"],
    navigation: [dashboard("Patients under treatment."), patients("Patient Care"), visits("Patient Care"), ...selfService({ chat: true })],
  },
  store: {
    label: "Medical Store",
    roles: ["MEDICAL_STORE"],
    tagline: "Sell medicines and record purchases.",
    quickActions: ["sales", "purchases", "medicines", "expiry-alerts"],
    navigation: [dashboard("Medical store overview."), ...storeLinks("Medical Store"),
      link("Medical Store", "Stock Movements", "stock-movements", ArrowLeftRight, "Every quantity in and out."),
      ...selfService()],
  },
  cleaning: {
    label: "Cleaning Staff",
    roles: ["CLEANING_STAFF"],
    tagline: "Your tasks for today.",
    quickActions: ["tasks", "my-attendance"],
    navigation: [dashboard("Your work for today."), ...selfService()],
  },
  accountant: {
    label: "Accountant",
    roles: ["ACCOUNTANT"],
    tagline: "All medical store sales and counter collections, in PKR.",
    quickActions: ["store-sales", "payments", "dues", "finance"],
    navigation: [
      dashboard("Financial overview."),
      link("Finance", "Medical Store Sales", "store-sales", ShoppingCart, "Every sale made by the medical store."),
      link("Finance", "Counter Collections", "payments", CreditCard, "Every payment collected at the counter."),
      link("Finance", "Invoices", "invoices", ReceiptText, "Every charge to a patient."),
      link("Finance", "Outstanding Dues", "dues", Banknote, "Patients with unpaid balances."),
      link("Finance", "Medicine Purchases", "purchases", PackagePlus, "What the medical store bought from suppliers."),
      link("Finance", "Cash & Profit/Loss", "finance", ChartColumn, "Income, expenses and profit or loss."),
      ...selfService(),
    ],
  },
  hr: {
    label: "Human Resources",
    roles: ["HR"],
    tagline: "Staff, daily attendance, leave and hospital inventory.",
    quickActions: ["staff", "attendance", "leave", "inventory"],
    navigation: [
      dashboard("Staff overview."),
      link("Staff", "Staff", "staff", UsersRound, "Add new staff and view staff records."),
      link("Staff", "Attendance", "attendance", CalendarCheck, "Mark daily attendance for every staff member."),
      link("Staff", "Leave Requests", "leave", CalendarOff, "Approve or reject staff leave."),
      link("Staff", "Daily Tasks", "tasks", ClipboardList, "Assign and track daily staff tasks."),
      link("Hospital", "Hospital Inventory", "inventory", Package, "Chairs, tables, stools and other items."),
      link("My Work", "Advance Requests", "my-advances", HandCoins, "Request an advance payment from Admin."),
      link("My Work", "Chat", "chat", MessageSquare, "Messages with doctors and admin."),
      profile,
    ],
  },
  counter: {
    label: "Counter",
    roles: ["COUNTER"],
    tagline: "Register patients and record their payments.",
    quickActions: ["patients/new", "visits", "payments", "dues"],
    navigation: [
      dashboard("Front counter overview."),
      link("Patients", "Register Patient", "patients/new", UserPlus, "Register a new patient and issue an MRN."),
      link("Patients", "Patients", "patients", Search, "Find patients and see what they owe."),
      link("Patients", "Patient Visits", "visits", Stethoscope, "Open a visit when a patient arrives."),
      link("Payments", "Payments", "payments", CreditCard, "Record how much a patient paid."),
      link("Payments", "Outstanding Dues", "dues", Banknote, "How much each patient still has to pay."),
      ...selfService(),
    ],
  },
  patient: {
    label: "Patient",
    roles: ["PATIENT"],
    tagline: "Your visits, reports and dues in one place.",
    quickActions: ["visits", "dues", "chat"],
    navigation: [
      dashboard("Your health overview."),
      link("My Health", "My Visits & Reports", "visits", FileHeart, "Your visits, medicines and lab reports."),
      link("My Health", "My Dues & Payments", "dues", Banknote, "What you have paid and what is outstanding."),
      link("My Health", "Chat", "chat", MessageSquare, "Message your doctor or the hospital admin."),
      link("My Health", "Review Treatment", "reviews", Star, "Rate your treatment once it is finished."),
      profile,
    ],
  },
};

export function portalForRole(role: string): string | undefined {
  return Object.entries(PORTALS).find(([, portal]) => portal.roles.includes(role))?.[0];
}

export function findLink(portalId: string, slug: string): PortalLink | undefined {
  return PORTALS[portalId]?.navigation.find((item) => item.slug === slug);
}
