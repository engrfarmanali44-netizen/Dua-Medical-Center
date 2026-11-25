import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallApp } from "@/components/install-app";

export const metadata: Metadata = {
  title: "Dua Medical HMS",
  description: "Dua Medical Hospital management system",
  applicationName: "Dua Medical HMS",
  appleWebApp: { capable: true, title: "Dua HMS", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <InstallApp />
      </body>
    </html>
  );
}
