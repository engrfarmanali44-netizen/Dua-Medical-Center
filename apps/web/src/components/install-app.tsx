"use client";
/**
 * Installable web app (PWA): registers the service worker and, every time the link is opened,
 * offers "Install app / Not now" until the app is installed.
 *
 * - Browser can install directly (Chrome / Edge on HTTPS or localhost): "Install app" opens the
 *   browser's own install dialog.
 * - Browser cannot install directly (iPhone Safari, phones on a plain http:// Wi-Fi address,
 *   Firefox, ...): "Install app" shows the short steps for that device instead.
 * - "Not now" hides the offer for this visit only; it appears again the next time the link is opened.
 */
import { useEffect, useState } from "react";
import { Download, MoreVertical, PlusSquare, Share, X } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Platform = "ios" | "android" | "desktop";

const SESSION_KEY = "hms-install-not-now";

function dismissedThisVisit(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}
function rememberNotNow() {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* private mode: just hide */ }
}
function isInstalled(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: window-controls-overlay)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function platform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function Steps({ p }: { p: Platform }) {
  const li = "flex items-start gap-2";
  if (p === "ios") return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className={li}><b>1.</b> Tap <Share size={16} className="mt-0.5 inline shrink-0" aria-label="Share" /> <b>Share</b> at the bottom of Safari.</li>
      <li className={li}><b>2.</b> Choose <PlusSquare size={16} className="mt-0.5 inline shrink-0" aria-hidden /> <b>Add to Home Screen</b>, then <b>Add</b>.</li>
    </ol>
  );
  if (p === "android") return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className={li}><b>1.</b> Tap <MoreVertical size={16} className="mt-0.5 inline shrink-0" aria-label="menu" /> (top right in Chrome).</li>
      <li className={li}><b>2.</b> Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b> / <b>Add</b>.</li>
    </ol>
  );
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className={li}><b>1.</b> In Chrome or Edge, click the <Download size={16} className="mt-0.5 inline shrink-0" aria-hidden /> install icon at the right end of the address bar,</li>
      <li className={li}>or open the browser menu <MoreVertical size={16} className="mt-0.5 inline shrink-0" aria-label="menu" /> → <b>Cast, save and share → Install page as app</b> (Chrome) / <b>Apps → Install this site as an app</b> (Edge).</li>
    </ol>
  );
}

export function InstallApp() {
  const [show, setShow] = useState(false);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [steps, setSteps] = useState(false);
  const [p, setP] = useState<Platform>("desktop");

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const mode = process.env.NODE_ENV === "production" ? "prod" : "dev";
      navigator.serviceWorker.register(`/sw.js?mode=${mode}`, { scope: "/" }).catch(() => { /* not fatal */ });
    }
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    setP(platform());
    if (!isInstalled() && !dismissedThisVisit()) setShow(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;
  const notNow = () => { rememberNotNow(); setShow(false); };
  const install = async () => {
    if (!event) { setSteps(true); return; }
    await event.prompt();
    const { outcome } = await event.userChoice;
    setEvent(null);
    if (outcome === "accepted") setShow(false);
  };

  return (
    <div role="dialog" aria-label="Install the HMS app"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:bottom-5">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">Install Dua Medical HMS?</p>
          <p className="mt-0.5 text-sm text-slate-600">Open it like an app from your {p === "desktop" ? "desktop" : "home screen"}, in its own window.</p>
        </div>
        <button onClick={notNow} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
      </div>
      {steps && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-800">How to install on this {p === "desktop" ? "computer" : "phone"}:</p>
          <Steps p={p} />
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={notNow} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Not now</button>
        {!steps && (
          <button onClick={install}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            <Download size={16} />Install app
          </button>
        )}
      </div>
    </div>
  );
}
