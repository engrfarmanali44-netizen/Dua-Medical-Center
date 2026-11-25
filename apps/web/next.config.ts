import type { NextConfig } from "next";
import path from "node:path";

// Hosted: set API_PROXY_TARGET (e.g. https://dua-medical-api.onrender.com) in Vercel. The site then
// forwards /api/* there, so the browser only ever talks to one domain.
const API_PROXY_TARGET = (process.env.API_PROXY_TARGET || "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_API_PROXY: API_PROXY_TARGET ? "1" : "" },
  async rewrites() {
    return API_PROXY_TARGET ? [{ source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` }] : [];
  },
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Lets phones on the same Wi-Fi load the dev server (set by `npm run dev:local -- --lan`).
  allowedDevOrigins: process.env.HMS_LAN_HOST ? [process.env.HMS_LAN_HOST] : [],
  // Installed apps must always get the newest service worker, so it is never cached by the browser.
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
    ] }];
  },
};

export default nextConfig;
