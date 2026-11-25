"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, ListChecks, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { fmtDate, todayIso } from "@/lib/format";
import { realtimeEnabled, useLive } from "@/lib/realtime";
import { usePortalUser } from "@/lib/portal-user";
import { PORTALS, findLink, type PortalLink } from "@/config/portals";
import { FALLBACK_META, STAT_META, TONE_CLASSES } from "@/config/dashboard-stats";
import { isImplemented } from "@/config/pages";

type Stat = { key: string; label: string; value: number | string | null; format: "number" | "currency" | "rating"; hint?: string | null };
type Task = { id: string; title: string; status: string; priority: string; due_date: string | null };
type DashboardData = { portal: string; date: string; currency: string; stats: Stat[]; my_tasks: Task[] };

const pkr = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-PK");
const longDate = new Intl.DateTimeFormat("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Karachi" });

function formatValue(stat: Stat) {
  if (stat.value === null || stat.value === undefined) return "—";
  const n = Number(stat.value);
  if (Number.isNaN(n)) return String(stat.value);
  if (stat.format === "rating") return `${n.toFixed(1)} / 5`;
  return stat.format === "currency" ? pkr.format(n) : count.format(n);
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Karachi" }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const PRIORITY_CLASSES: Record<string, string> = {
  URGENT: "bg-rose-50 text-rose-700",
  HIGH: "bg-amber-50 text-amber-700",
  NORMAL: "bg-slate-100 text-slate-600",
  LOW: "bg-slate-50 text-slate-500",
};

export function RoleDashboard({ portalId }: { portalId: string }) {
  const user = usePortalUser();
  const portal = PORTALS[portalId];
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // Refresh the numbers whenever anyone changes data the dashboard summarizes.
  useLive(["dashboard"], () => setReloadKey((k) => k + 1), 800);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/v1/dashboard/${portalId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "You do not have access to this dashboard." : "Dashboard data could not be loaded.");
        return (await r.json()) as DashboardData;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || "Dashboard data could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [portalId, reloadKey]);

  const groups = useMemo(() => {
    const map = new Map<string, PortalLink[]>();
    for (const item of portal?.navigation ?? []) {
      if (item.slug === "dashboard") continue;
      map.set(item.group, [...(map.get(item.group) ?? []), item]);
    }
    return [...map.entries()];
  }, [portal]);

  if (!portal) return null;
  const quickActions = portal.quickActions.map((slug) => findLink(portalId, slug)).filter((x): x is PortalLink => Boolean(x));
  const showTasks = portalId !== "patient";

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6">
      {/* Greeting */}
      <header className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-teal-700 to-teal-900 p-6 text-white shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-100">{portal.label} Portal · {longDate.format(new Date())}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{greeting()}, {user.username}</h1>
          <p className="mt-2 max-w-xl text-sm text-teal-50/90">{portal.tagline}</p>
        </div>
        {quickActions.length > 0 && (
          <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
            {quickActions.map(({ slug, label, icon: Icon }) => (
              <Link key={slug} href={`/${portalId}/${slug}`}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20">
                <Icon size={16} aria-hidden />{label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Metrics */}
      <section aria-labelledby="metrics-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="metrics-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-800">Today at a glance
            {realtimeEnabled && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700" title="Numbers update automatically when data changes"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live</span>}
          </h2>
          <button onClick={() => setReloadKey((k) => k + 1)} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />Refresh
          </button>
        </div>
        {error ? (
          <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <CircleAlert size={18} aria-hidden />{error}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loading && !data
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl border bg-white" />)
              : data?.stats.map((s) => <StatCard key={s.key} stat={s} portalId={portalId} />)}
          </div>
        )}
      </section>

      <div className={`grid gap-8 ${showTasks ? "lg:grid-cols-3" : ""}`}>
        {/* All role options, grouped */}
        <section aria-labelledby="modules-heading" className={showTasks ? "lg:col-span-2" : ""}>
          <h2 id="modules-heading" className="mb-3 text-lg font-semibold text-slate-800">Your workspace</h2>
          <div className="space-y-6">
            {groups.map(([group, items]) => (
              <div key={group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map((item) => <ModuleCard key={item.slug} item={item} portalId={portalId} />)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {showTasks && (
          <aside aria-labelledby="tasks-heading" className="h-fit rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="tasks-heading" className="flex items-center gap-2 font-semibold text-slate-800"><ListChecks size={18} aria-hidden />My open tasks</h2>
              {findLink(portalId, "tasks") && <Link href={`/${portalId}/tasks`} className="text-sm font-medium text-teal-700 hover:underline">View all</Link>}
            </div>
            {loading && !data ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : data?.my_tasks.length ? (
              <ul className="divide-y">
                {data.my_tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{t.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{t.status.replaceAll("_", " ").toLowerCase()}{t.due_date && ` · ${t.due_date === todayIso() ? "today" : `due ${fmtDate(t.due_date)}`}`}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_CLASSES[t.priority] ?? PRIORITY_CLASSES.NORMAL}`}>{t.priority.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">You&apos;re all caught up. No open tasks.</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function StatCard({ stat, portalId }: { stat: Stat; portalId: string }) {
  const meta = STAT_META[stat.key] ?? FALLBACK_META;
  const Icon = meta.icon;
  const slug = meta.slugs?.find((s) => findLink(portalId, s));
  const href = slug ? `/${portalId}/${slug}` : null;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{stat.label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${TONE_CLASSES[meta.tone]}`}><Icon size={18} aria-hidden /></span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatValue(stat)}</p>
      {stat.hint && <p className="mt-1 text-xs text-slate-500">{stat.hint}</p>}
    </>
  );
  const cls = "block rounded-xl border bg-white p-5 shadow-sm";
  return href
    ? <Link href={href} className={`${cls} transition hover:border-teal-300 hover:shadow`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

function ModuleCard({ item, portalId }: { item: PortalLink; portalId: string }) {
  const Icon = item.icon;
  return (
    <Link href={`/${portalId}/${item.slug}`}
      className="group flex items-start gap-3 rounded-xl border bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700"><Icon size={20} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold text-slate-800">{item.label}
            {!isImplemented(portalId, item.slug) && item.slug !== "profile" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Soon</span>}
          </span>
          <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" aria-hidden />
        </span>
        <span className="mt-1 block text-sm text-slate-500">{item.description}</span>
      </span>
    </Link>
  );
}
