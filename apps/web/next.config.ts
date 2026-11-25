import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
