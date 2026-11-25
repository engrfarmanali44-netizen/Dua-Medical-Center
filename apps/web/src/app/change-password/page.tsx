"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Eye, EyeOff } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { portalForRole } from "@/config/portals";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<{ roles: string[]; must_change_password: boolean } | null>(null);

  useEffect(() => {
    apiFetch("/api/v1/auth/me").then(async (r) => {
      if (!r.ok) { router.replace("/login"); return; }
      setMe(await r.json());
    }).catch(() => setMessage("Cannot reach the server. Check your internet connection."));
  }, [router]);

  const portal = me?.roles.map(portalForRole).find(Boolean);
  const goToPortal = () => router.replace(portal ? `/${portal}/dashboard` : "/unauthorized");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (newPassword.length < 12) return setMessage("The new password must have at least 12 characters.");
    if (newPassword !== confirm) return setMessage("The two new passwords do not match.");
    if (newPassword === currentPassword) return setMessage("Choose a password different from the current one.");
    setBusy(true);
    try {
      const response = await apiFetch("/api/v1/auth/change-password", {
        method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (response.ok) {
        // Changing the password signs out every device, including this one: sign in again with the new password.
        await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
        router.replace("/login?changed=1");
        return;
      }
      const body = await response.json().catch(() => null);
      setMessage(typeof body?.detail === "string" ? body.detail : "Password change failed. Check the current password.");
    } catch {
      setMessage("Cannot reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border bg-white p-8 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-white"><Activity size={22} /></div>
          <div>
            <h1 className="text-xl font-bold">{me?.must_change_password ? "Set your own password" : "Change password"}</h1>
            <p className="text-sm text-slate-500">{me?.must_change_password
              ? "You are using a password given to you. For your security, choose your own now, or do it later."
              : "Choose a new password of at least 12 characters."}</p>
          </div>
        </div>
        <label className="block text-sm font-semibold text-slate-700">Current password
          <input type={show ? "text" : "password"} autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={`mt-1.5 ${input}`} />
        </label>
        <label className="block text-sm font-semibold text-slate-700">New password
          <input type={show ? "text" : "password"} autoComplete="new-password" required minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={`mt-1.5 ${input}`} />
        </label>
        <label className="block text-sm font-semibold text-slate-700">Repeat new password
          <input type={show ? "text" : "password"} autoComplete="new-password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`mt-1.5 ${input}`} />
        </label>
        <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}{show ? "Hide passwords" : "Show passwords"}
        </button>
        {message && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-teal-700 py-3 font-semibold text-white disabled:opacity-60">{busy ? "Saving..." : "Change password"}</button>
        <button type="button" onClick={goToPortal} disabled={!me} className="w-full rounded-lg border border-slate-300 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Not now
        </button>
        {me?.must_change_password && <p className="text-center text-xs text-slate-500">You will be reminded next time you sign in. You can also change it any time from Profile.</p>}
      </form>
    </main>
  );
}
