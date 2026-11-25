"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Construction } from "lucide-react";
import { PORTALS, findLink } from "@/config/portals";
import { RoleDashboard } from "@/components/dashboard/RoleDashboard";
import { renderPage } from "@/config/pages";

export default function PortalPage() {
  const params = useParams<{ portal: string; slug?: string[] }>();
  const slug = params.slug?.join("/") || "dashboard";
  const portal = PORTALS[params.portal];

  if (slug === "dashboard") return <RoleDashboard portalId={params.portal} />;
  const screen = renderPage(params.portal, slug);
  if (screen) return screen;

  const link = findLink(params.portal, slug);
  const title = link?.label ?? slug.split(/[-/]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
  const Icon = link?.icon ?? Construction;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-6">
        <p className="text-sm text-slate-500">{portal?.label || "HMS"} Portal</p>
        <h1 className="text-2xl font-bold">{title}</h1>
        {link && <p className="mt-1 text-sm text-slate-500">{link.description}</p>}
      </div>
      <section className="rounded-xl border border-dashed bg-white p-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-700"><Icon size={24} aria-hidden /></span>
        <span className="mt-4 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Coming Soon</span>
        <h2 className="mt-3 text-lg font-semibold">{title} is not available yet</h2>
        <p className="mt-2 text-sm text-slate-500">This module is reserved for a future implementation milestone.</p>
        <Link href={`/${params.portal}/dashboard`} className="mt-6 inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          Back to dashboard
        </Link>
      </section>
    </div>
  );
}
