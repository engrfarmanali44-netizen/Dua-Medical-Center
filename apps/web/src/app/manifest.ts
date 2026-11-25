import type { MetadataRoute } from "next";

/** Web app manifest: lets phones and computers install HMS as an app (PWA). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dua Medical HMS",
    short_name: "Dua HMS",
    description: "Dua Medical Hospital management: patients, visits, medical store, billing, staff and chat.",
    start_url: "/login?source=app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    categories: ["medical", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
