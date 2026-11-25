"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Inbox, Loader2, Search, X } from "lucide-react";
import { usePortalUser } from "@/lib/portal-user";
import { useLive, type LiveTopic } from "@/lib/realtime";

/* ---------------------------------------------------------------- hooks */

/**
 * Load data on mount / when deps change; `reload()` refetches.
 * `live`: refetch automatically when another user changes this kind of data (Supabase Realtime).
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[], opts: { live?: LiveTopic[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef.current()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useLive(opts.live, reload);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useCan() {
  const user = usePortalUser();
  return (permission: string) => user.is_superuser || user.permissions.includes(permission);
}

/* ---------------------------------------------------------------- layout */

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          {title && <h2 className="font-semibold text-slate-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "slate" }: { label: string; value: ReactNode; tone?: "slate" | "rose" | "emerald" | "amber" }) {
  const tones = { slate: "text-slate-900", rose: "text-rose-700", emerald: "text-emerald-700", amber: "text-amber-700" };
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- feedback */

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss"><X size={16} /></button>}
    </div>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{label}</div>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <Inbox size={28} className="text-slate-300" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PARTIALLY_PAID: "bg-amber-50 text-amber-800 ring-amber-600/20",
  UNPAID: "bg-rose-50 text-rose-700 ring-rose-600/20",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  VOID: "bg-slate-100 text-slate-600 ring-slate-500/20",
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-500/20",
};
export function StatusBadge({ status }: { status: string }) {
  const label = { PARTIALLY_PAID: "Partially paid", UNPAID: "Unpaid", PAID: "Paid" }[status] ?? status.toLowerCase();
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE_TONES[status] ?? BADGE_TONES.DRAFT}`}>{label}</span>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "rose" | "amber" | "emerald" | "teal" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-800", emerald: "bg-emerald-50 text-emerald-700", teal: "bg-teal-50 text-teal-700" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

/* ---------------------------------------------------------------- controls */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean; icon?: ReactNode };
export function Button({ variant = "primary", busy, icon, children, className = "", disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50",
  };
  return (
    <button {...rest} disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${styles[variant]} ${className}`}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : icon}{children}
    </button>
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-50";
export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...props} className={`${inputCls} ${props.className ?? ""}`} />;

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} />
    </div>
  );
}

/* ---------------------------------------------------------------- table */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2.5">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) =>
  <td className={`whitespace-nowrap px-4 py-2.5 text-slate-700 ${className}`}>{children}</td>;
export const Num = ({ children, className = "" }: { children?: ReactNode; className?: string }) =>
  <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-slate-700 ${className}`}>{children}</td>;

/* ---------------------------------------------------------------- modal */

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Wraps an async submit: tracks busy state and turns thrown errors into a message. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}
