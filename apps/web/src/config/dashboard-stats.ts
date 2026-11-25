import type { LucideIcon } from "lucide-react";
import {
  Banknote, Bell, CalendarOff, HandCoins, Boxes, Building2, ClipboardCheck, FileHeart, History, ListChecks, Pill,
  ReceiptText, ShoppingCart, Star, Stethoscope, TrendingUp, TriangleAlert, UserPlus, Users, UsersRound, Wallet,
} from "lucide-react";

export type Tone = "teal" | "blue" | "violet" | "amber" | "rose" | "emerald" | "slate";

export type StatMeta = {
  icon: LucideIcon;
  tone: Tone;
  /** Menu slugs the card links to; the first one present in the current portal is used. */
  slugs?: string[];
};

/** Visual metadata keyed by the stat `key` returned from GET /api/v1/dashboard/{portal}. */
export const STAT_META: Record<string, StatMeta> = {
  patients_total: { icon: FileHeart, tone: "teal", slugs: ["patients"] },
  patients_today: { icon: UserPlus, tone: "emerald", slugs: ["patients"] },
  open_visits: { icon: Stethoscope, tone: "violet", slugs: ["visits"] },
  my_open_visits: { icon: Stethoscope, tone: "violet", slugs: ["visits"] },
  my_visits_month: { icon: ClipboardCheck, tone: "slate", slugs: ["visits"] },
  my_visits: { icon: History, tone: "slate", slugs: ["visits"] },
  employees_active: { icon: UsersRound, tone: "teal", slugs: ["staff"] },
  employees_total: { icon: UsersRound, tone: "slate", slugs: ["staff"] },
  joined_month: { icon: UserPlus, tone: "emerald", slugs: ["staff"] },
  departments: { icon: Building2, tone: "slate" },
  active_users: { icon: Users, tone: "blue", slugs: ["staff"] },
  store_sales_today: { icon: ShoppingCart, tone: "teal", slugs: ["sales", "store-sales"] },
  store_sales_month: { icon: ShoppingCart, tone: "slate", slugs: ["sales", "store-sales"] },
  collections_today: { icon: Banknote, tone: "emerald", slugs: ["payments"] },
  my_collections_today: { icon: Banknote, tone: "emerald", slugs: ["payments"] },
  collections_month: { icon: TrendingUp, tone: "teal", slugs: ["payments"] },
  billed_month: { icon: ReceiptText, tone: "blue", slugs: ["invoices"] },
  outstanding: { icon: TriangleAlert, tone: "rose", slugs: ["dues"] },
  pending_tasks: { icon: ListChecks, tone: "amber", slugs: ["tasks"] },
  medicines_active: { icon: Pill, tone: "teal", slugs: ["medicines"] },
  batches_expiring_30: { icon: TriangleAlert, tone: "amber", slugs: ["expiry-alerts"] },
  batches_expired: { icon: TriangleAlert, tone: "rose", slugs: ["expiry-alerts"] },
  my_balance: { icon: Wallet, tone: "rose", slugs: ["dues"] },
  avg_rating: { icon: Star, tone: "amber", slugs: ["reviews"] },
  leave_to_approve: { icon: CalendarOff, tone: "amber", slugs: ["leave"] },
  on_leave_today: { icon: CalendarOff, tone: "slate", slugs: ["leave", "attendance"] },
  advances_to_decide: { icon: HandCoins, tone: "amber", slugs: ["advances"] },
  my_open_tasks: { icon: ListChecks, tone: "amber", slugs: ["tasks"] },
  unread_notifications: { icon: Bell, tone: "slate" },
};

export const FALLBACK_META: StatMeta = { icon: Boxes, tone: "slate" };

export const TONE_CLASSES: Record<Tone, string> = {
  teal: "bg-teal-50 text-teal-700",
  blue: "bg-sky-50 text-sky-700",
  violet: "bg-violet-50 text-violet-700",
  amber: "bg-amber-50 text-amber-700",
  rose: "bg-rose-50 text-rose-700",
  emerald: "bg-emerald-50 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
};
