"use client";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { usePortalUser } from "@/lib/portal-user";
import { humanize } from "@/lib/format";
import { Button, Card, Page, Pill } from "@/components/ui";

export function ProfilePage() {
  const me = usePortalUser();
  const rows: [string, React.ReactNode][] = [
    ["Username", me.username],
    ["Email", me.email || "—"],
    ["Role", <span key="r" className="flex flex-wrap gap-1">{me.roles.map((r) => <Pill key={r} tone="teal">{humanize(r)}</Pill>)}</span>],
    ["Access", me.is_superuser ? "Full access (administrator)" : `${me.permissions.length} permissions from your role`],
  ];
  return (
    <Page title="My profile" subtitle="Your account details.">
      <Card title="Account">
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-3">
              <dt className="text-sm font-medium text-slate-500">{k}</dt>
              <dd className="text-sm text-slate-800 sm:col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Security">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">Use a password of at least 12 characters that you do not use anywhere else.</p>
          <Link href="/change-password"><Button variant="secondary" icon={<KeyRound size={16} />}>Change password</Button></Link>
        </div>
      </Card>
    </Page>
  );
}
