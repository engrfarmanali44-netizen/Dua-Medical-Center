"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Activity } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { portalForRole } from "@/config/portals";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [notice, setNotice] = useState("");

  /** Where to go after login: the page the user was on (same portal only), else the dashboard. */
  function destination(portal: string) {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith(`/${portal}/`) ? next : `/${portal}/dashboard`;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("expired")) setNotice("Your session has expired. Please sign in again.");
    if (params.has("changed")) setNotice("Password changed. Please sign in with your new password.");
    apiFetch("/api/v1/auth/me").then(async (response) => {
      if (response.ok) {
        const me = await response.json();
        const portal = me.roles?.map(portalForRole).find(Boolean);
        if (portal) router.replace(destination(portal));
      }
    }).catch(() => { /* not signed in or API unreachable: stay on the login form */ });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError("Incorrect username or password");
        return;
      }
      const meResponse = await apiFetch("/api/v1/auth/me");
      if (!meResponse.ok) throw new Error("Unable to load account");
      const me = await meResponse.json();
      if (me.must_change_password) {
        router.replace("/change-password");
        return;
      }
      const portal = me.roles?.map(portalForRole).find(Boolean);
      router.replace(portal ? destination(portal) : "/unauthorized");
    } catch {
      setError("Unable to connect to the authentication service");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-600 text-white">
            <Activity size={24} />
          </div>
          <div><p className="text-xs font-bold uppercase tracking-widest text-teal-700">HMS</p><h1 className="text-xl font-bold">Hospital Management System</h1></div>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-semibold text-slate-700">Username or email
            <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5" required />
          </label>
          <label className="block text-sm font-semibold text-slate-700">Password
            <div className="relative mt-2">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10" required minLength={12} />
              <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-3 text-slate-500">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember me</label>
          {notice && !error && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</div>}
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <button disabled={loading} className="w-full rounded-lg bg-teal-700 py-3 font-semibold text-white disabled:opacity-60">{loading ? "Signing in..." : "Login"}</button>
        </form>
      </section>
    </main>
  );
}
