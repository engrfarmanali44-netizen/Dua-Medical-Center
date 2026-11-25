const pkrFormat = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qtyFormat = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 3 });
const dateFormat = new Intl.DateTimeFormat("en-PK", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
const dateTimeFormat = new Intl.DateTimeFormat("en-PK", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });

export const pkr = (v: string | number | null | undefined) => pkrFormat.format(Number(v ?? 0));
export const qty = (v: string | number | null | undefined) => qtyFormat.format(Number(v ?? 0));
/** Accepts "YYYY-MM-DD" or ISO timestamps. Date-only values are not shifted across time zones. */
export const fmtDate = (v: string | null | undefined) =>
  v ? dateFormat.format(new Date(v.length === 10 ? `${v}T12:00:00+05:00` : v)) : "—";
export const fmtDateTime = (v: string | null | undefined) => (v ? dateTimeFormat.format(new Date(v)) : "—");
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
/** `days` after `from` (default: today), as YYYY-MM-DD in Pakistan time. */
export const addDaysIso = (days: number, from?: string) => {
  const d = new Date(`${from ?? todayIso()}T12:00:00+05:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
};
export const humanize = (v: string | null | undefined) =>
  v ? v.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

/** Round to 2 decimals in a way that matches the server (half-up on cents). */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
