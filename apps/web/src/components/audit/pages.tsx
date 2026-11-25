"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime, humanize } from "@/lib/format";
import { Button, Card, Empty, ErrorBanner, Loading, Page, Pill, SearchInput, Select, useData, useDebounced } from "@/components/ui";

type Row = { id: string; action: string; entity_type: string; entity_id: string; actor: string | null; actor_username: string | null;
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; created_at: string };
type Data = { entities: string[]; has_more: boolean; rows: Row[] };

const TONE: Record<string, "emerald" | "rose" | "amber" | "teal" | "slate"> = { CREATE: "emerald", DELETE: "rose", UPDATE: "amber", APPROVED: "emerald", REJECTED: "rose", PAID: "teal" };

function Values({ v }: { v: Record<string, unknown> | null }) {
  if (!v || !Object.keys(v).length) return null;
  return <span className="text-xs text-slate-500">{Object.entries(v).slice(0, 6).map(([k, x]) => `${humanize(k)}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ")}</span>;
}

export function AuditLogPage() {
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const dq = useDebounced(q);
  const [older, setOlder] = useState<Row[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const { data, error, loading } = useData(async () => { setOlder([]); setMore(null);
    return api.get<Data>(`/audit-logs?${new URLSearchParams({ ...(dq && { q: dq }), ...(entity && { entity }) })}`); }, [dq, entity]);
  const rows = [...(data?.rows ?? []), ...older];
  const hasMore = more ?? data?.has_more;
  const loadOlder = async () => {
    const last = rows[rows.length - 1];
    const next = await api.get<Data>(`/audit-logs?${new URLSearchParams({ ...(dq && { q: dq }), ...(entity && { entity }), before: last.created_at })}`);
    setOlder((o) => [...o, ...next.rows]); setMore(next.has_more);
  };
  return (
    <Page title="Audit log" subtitle="Who did what, and when. Records cannot be edited or deleted.">
      <Card title={`${rows.length} entries`} actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="sm:w-48" aria-label="Area"><option value="">Everything</option>{data?.entities.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</Select>
        <SearchInput value={q} onChange={setQ} placeholder="Username or record" />
      </div>}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !rows.length ? <Empty title="Nothing recorded yet" /> : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="space-y-0.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone={TONE[r.action] ?? "slate"}>{humanize(r.action)}</Pill>
                  <b className="text-slate-800">{humanize(r.entity_type)}</b>
                  <span className="text-slate-500">by <b className="text-slate-700">{r.actor ?? "system"}</b>{r.actor_username && r.actor !== r.actor_username && ` (${r.actor_username})`}</span>
                  <span className="ml-auto text-xs text-slate-500">{fmtDateTime(r.created_at)}</span>
                </div>
                <Values v={r.new_values ?? r.old_values} />
              </li>))}
          </ul>
        )}
        {hasMore && <div className="border-t p-3 text-center"><Button variant="secondary" onClick={loadOlder}>Load older entries</Button></div>}
      </Card>
    </Page>
  );
}
