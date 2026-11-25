"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Activity, Bell, LogOut, Menu, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { PortalUserProvider, type PortalUser } from "@/lib/portal-user";
import { PORTALS, portalForRole } from "@/config/portals";
import { useChatUnread } from "@/components/chat/pages";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ portal: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<PortalUser | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Phones: the sidebar is an off-canvas drawer, closed by default.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoadError(false);
    apiFetch("/api/v1/auth/me").then(async (r) => {
      if (!r.ok) { router.replace("/login"); return; }
      const data: PortalUser = await r.json();
      if (!data.is_superuser && !PORTALS[params.portal]?.roles.some((role) => data.roles.includes(role))) {
        router.replace("/unauthorized");
        return;
      }
      setMe(data);
    }).catch(() => setLoadError(true));
  }, [params.portal, router, attempt]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  const hasChat = Boolean(me && PORTALS[params.portal]?.navigation.some((l) => l.slug === "chat"));
  const chatUnread = useChatUnread(hasChat);

  async function logout() {
    try { await apiFetch("/api/v1/auth/logout", { method: "POST" }); } catch { /* still leave the portal */ }
    router.replace("/login");
  }

  if (loadError) return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="space-y-3">
        <p className="font-semibold text-slate-800">Cannot reach the HMS server.</p>
        <p className="text-sm text-slate-500">Check your internet connection, then try again.</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">Try again</button>
      </div>
    </main>
  );
  if (!me) return <main className="grid min-h-screen place-items-center text-slate-500">Loading portal...</main>;
  const portal = PORTALS[params.portal];
  const menu = portal?.navigation || [];
  const authorizedPortals = me.is_superuser
    ? Object.keys(PORTALS)
    : [...new Set(me.roles.map(portalForRole).filter((item): item is string => Boolean(item)))];
  const current = pathname.split("/").slice(2).join("/") || "dashboard";

  return (
    <main className="min-h-screen bg-slate-50">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-all md:z-20 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 ${collapsed ? "md:w-20" : "md:w-64"}`}>
        <div className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-700 text-white"><Activity size={20} /></div>
          <div className={collapsed ? "md:hidden" : ""}><p className="text-xs font-bold text-teal-700">Dua Medical</p><p className="text-sm font-semibold">Hospital HMS</p></div>
        </div>
        {authorizedPortals.length > 1 && (
          <label className={`block border-b p-3 text-xs font-semibold text-slate-500 ${collapsed ? "md:hidden" : ""}`}>
            SWITCH PORTAL
            <select
              aria-label="Switch portal"
              value={params.portal}
              onChange={(event) => router.push(`/${event.target.value}/dashboard`)}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700"
            >
              {authorizedPortals.map((portalId) => (
                <option key={portalId} value={portalId}>{PORTALS[portalId].label}</option>
              ))}
            </select>
          </label>
        )}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {menu.map(({ label, slug, icon: Icon }) => {
            const active = current === slug;
            return (
              <Link key={slug} href={`/${params.portal}/${slug}`} title={label} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition md:py-2 ${collapsed ? "md:justify-center" : ""} ${active ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-50 hover:text-teal-700"}`}>
                <Icon size={18} className="shrink-0" aria-hidden />
                <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>{label}</span>
                {slug === "chat" && chatUnread > 0 && (
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white" aria-label={`${chatUnread} unread messages`}>{chatUnread}</span>)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <section className={`min-w-0 transition-all ${collapsed ? "md:ml-20" : "md:ml-64"}`}>
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b bg-white px-4 md:h-16 md:px-6">
          <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
          <button className="hidden md:block" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar"><Menu size={20} /></button>
          <span className="truncate text-sm font-semibold text-slate-700 md:hidden">{portal?.label}</span>
          <div className="hidden w-full max-w-md items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-400 sm:flex"><Search size={16} />Global search</div>
          <div className="flex items-center gap-3">
            <Bell size={18} />
            <div className="h-8 w-8 rounded-full bg-teal-100 text-center text-xs font-bold leading-8 text-teal-800" title={me.username}>{me.username.slice(0, 2).toUpperCase()}</div>
            <button onClick={logout} aria-label="Logout"><LogOut size={18} /></button>
          </div>
        </header>
        <PortalUserProvider value={me}>{children}</PortalUserProvider>
      </section>
    </main>
  );
}
