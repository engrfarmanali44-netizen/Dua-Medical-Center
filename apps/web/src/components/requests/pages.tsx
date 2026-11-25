"use client";
import { useState } from "react";
import { Banknote, CalendarOff, Check, Clock3, HandCoins, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { addDaysIso, fmtDate, fmtDateTime, humanize, pkr, todayIso } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Page, Pill, Select, Stat, Textarea, useData, useSubmit } from "@/components/ui";

type Decision = { decision: "PENDING" | "APPROVED" | "REJECTED"; by: string | null; at: string | null; comment: string | null };
type Leave = { id: string; leave_type: string; start_date: string; end_date: string; days: number; reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; created_at: string;
  employee: { id: string; name: string; designation: string; department: string }; admin: Decision; hr: Decision;
  can_decide?: { admin: boolean; hr: boolean } };
type Advance = { id: string; request_number: string; amount: string; reason: string; status: "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";
  approved_amount: string | null; created_at: string; employee: { id: string; name: string; designation: string; department: string };
  decided_by: string | null; decided_at: string | null; decision_comment: string | null; paid_by: string | null; paid_at: string | null;
  payment_method: string | null; payment_reference: string | null };

const TONE = { PENDING: "amber", APPROVED: "emerald", REJECTED: "rose", CANCELLED: "slate", PAID: "teal" } as const;
const LABEL: Record<string, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled", PAID: "Paid" };
const range = (l: Leave) => l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`;

function DecisionChip({ who, d }: { who: string; d: Decision }) {
  const icon = d.decision === "APPROVED" ? <Check size={13} /> : d.decision === "REJECTED" ? <X size={13} /> : <Clock3 size={13} />;
  const cls = d.decision === "APPROVED" ? "bg-emerald-50 text-emerald-700" : d.decision === "REJECTED" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`} title={d.comment ?? undefined}>
      {icon}{who}{d.by && d.decision !== "PENDING" ? `: ${d.by}` : ""}
    </span>
  );
}

/* ================================================================ LEAVE */

function LeaveForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState("CASUAL");
  const [start, setStart] = useState(addDaysIso(1));
  const [end, setEnd] = useState(addDaysIso(1));
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSubmit();
  const days = start && end && end >= start ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1 : 0;
  const submit = () => run(async () => {
    if (!days) throw new Error("The end date must be on or after the start date.");
    if (reason.trim().length < 3) throw new Error("Please write a short reason.");
    await api.post("/leave/requests", { leave_type: type, start_date: start, end_date: end, reason });
    setReason(""); onDone();
  });
  return (
    <div className="space-y-4 p-5">
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{["CASUAL", "SICK", "ANNUAL", "OTHER"].map((t) => <option key={t} value={t}>{humanize(t)} leave</option>)}</Select></Field>
        <Field label="From"><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></Field>
        <Field label="To"><Input type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Reason *"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever, doctor advised 2 days rest" /></Field>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-500">{days ? `${days} day${days > 1 ? "s" : ""}` : ""} · needs approval from <b>Admin and HR</b></span>
        <Button busy={busy} onClick={submit} icon={<CalendarOff size={16} />}>Send request</Button>
      </div>
    </div>
  );
}

function MyLeaveList() {
  const { data, error, loading, reload } = useData(() => api.get<Leave[]>("/leave/mine").catch((e: { status?: number }) => { if (e.status === 404) return null; throw e; }), [], { live: ["leave"] });
  const [open, setOpen] = useState(false);
  const cancel = useSubmit();
  if (loading && data === undefined) return <Loading />;
  if (data === null) return <Card><Empty title="Your login is not linked to a staff record" /></Card>;
  return (
    <>
      <Card title="Request leave" actions={!open && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>New request</Button>}>
        {open ? <LeaveForm onDone={() => { setOpen(false); reload(); }} /> : <p className="p-5 text-sm text-slate-500">Leave is approved only when <b>both Admin and HR</b> accept. It then shows as Leave in your attendance.</p>}
      </Card>
      <ErrorBanner message={error ?? cancel.error} />
      <Card title="My requests">
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No leave requests yet" /> : (
          <ul className="divide-y">
            {data.map((l) => (
              <li key={l.id} className="space-y-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{humanize(l.leave_type)} leave · {range(l)} <span className="font-normal text-slate-500">({l.days} day{l.days > 1 ? "s" : ""})</span></span>
                  <Pill tone={TONE[l.status]}>{LABEL[l.status]}</Pill>
                </div>
                <p className="text-sm text-slate-600">{l.reason}</p>
                <div className="flex flex-wrap items-center gap-2"><DecisionChip who="Admin" d={l.admin} /><DecisionChip who="HR" d={l.hr} />
                  {l.status === "PENDING" && <Button variant="ghost" busy={cancel.busy} onClick={() => window.confirm("Cancel this leave request?") && cancel.run(async () => { await api.post(`/leave/requests/${l.id}/cancel`, {}); reload(); })}>Cancel request</Button>}
                </div>
                {[l.admin, l.hr].filter((d) => d.comment).map((d, i) => <p key={i} className="text-xs text-slate-500">“{d.comment}” — {d.by}</p>)}
              </li>))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function MyLeavePage() {
  return <Page title="Leave requests" subtitle="Ask for leave. Approved only when both Admin and HR accept."><MyLeaveList /></Page>;
}

function DecideLeave({ l, side, onDone }: { l: Leave; side: "ADMIN" | "HR"; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const { busy, error, run } = useSubmit();
  const go = (decision: "APPROVE" | "REJECT") => run(async () => { await api.post(`/leave/requests/${l.id}/decision`, { decision, comment: comment || null, side }); onDone(); });
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <ErrorBanner message={error} />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{side === "ADMIN" ? "Admin decision" : "HR decision"}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment" />
        <div className="flex gap-2"><Button busy={busy} icon={<Check size={15} />} onClick={() => go("APPROVE")}>Approve</Button><Button variant="danger" busy={busy} icon={<X size={15} />} onClick={() => go("REJECT")}>Reject</Button></div>
      </div>
    </div>
  );
}

export function LeaveApprovalsPage({ withMyTab = false }: { withMyTab?: boolean }) {
  const [tab, setTab] = useState<"approve" | "mine">("approve");
  const [status, setStatus] = useState("PENDING");
  const { data, error, loading, reload } = useData(() => api.get<Leave[]>(`/leave/requests${status ? `?status=${status}` : ""}`), [status], { live: ["leave"] });
  return (
    <Page title="Leave requests" subtitle="Leave is approved only when both Admin and HR approve. Approved days are marked as Leave in attendance.">
      {withMyTab && (
        <div className="flex gap-2" role="tablist">
          {([["approve", "Approve requests"], ["mine", "My leave"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
        </div>)}
      {tab === "mine" ? <MyLeaveList /> : (
        <Card title={data ? `${data.length} request${data.length === 1 ? "" : "s"}` : "Requests"}
          actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status">
            <option value="PENDING">Waiting</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option><option value="">All</option>
          </Select>}>
          <ErrorBanner message={error} />
          {loading && !data ? <Loading /> : !data?.length ? <Empty title={status === "PENDING" ? "No leave waiting for a decision" : "No leave requests"} /> : (
            <ul className="divide-y">
              {data.map((l) => (
                <li key={l.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><b className="text-slate-800">{l.employee.name}</b> <span className="text-sm text-slate-500">{l.employee.designation} · {l.employee.department}</span></span>
                    <Pill tone={TONE[l.status]}>{LABEL[l.status]}</Pill>
                  </div>
                  <p className="text-sm text-slate-700">{humanize(l.leave_type)} leave · <b>{range(l)}</b> ({l.days} day{l.days > 1 ? "s" : ""})</p>
                  <p className="text-sm text-slate-600">“{l.reason}”</p>
                  <div className="flex flex-wrap gap-2"><DecisionChip who="Admin" d={l.admin} /><DecisionChip who="HR" d={l.hr} /></div>
                  {l.can_decide?.admin && <DecideLeave l={l} side="ADMIN" onDone={reload} />}
                  {l.can_decide?.hr && <DecideLeave l={l} side="HR" onDone={reload} />}
                </li>))}
            </ul>
          )}
        </Card>
      )}
    </Page>
  );
}

/* ================================================================ ADVANCES */

export function MyAdvancesPage() {
  const { data, error, loading, reload } = useData(() => api.get<Advance[]>("/advances/mine").catch((e: { status?: number }) => { if (e.status === 404) return null; throw e; }), [], { live: ["advances"] });
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const { busy, error: err, run } = useSubmit();
  const hasPending = (data ?? []).some((a) => a.status === "PENDING");
  const submit = () => run(async () => {
    if (!(Number(amount) > 0)) throw new Error("Enter the amount in PKR.");
    if (reason.trim().length < 3) throw new Error("Please write a short reason.");
    await api.post("/advances", { amount: Number(amount), reason }); setAmount(""); setReason(""); reload();
  });
  return (
    <Page title="Advance requests" subtitle="Ask Admin for an advance payment.">
      {data === null ? <Card><Empty title="Your login is not linked to a staff record" /></Card> : (
        <>
          <Card title="Request an advance">
            {hasPending ? <p className="p-5 text-sm text-slate-600">You already have a request waiting for Admin. You can ask again after it is decided.</p> : (
              <div className="space-y-4 p-5">
                <ErrorBanner message={err} />
                <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                  <Field label="Amount (PKR) *"><Input type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                  <Field label="Reason *"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Child school fee" /></Field>
                </div>
                <div className="flex justify-end"><Button busy={busy} icon={<HandCoins size={16} />} onClick={submit}>Send to Admin</Button></div>
              </div>)}
          </Card>
          <ErrorBanner message={error} />
          <Card title="My requests">
            {loading && !data ? <Loading /> : !data?.length ? <Empty title="No advance requests yet" /> : (
              <ul className="divide-y">
                {data.map((a) => (
                  <li key={a.id} className="space-y-1 px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">{pkr(a.amount)} <span className="font-normal text-slate-500">· {a.request_number} · {fmtDate(a.created_at)}</span></span>
                      <Pill tone={TONE[a.status]}>{LABEL[a.status]}</Pill>
                    </div>
                    <p className="text-sm text-slate-600">{a.reason}</p>
                    {a.approved_amount && a.approved_amount !== a.amount && <p className="text-sm text-amber-800">Approved amount: <b>{pkr(a.approved_amount)}</b></p>}
                    {a.decision_comment && <p className="text-xs text-slate-500">“{a.decision_comment}” — {a.decided_by}</p>}
                    {a.status === "PAID" && <p className="text-xs text-emerald-700">Paid {fmtDateTime(a.paid_at)} by {humanize(a.payment_method)}</p>}
                    {a.status === "PENDING" && <Button variant="ghost" onClick={() => window.confirm("Cancel this request?") && api.post(`/advances/${a.id}/cancel`, {}).then(reload)}>Cancel request</Button>}
                  </li>))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function AdvanceActions({ a, onDone }: { a: Advance; onDone: () => void }) {
  const [mode, setMode] = useState<"decide" | "pay" | null>(a.status === "PENDING" ? "decide" : a.status === "APPROVED" ? "pay" : null);
  const [amount, setAmount] = useState(Number(a.approved_amount ?? a.amount).toString());
  const [comment, setComment] = useState("");
  const [method, setMethod] = useState("CASH");
  const [ref, setRef] = useState("");
  const { busy, error, run } = useSubmit();
  if (!mode) return null;
  if (mode === "decide") return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <ErrorBanner message={error} />
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Approved amount" />
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment" />
        <div className="flex gap-2">
          <Button busy={busy} icon={<Check size={15} />} onClick={() => run(async () => { await api.post(`/advances/${a.id}/decision`, { decision: "APPROVE", approved_amount: Number(amount), comment: comment || null }); onDone(); })}>Approve</Button>
          <Button variant="danger" busy={busy} icon={<X size={15} />} onClick={() => run(async () => { await api.post(`/advances/${a.id}/decision`, { decision: "REJECT", comment: comment || null }); onDone(); })}>Reject</Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">You can approve a smaller amount than requested.</p>
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg bg-emerald-50 p-3">
      <ErrorBanner message={error} />
      <p className="text-sm text-emerald-900">Approved {pkr(a.approved_amount)}. Mark it as paid when the money is handed over:</p>
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
        <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</Select>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference (optional)" aria-label="Reference" />
        <Button busy={busy} icon={<Banknote size={15} />} onClick={() => run(async () => { await api.post(`/advances/${a.id}/paid`, { payment_method: method, payment_reference: ref || null }); onDone(); })}>Mark paid</Button>
      </div>
    </div>
  );
}

export function AdvanceApprovalsPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useData(() => api.get<{ summary: { pending: number; to_pay: number; paid_this_month: string }; requests: Advance[] }>(`/advances${status ? `?status=${status}` : ""}`), [status], { live: ["advances"] });
  const s = data?.summary;
  return (
    <Page title="Advance requests" subtitle="Approve or reject staff advance requests, then mark them paid.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Waiting for decision" value={s?.pending ?? "—"} tone="amber" />
        <Stat label="Approved, to be paid" value={s?.to_pay ?? "—"} />
        <Stat label="Paid this month" value={s ? pkr(s.paid_this_month) : "—"} tone="emerald" />
      </div>
      <Card title="Requests" actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Status">
        <option value="">Open first (all)</option><option value="PENDING">Waiting</option><option value="APPROVED">Approved</option><option value="PAID">Paid</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option>
      </Select>}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.requests.length ? <Empty title="No advance requests" /> : (
          <ul className="divide-y">
            {data.requests.map((a) => (
              <li key={a.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b className="text-slate-800">{a.employee.name}</b> <span className="text-sm text-slate-500">{a.employee.designation} · {a.request_number}</span></span>
                  <Pill tone={TONE[a.status]}>{LABEL[a.status]}</Pill>
                </div>
                <p className="text-sm text-slate-700">Asked for <b>{pkr(a.amount)}</b> on {fmtDate(a.created_at)}: “{a.reason}”</p>
                {a.decided_by && <p className="text-xs text-slate-500">{LABEL[a.status === "PAID" ? "APPROVED" : a.status]} by {a.decided_by}{a.approved_amount && ` · ${pkr(a.approved_amount)}`}{a.decision_comment && ` · “${a.decision_comment}”`}</p>}
                {a.status === "PAID" && <p className="text-xs text-emerald-700">Paid {fmtDateTime(a.paid_at)} by {humanize(a.payment_method)}{a.payment_reference && ` (${a.payment_reference})`}</p>}
                <AdvanceActions key={`${a.id}-${a.status}`} a={a} onDone={reload} />
              </li>))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
