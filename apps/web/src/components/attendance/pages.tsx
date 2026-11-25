"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCheck, Save } from "lucide-react";
import { api } from "@/lib/api";
import { addDaysIso, fmtDate, todayIso } from "@/lib/format";
import { Button, Card, Empty, ErrorBanner, Input, Loading, Page, Pill, SearchInput, Stat, Table, Td, useData, useSubmit } from "@/components/ui";

type Status = "PRESENT" | "ABSENT" | "LATE" | "HALF_DAY" | "LEAVE";
type Rec = { status: Status; check_in: string | null; check_out: string | null; note: string | null; marked_at?: string | null };
type Row = { employee_id: string; employee_code: string; full_name: string; designation: string; department: string; role: string | null; record: Rec | null };
type Day = { date: string; is_today: boolean; rows: Row[]; summary: Record<Status | "unmarked" | "total", number> };
type Month = { month: string; days_so_far: number; rows: { employee_id: string; full_name: string; employee_code: string; department: string; counts: Record<Status, number>; days: Record<string, Status> }[] };
type Mine = { month: string; full_name: string; counts: Record<Status, number>; records: ({ date: string } & Rec)[] };

export const STATUS: Record<Status, { label: string; short: string; tone: "emerald" | "rose" | "amber" | "teal" | "slate"; cls: string }> = {
  PRESENT: { label: "Present", short: "P", tone: "emerald", cls: "bg-emerald-600 text-white" },
  ABSENT: { label: "Absent", short: "A", tone: "rose", cls: "bg-rose-600 text-white" },
  LATE: { label: "Late", short: "L", tone: "amber", cls: "bg-amber-500 text-white" },
  HALF_DAY: { label: "Half day", short: "½", tone: "teal", cls: "bg-sky-600 text-white" },
  LEAVE: { label: "Leave", short: "Lv", tone: "slate", cls: "bg-slate-600 text-white" },
};
const ORDER: Status[] = ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"];
const withTimes = (s: Status | null | undefined) => s === "PRESENT" || s === "LATE" || s === "HALF_DAY";

type Draft = { status: Status | null; check_in: string; check_out: string; note: string };
const fromRec = (r: Rec | null): Draft => ({ status: r?.status ?? null, check_in: r?.check_in ?? "", check_out: r?.check_out ?? "", note: r?.note ?? "" });
const same = (a: Draft, b: Draft) => a.status === b.status && a.check_in === b.check_in && a.check_out === b.check_out && a.note === b.note;

export function AttendancePage() {
  const [tab, setTab] = useState<"day" | "month">("day");
  return (
    <Page title="Attendance" subtitle="Mark the daily register for every staff member.">
      <div className="flex gap-2" role="tablist">
        {([["day", "Daily register"], ["month", "Monthly report"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
      </div>
      {tab === "day" ? <DailyRegister /> : <MonthlyReport />}
    </Page>
  );
}

function DailyRegister() {
  const [date, setDate] = useState(todayIso());
  const [q, setQ] = useState("");
  const { data, error, loading, setData } = useData(() => api.get<Day>(`/attendance/day?date=${date}`), [date], { live: ["attendance"] });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const save = useSubmit();
  const [saved, setSaved] = useState(false);

  // Reset local edits when a different day loads; keep them on live refreshes of the same day.
  useEffect(() => { setDrafts({}); setSaved(false); }, [date]);
  const base = useMemo(() => Object.fromEntries((data?.rows ?? []).map((r) => [r.employee_id, fromRec(r.record)])), [data]);
  const cur = (id: string) => drafts[id] ?? base[id];
  const set = (id: string, patch: Partial<Draft>) => { setSaved(false); setDrafts((d) => ({ ...d, [id]: { ...cur(id), ...patch } })); };
  const changed = Object.entries(drafts).filter(([id, d]) => base[id] && !same(d, base[id]));
  const rows = (data?.rows ?? []).filter((r) => !q || `${r.full_name} ${r.employee_code} ${r.department} ${r.designation}`.toLowerCase().includes(q.toLowerCase()));

  const markAllPresent = () => setDrafts((d) => {
    const next = { ...d };
    for (const r of data?.rows ?? []) if (!(next[r.employee_id] ?? base[r.employee_id]).status) next[r.employee_id] = { ...base[r.employee_id], status: "PRESENT" };
    return next;
  });
  const submit = () => save.run(async () => {
    const entries = changed.map(([employee_id, d]) => ({ employee_id, status: d.status,
      check_in: withTimes(d.status) && d.check_in ? d.check_in : null, check_out: withTimes(d.status) && d.check_out ? d.check_out : null, note: d.note || null }));
    if (!entries.length) return;
    setData(await api.put<Day>("/attendance/day", { date, entries }));
    setDrafts({}); setSaved(true);
  });
  const sum = data?.summary;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ORDER.map((s) => <Stat key={s} label={STATUS[s].label} value={sum ? sum[s] : "—"} tone={s === "ABSENT" ? "rose" : s === "PRESENT" ? "emerald" : s === "LATE" ? "amber" : "slate"} />)}
        <Stat label="Not marked" value={sum ? sum.unmarked : "—"} tone={sum?.unmarked ? "amber" : "slate"} />
      </div>
      <Card title={<span className="flex flex-wrap items-center gap-2">Register for {fmtDate(date)}{data?.is_today && <Pill tone="teal">Today</Pill>}</span>}
        actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex items-center gap-1">
            <Button variant="secondary" onClick={() => setDate(addDaysIso(-1, date))} aria-label="Previous day">‹</Button>
            <Input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" aria-label="Date" />
            <Button variant="secondary" disabled={date >= todayIso()} onClick={() => setDate(addDaysIso(1, date))} aria-label="Next day">›</Button>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Find staff" />
        </div>}>
        <ErrorBanner message={error ?? save.error} />
        {loading && !data ? <Loading /> : !rows.length ? <Empty title="No staff on the register" hint="Register staff first (Staff page)." /> : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <Button variant="secondary" icon={<CheckCheck size={16} />} onClick={markAllPresent}>Mark everyone unmarked as Present</Button>
              <span className="ml-auto text-sm text-slate-500">{changed.length ? `${changed.length} unsaved change(s)` : saved ? "All changes saved ✓" : ""}</span>
              <Button icon={<Save size={16} />} busy={save.busy} disabled={!changed.length} onClick={submit}>Save register</Button>
            </div>
            <Table head={["Staff", "Status", "In", "Out", "Note"]}>
              {rows.map((r) => {
                const d = cur(r.employee_id);
                const dirty = !same(d, base[r.employee_id]);
                return (
                  <tr key={r.employee_id} className={dirty ? "bg-amber-50/60" : ""}>
                    <Td><span className="font-medium text-slate-800">{r.full_name}</span><span className="block text-xs text-slate-500">{r.designation} · {r.department}</span></Td>
                    <Td>
                      <div className="flex gap-1" role="radiogroup" aria-label={`Status for ${r.full_name}`}>
                        {ORDER.map((s) => (
                          <button key={s} role="radio" aria-checked={d.status === s} title={STATUS[s].label}
                            onClick={() => set(r.employee_id, { status: d.status === s ? null : s })}
                            className={`h-9 min-w-9 rounded-md px-2 text-sm font-bold ring-1 ring-inset transition ${d.status === s ? `${STATUS[s].cls} ring-transparent` : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}>{STATUS[s].short}</button>))}
                      </div>
                    </Td>
                    <Td><Input type="time" value={d.check_in} disabled={!withTimes(d.status)} onChange={(e) => set(r.employee_id, { check_in: e.target.value })} className="w-28" aria-label="Check-in time" /></Td>
                    <Td><Input type="time" value={d.check_out} disabled={!withTimes(d.status)} onChange={(e) => set(r.employee_id, { check_out: e.target.value })} className="w-28" aria-label="Check-out time" /></Td>
                    <Td><Input value={d.note} onChange={(e) => set(r.employee_id, { note: e.target.value })} placeholder="Optional" className="min-w-40" aria-label="Note" /></Td>
                  </tr>);
              })}
            </Table>
          </>
        )}
      </Card>
    </>
  );
}

function MonthlyReport() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { data, error, loading } = useData(() => api.get<Month>(`/attendance/month?month=${month}`), [month], { live: ["attendance"] });
  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  }, [month]);
  return (
    <Card title={`Attendance report · ${month}`} actions={<Input type="month" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Month" />}>
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="No staff" /> : (
        <Table head={["Staff", ...ORDER.map((s) => STATUS[s].label), "Days"]}>
          {data.rows.map((r) => (
            <tr key={r.employee_id}>
              <Td><span className="font-medium text-slate-800">{r.full_name}</span><span className="block text-xs text-slate-500">{r.department}</span></Td>
              {ORDER.map((s) => <Td key={s} className="text-center font-semibold tabular-nums">{r.counts[s] || <span className="text-slate-300">0</span>}</Td>)}
              <Td>
                <div className="flex gap-0.5" aria-label="Daily marks">
                  {days.map((d) => {
                    const s = r.days[d];
                    return <span key={d} title={`${fmtDate(d)}: ${s ? STATUS[s].label : "not marked"}`}
                      className={`inline-block h-4 w-2.5 rounded-sm ${s ? STATUS[s].cls : d > todayIso() ? "bg-transparent" : "bg-slate-200"}`} />;
                  })}
                </div>
              </Td>
            </tr>))}
        </Table>
      )}
    </Card>
  );
}

export function MyAttendancePage() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { data, error, loading } = useData(
    () => api.get<Mine>(`/attendance/me?month=${month}`).catch((e: { status?: number }) => { if (e.status === 404) return null; throw e; }),
    [month], { live: ["attendance"] });
  return (
    <Page title="My attendance" subtitle="Marked daily by HR.">
      <ErrorBanner message={error} />
      {data && <div className="grid gap-3 sm:grid-cols-5">{ORDER.map((s) => <Stat key={s} label={STATUS[s].label} value={data.counts[s]} tone={s === "ABSENT" ? "rose" : s === "PRESENT" ? "emerald" : s === "LATE" ? "amber" : "slate"} />)}</div>}
      <Card title={`Month ${month}`} actions={<Input type="month" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Month" />}>
        {loading && data === null && !error ? <Loading /> : !data ? <Empty title="Your login is not linked to a staff record" /> : !data.records.length ? <Empty title="No attendance marked this month yet" /> : (
          <Table head={["Date", "Status", "In", "Out", "Note"]}>
            {[...data.records].reverse().map((r) => (
              <tr key={r.date}><Td>{fmtDate(r.date)}</Td><Td><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></Td><Td>{r.check_in ?? "—"}</Td><Td>{r.check_out ?? "—"}</Td><Td>{r.note ?? "—"}</Td></tr>))}
          </Table>
        )}
      </Card>
    </Page>
  );
}
