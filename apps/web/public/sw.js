/* Dua Medical HMS service worker (makes the web app installable).
 *
 * Privacy rule: NOTHING from the API (patients, visits, money) is ever cached on the device.
 * Only the app's own static files are cached, so it starts faster; pages always come from the
 * network, with a simple offline page when there is no connection.
 * Registered as /sw.js?mode=prod in production builds and /sw.js?mode=dev in development
 * (in development nothing is cached, so code changes always show up).
 */
const MODE = new URL(self.location.href).searchParams.get("mode") || "dev";
const VERSION = "hms-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, Supabase, storage: never touched

  // Pages: always from the network; offline page if there is no connection.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Built static files have content hashes in their names, so caching them is safe (production only).
  if (MODE === "prod" && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
