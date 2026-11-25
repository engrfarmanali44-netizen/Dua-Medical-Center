"use client";
import { useMemo, useState } from "react";
import { Download, Plus, Printer, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { addDaysIso, fmtDate, fmtDateTime, humanize, pkr, todayIso } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Num, Page, Pill, SearchInput, Select, Table, Td, useCan, useData, useDebounced, useSubmit } from "@/components/ui";

/* ---------------------------------------------------------------- types */
type Cash = { in: string; out: string; net: string; in_breakdown: Record<string, string>; out_breakdown: Record<string, string>;
  in_by_method: Record<string, string>; out_by_method: Record<string, string> };
type PL = { store_sales: string; other_patient_charges: string; other_income: string; income_by_category: Record<string, string>; capital_added: string;
  revenue: string; cost_of_medicines_sold: string; gross_profit: string; expenses_by_category: Record<string, string>; expenses: string;
  staff_advances: string; net_profit: string };
type Summary = { period: { from: string; to: string }; cash: Cash; profit_loss: PL; outstanding_dues?: string; daily?: { date: string; in: string; out: string }[] };
type Balance = { total: string; by_method: { method: string; amount: string }[]; as_of: string };
type Tx = { at: string; direction: "IN" | "OUT"; kind: string; number: string; party: string | null; description: string | null; method: string; amount: string; balance: string };
type TxData = { opening_balance: string; total_in: string; total_out: string; closing_balance: string; rows: Tx[] };
type Expense = { id: string; expense_number: string; expense_date: string; category: string; description: string; amount: string;
  payment_method: string; paid_to: string | null; reference: string | null; recorded_by: string | null };
type Income = { id: string; income_number: string; income_date: string; category: string; description: string; amount: string;
  payment_method: string; received_from: string | null; reference: string | null; recorded_by: string | null; is_revenue: boolean };

/* ---------------------------------------------------------------- constants */
// Chart series colours: validated categorical pair (blue / orange), not status green/red.
const IN_COLOR = "#2a78d6";
const OUT_COLOR = "#eb6834";
const LIVE = ["finance", "sales", "billing", "advances", "purchases"] as const;
const EXP_CATS = ["SALARIES", "UTILITIES", "RENT", "MAINTENANCE", "SUPPLIES", "EQUIPMENT", "TRANSPORT", "OTHER"];
const INC_CATS = ["CONSULTATION", "LAB", "PROCEDURE", "DONATION", "RENT_RECEIVED", "CAPITAL", "OPENING_BALANCE", "OTHER"];
const INC_LABEL: Record<string, string> = { CONSULTATION: "Consultation fees", LAB: "Lab fees", PROCEDURE: "Procedures", DONATION: "Donation",
  RENT_RECEIVED: "Rent received", CAPITAL: "Capital added by owner", OPENING_BALANCE: "Opening cash balance", OTHER: "Other income" };
const LABEL: Record<string, string> = { patient_payments: "Patient payments (counter + store patients)", walk_in_store_sales: "Walk-in medical store sales",
  other_income: "Other income (fees, donations, capital)", expenses: "Expenses", staff_advances: "Staff advances paid",
  medicine_purchases: "Medicine purchases (suppliers)", SUPPLIER: "Supplier purchases (method not recorded)" };
const TX_MAX_DAYS = 92;

const n = (v: string | number | undefined) => Number(v || 0);
const methodLabel = (m: string) => LABEL[m] ?? humanize(m);
function kindLabel(k: string) {
  if (k.startsWith("INCOME_")) return INC_LABEL[k.slice(7)] ?? humanize(k.slice(7));
  if (k.startsWith("EXPENSE_")) return `Expense · ${humanize(k.slice(8))}`;
  return ({ PATIENT_PAYMENT: "Patient payment", STORE_SALE: "Walk-in store sale", STAFF_ADVANCE: "Staff advance", MEDICINE_PURCHASE: "Medicine purchase" } as Record<string, string>)[k] ?? humanize(k);
}

/* ---------------------------------------------------------------- periods */
type Preset = "today" | "month" | "last" | "year" | "custom";
type Range = { from: string; to: string };
const pad = (x: number) => String(x).padStart(2, "0");
function monthRange(y: number, m: number): Range { // m is 1-12 (0 = December of the year before)
  if (m < 1) { y -= 1; m += 12; }
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
}
const days = (r: Range) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
function presetRange(p: Preset, custom: Range): Range {
  const t = todayIso(); const [y, m] = t.split("-").map(Number);
  if (p === "today") return { from: t, to: t };
  if (p === "month") return monthRange(y, m);
  if (p === "last") return monthRange(y, m - 1);
  if (p === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return custom;
}
/** The period just before, of the same kind (previous month for months, otherwise the same number of days). */
function previousRange(p: Preset, r: Range): Range {
  if (p === "month" || p === "last") { const [y, m] = r.from.split("-").map(Number); return monthRange(y, m - 1); }
  if (p === "year") { const y = Number(r.from.slice(0, 4)) - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
  const len = Math.max(1, days(r));
  return { from: addDaysIso(-len, r.from), to: addDaysIso(-1, r.from) };
}
const rangeText = (r: Range) => (r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} – ${fmtDate(r.to)}`);

/* ---------------------------------------------------------------- CSV */
function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- small pieces */
function Delta({ now, prev }: { now: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  const diff = Math.round((now - prev) * 100) / 100;
  if (diff === 0) return <p className="mt-1 text-xs text-slate-500">Same as previous period</p>;
  const pct = prev !== 0 ? Math.round((diff / Math.abs(prev)) * 100) : null;
  return <p className="mt-1 text-xs text-slate-500">{diff > 0 ? "▲" : "▼"} {pct !== null ? `${Math.abs(pct)}%` : pkr(Math.abs(diff))} {diff > 0 ? "more" : "less"} than previous period</p>;
}

function Tile({ label, value, tone = "slate", children }: { label: string; value: string; tone?: "slate" | "rose" | "emerald" | "amber"; children?: React.ReactNode }) {
  const tones = { slate: "text-slate-900", rose: "text-rose-700", emerald: "text-emerald-700", amber: "text-amber-700" };
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {children}
    </div>
  );
}

function Line({ label, value, strong, minus, note }: { label: string; value: string; strong?: boolean; minus?: boolean; note?: string }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "border-t font-semibold" : ""}`}>
      <dt className={strong ? "text-slate-800" : "text-slate-600"}>{label}{note && <span className="block text-xs font-normal text-slate-400">{note}</span>}</dt>
      <dd className="tabular-nums">{minus ? `− ${pkr(value)}` : pkr(value)}</dd>
    </div>
  );
}

/** Paired bars: money in (blue) vs money out (orange), per day, or per month for long periods. */
function MoneyChart({ daily }: { daily: NonNullable<Summary["daily"]> }) {
  const [hover, setHover] = useState<number | null>(null);
  const monthly = daily.length > 62;
  const points = useMemo(() => {
    if (!monthly) return daily.map((d) => ({ key: d.date, label: fmtDate(d.date), in: n(d.in), out: n(d.out) }));
    const m = new Map<string, { key: string; label: string; in: number; out: number }>();
    for (const d of daily) {
      const k = d.date.slice(0, 7);
      const p = m.get(k) ?? { key: k, label: new Date(`${k}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }), in: 0, out: 0 };
      p.in += n(d.in); p.out += n(d.out); m.set(k, p);
    }
    return [...m.values()];
  }, [daily, monthly]);
  const max = Math.max(1, ...points.flatMap((p) => [p.in, p.out]));
  const H = 160;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: IN_COLOR }} />Money in</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: OUT_COLOR }} />Money out</span>
        <span className="ml-auto text-xs text-slate-500 print:hidden">{h ? <>{h.label}: <b className="text-slate-800">in {pkr(h.in)}</b> · <b className="text-slate-800">out {pkr(h.out)}</b></> : `Point at a ${monthly ? "month" : "day"} to see its numbers`}</span>
      </div>
      <div className="relative" style={{ height: H + 22 }} role="img" aria-label="Money in and money out for the period. Exact figures are in the tables below.">
        <div className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ top: 0 }} />
        <div className="absolute inset-x-0 border-t border-slate-300" style={{ top: H }} />
        <div className="absolute inset-0 flex items-end" style={{ height: H }}>
          {points.map((p, i) => (
            <div key={p.key} className={`flex h-full flex-1 items-end justify-center gap-[2px] px-[1px] ${hover === i ? "bg-slate-100" : ""}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
              <span className="w-full max-w-3 rounded-t-[4px]" style={{ height: `${(p.in / max) * 100}%`, background: IN_COLOR, minHeight: p.in ? 2 : 0 }} />
              <span className="w-full max-w-3 rounded-t-[4px]" style={{ height: `${(p.out / max) * 100}%`, background: OUT_COLOR, minHeight: p.out ? 2 : 0 }} />
            </div>))}
        </div>
        <div className="absolute inset-x-0 flex justify-between text-[11px] text-slate-500" style={{ top: H + 4 }}>
          <span>{points[0]?.label}</span><span>{points[points.length - 1]?.label}</span>
        </div>
        <span className="absolute right-0 -translate-y-full text-[11px] text-slate-400" style={{ top: 0 }}>{pkr(max)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- record modal */
function EntryModal({ kind, onClose, onDone }: { kind: "expense" | "income"; onClose: () => void; onDone: () => void }) {
  const isExp = kind === "expense";
  const [f, setF] = useState({ date: todayIso(), category: isExp ? "UTILITIES" : "CONSULTATION", description: "", amount: "", payment_method: "CASH", party: "", reference: "" });
  const { busy, error, run } = useSubmit();
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => run(async () => {
    if (!(Number(f.amount) > 0)) throw new Error("Enter the amount.");
    if (f.description.trim().length < 2) throw new Error(isExp ? "Describe the expense." : "Describe the income.");
    const common = { category: f.category, description: f.description, amount: Number(f.amount), payment_method: f.payment_method, reference: f.reference || null };
    if (isExp) await api.post("/finance/expenses", { ...common, expense_date: f.date, paid_to: f.party || null });
    else await api.post("/finance/income", { ...common, income_date: f.date, received_from: f.party || null });
    onDone();
  });
  const notRevenue = !isExp && (f.category === "CAPITAL" || f.category === "OPENING_BALANCE");
  return (
    <Modal open onClose={onClose} title={isExp ? "Record expense" : "Record other income"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" max={todayIso()} value={f.date} onChange={on("date")} /></Field>
          <Field label="Category"><Select value={f.category} onChange={on("category")}>
            {(isExp ? EXP_CATS : INC_CATS).map((c) => <option key={c} value={c}>{isExp ? humanize(c) : INC_LABEL[c]}</option>)}</Select></Field>
          <Field label="Amount (PKR) *"><Input type="number" min={1} value={f.amount} onChange={on("amount")} autoFocus /></Field>
          <Field label={isExp ? "Paid by" : "Received by"}><Select value={f.payment_method} onChange={on("payment_method")}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</Select></Field>
        </div>
        {notRevenue && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">This adds to cash in hand, but it is not counted as profit (it is money put in, not earned).</p>}
        <Field label="Description *"><Input value={f.description} onChange={on("description")} placeholder={isExp ? "e.g. Electricity bill November" : "e.g. OPD fees Friday, camp donation"} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isExp ? "Paid to" : "Received from"}><Input value={f.party} onChange={on("party")} placeholder={isExp ? "e.g. LESCO" : "Person or company"} /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={on("reference")} placeholder="Bill / receipt no." /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- overview */
function Overview({ s, prev, bal }: { s: Summary; prev: Summary | undefined; bal: Balance | undefined }) {
  const pl = s.profit_loss;
  const net = n(pl.net_profit);
  const pp = prev?.profit_loss;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Money in" value={pkr(s.cash.in)}><Delta now={n(s.cash.in)} prev={prev && n(prev.cash.in)} /></Tile>
        <Tile label="Money out" value={pkr(s.cash.out)}><Delta now={n(s.cash.out)} prev={prev && n(prev.cash.out)} /></Tile>
        <Tile label={net >= 0 ? "Net profit" : "Net loss"} value={pkr(Math.abs(net))} tone={net >= 0 ? "emerald" : "rose"}><Delta now={net} prev={pp && n(pp.net_profit)} /></Tile>
        <Tile label="Cash in hand now" value={bal ? pkr(bal.total) : "—"}><p className="mt-1 text-xs text-slate-500">All money in minus all money out</p></Tile>
        <Tile label="Patients still owe" value={pkr(s.outstanding_dues ?? 0)} tone="amber"><p className="mt-1 text-xs text-slate-500">All unpaid bills, today</p></Tile>
      </div>
      <Card title={`Money in and out · ${rangeText(s.period)}`}>
        <div className="p-5">{s.daily && <MoneyChart daily={s.daily} />}</div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profit & loss">
          <dl className="p-5 text-sm">
            <Line label="Medical store sales" value={pl.store_sales} />
            <Line label="Other patient charges" value={pl.other_patient_charges} note="Bills made at the counter (not store sales)" />
            {INC_CATS.filter((c) => n(pl.income_by_category[c])).map((c) => <Line key={c} label={INC_LABEL[c]} value={pl.income_by_category[c]} />)}
            <Line label="Revenue" value={pl.revenue} strong />
            <Line label="Cost of medicines sold" value={pl.cost_of_medicines_sold} minus note="What the sold medicines cost to buy" />
            <Line label="Gross profit" value={pl.gross_profit} strong />
            {EXP_CATS.filter((c) => n(pl.expenses_by_category[c])).map((c) => <Line key={c} label={`${humanize(c)} expenses`} value={pl.expenses_by_category[c]} minus />)}
            <Line label="Staff advances paid" value={pl.staff_advances} minus />
            <div className={`mt-1 flex justify-between gap-4 border-t-2 pt-2 text-base font-bold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              <dt>{net >= 0 ? "Net profit" : "Net loss"}</dt><dd className="tabular-nums">{pkr(Math.abs(net))}</dd>
            </div>
            {n(pl.capital_added) > 0 && <p className="mt-3 text-xs text-slate-500">Capital / opening cash of {pkr(pl.capital_added)} was added in this period. It is in the cash book, not in profit.</p>}
          </dl>
        </Card>
        <Card title="Cash book">
          <dl className="p-5 text-sm">
            <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Money in</p>
            {Object.entries(s.cash.in_breakdown).map(([k, v]) => <Line key={k} label={LABEL[k] ?? humanize(k)} value={v} />)}
            <Line label="Total in" value={s.cash.in} strong />
            <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Money out</p>
            {Object.entries(s.cash.out_breakdown).map(([k, v]) => <Line key={k} label={LABEL[k] ?? humanize(k)} value={v} />)}
            <Line label="Total out" value={s.cash.out} strong />
            <div className="mt-1 flex justify-between border-t-2 pt-2 text-base font-bold text-slate-800"><dt>Net cash this period</dt><dd className="tabular-nums">{pkr(s.cash.net)}</dd></div>
          </dl>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="This period by payment method">
          <Table head={["Method", "Money in", "Money out"]}>
            {[...new Set([...Object.keys(s.cash.in_by_method), ...Object.keys(s.cash.out_by_method)])].map((m) => (
              <tr key={m}><Td>{methodLabel(m)}</Td><Num>{pkr(s.cash.in_by_method[m] ?? 0)}</Num><Num>{pkr(s.cash.out_by_method[m] ?? 0)}</Num></tr>))}
          </Table>
        </Card>
        <Card title="Cash in hand now, by method">
          {!bal ? <Loading /> : !bal.by_method.length ? <Empty title="No money recorded yet" /> : (
            <Table head={["Where the money is", "Balance"]}>
              {bal.by_method.map((b) => <tr key={b.method}><Td>{methodLabel(b.method)}</Td><Num className={n(b.amount) < 0 ? "text-rose-700" : ""}>{pkr(b.amount)}</Num></tr>)}
              <tr className="font-semibold"><Td>Total</Td><Num>{pkr(bal.total)}</Num></tr>
            </Table>
          )}
          <p className="px-5 pb-4 pt-2 text-xs text-slate-500">Supplier purchases don&apos;t record how they were paid, so they show on their own line. To start from your real cash, record an &ldquo;Opening cash balance&rdquo; under Other income.</p>
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- transactions (day book) */
function Transactions({ range }: { range: Range }) {
  const tooLong = days(range) > TX_MAX_DAYS;
  const { data, error, loading } = useData(() => (tooLong ? Promise.resolve(null) : api.get<TxData>(`/finance/transactions?from=${range.from}&to=${range.to}`)),
    [range.from, range.to, tooLong], { live: [...LIVE] });
  const [dir, setDir] = useState<"" | "IN" | "OUT">("");
  const [method, setMethod] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q).toLowerCase();
  const [show, setShow] = useState(300);
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (!dir || r.direction === dir) && (!method || r.method === method)
    && (!dq || [r.number, r.party, r.description, kindLabel(r.kind)].some((x) => x?.toLowerCase().includes(dq)))), [data, dir, method, dq]);
  const methods = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.method))], [data]);
  if (tooLong) return <Card title="Transactions"><Empty title="Choose a shorter period" hint="The transactions list shows up to 3 months at a time. Pick a month or a custom range." /></Card>;
  const filtered = !!(dir || method || dq);
  const fIn = rows.reduce((t, r) => t + (r.direction === "IN" ? n(r.amount) : 0), 0);
  const fOut = rows.reduce((t, r) => t + (r.direction === "OUT" ? n(r.amount) : 0), 0);
  const csv = () => downloadCsv(`transactions_${range.from}_${range.to}.csv`, [
    ["Date & time", "Number", "Type", "From / to", "Description", "Method", "Money in", "Money out", ...(filtered ? [] : ["Balance"])],
    ...(filtered ? [] : [["", "", "Opening balance", "", "", "", "", "", data?.opening_balance ?? ""]]),
    ...rows.map((r) => [fmtDateTime(r.at), r.number, kindLabel(r.kind), r.party, r.description, methodLabel(r.method),
      r.direction === "IN" ? r.amount : "", r.direction === "OUT" ? r.amount : "", ...(filtered ? [] : [r.balance])]),
    ["", "", "Total", "", "", "", fIn.toFixed(2), fOut.toFixed(2), ...(filtered ? [] : [data?.closing_balance ?? ""])],
  ]);
  return (
    <Card title={data ? `${rows.length} transactions · in ${pkr(fIn)} · out ${pkr(fOut)}` : "Transactions"}
      actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row print:hidden">
        <Select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} className="sm:w-36" aria-label="Direction"><option value="">In and out</option><option value="IN">Money in</option><option value="OUT">Money out</option></Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="sm:w-44" aria-label="Method"><option value="">All methods</option>{methods.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
        <SearchInput value={q} onChange={setQ} placeholder="Name, number, note" />
        <Button variant="secondary" icon={<Download size={16} />} onClick={csv} disabled={!rows.length}>CSV</Button>
      </div>}>
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !data?.rows.length ? <Empty title="No money in or out in this period" /> : (
        <>
          <Table head={["When", "Number", "Type", "From / to", "Method", "In", "Out", ...(filtered ? [] : ["Balance"])]}>
            {!filtered && <tr className="bg-slate-50 text-slate-600"><Td>{fmtDate(range.from)}</Td><Td /><Td className="font-semibold">Opening balance</Td><Td /><Td /><Td /><Td /><Num className="font-semibold">{pkr(data.opening_balance)}</Num></tr>}
            {rows.slice(0, show).map((r) => (
              <tr key={`${r.kind}-${r.number}`} className="hover:bg-slate-50">
                <Td>{fmtDateTime(r.at)}</Td><Td className="text-xs text-slate-500">{r.number}</Td><Td>{kindLabel(r.kind)}</Td>
                <Td className="whitespace-normal">{r.party ?? "—"}{r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</Td>
                <Td>{methodLabel(r.method)}</Td>
                <Num className="font-semibold text-slate-800">{r.direction === "IN" ? pkr(r.amount) : ""}</Num>
                <Num className="font-semibold text-slate-800">{r.direction === "OUT" ? pkr(r.amount) : ""}</Num>
                {!filtered && <Num className={n(r.balance) < 0 ? "text-rose-700" : "text-slate-600"}>{pkr(r.balance)}</Num>}
              </tr>))}
            {!filtered && rows.length <= show && <tr className="bg-slate-50 font-semibold"><Td>{fmtDate(range.to)}</Td><Td /><Td>Closing balance</Td><Td /><Td /><Num>{pkr(data.total_in)}</Num><Num>{pkr(data.total_out)}</Num><Num>{pkr(data.closing_balance)}</Num></tr>}
          </Table>
          {rows.length > show && <div className="border-t p-3 text-center print:hidden"><Button variant="secondary" onClick={() => setShow((x) => x + 300)}>Show more ({rows.length - show} left)</Button></div>}
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- expenses / other income lists */
function Entries({ kind, range, canEdit, onAdd }: { kind: "expense" | "income"; range: Range; canEdit: boolean; onAdd: () => void }) {
  const isExp = kind === "expense";
  const { data, error, loading, reload } = useData(() => api.get<(Expense | Income)[]>(`/finance/${isExp ? "expenses" : "income"}?from=${range.from}&to=${range.to}`),
    [range.from, range.to, kind], { live: ["finance"] });
  const del = useSubmit();
  const [cat, setCat] = useState("");
  const rows = (data ?? []).filter((e) => !cat || e.category === cat);
  const total = rows.reduce((t, e) => t + n(e.amount), 0);
  const date = (e: Expense | Income) => ("expense_date" in e ? e.expense_date : e.income_date);
  const party = (e: Expense | Income) => ("paid_to" in e ? e.paid_to : e.received_from);
  const num = (e: Expense | Income) => ("expense_number" in e ? e.expense_number : e.income_number);
  const catLabel = (c: string) => (isExp ? humanize(c) : INC_LABEL[c] ?? humanize(c));
  const csv = () => downloadCsv(`${isExp ? "expenses" : "other_income"}_${range.from}_${range.to}.csv`, [
    ["Date", "Number", "Category", "Description", isExp ? "Paid to" : "Received from", "Method", "Reference", "Amount", "Recorded by"],
    ...rows.map((e) => [date(e), num(e), catLabel(e.category), e.description, party(e), humanize(e.payment_method), e.reference, e.amount, e.recorded_by]),
    ["", "", "", "Total", "", "", "", total.toFixed(2), ""]]);
  return (
    <Card title={data ? `${rows.length} ${isExp ? "expenses" : "income entries"} · ${pkr(total)}` : isExp ? "Expenses" : "Other income"}
      actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row print:hidden">
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-48" aria-label="Category"><option value="">All categories</option>
          {(isExp ? EXP_CATS : INC_CATS).map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</Select>
        <Button variant="secondary" icon={<Download size={16} />} onClick={csv} disabled={!rows.length}>CSV</Button>
      </div>}>
      <ErrorBanner message={error ?? del.error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <Empty title={isExp ? "No expenses in this period" : "No other income in this period"}
          hint={isExp ? undefined : "Consultation fees, lab fees, donations, rent received, or the owner adding cash."}
          action={canEdit && <Button icon={<Plus size={16} />} onClick={onAdd}>{isExp ? "Record expense" : "Record income"}</Button>} />
      ) : (
        <Table head={["Date", "Category", "Description", isExp ? "Paid to" : "From", "Method", "Amount", ""]}>
          {rows.map((e) => (
            <tr key={e.id}><Td>{fmtDate(date(e))}</Td>
              <Td>{catLabel(e.category)}{"is_revenue" in e && !e.is_revenue && <span className="ml-1"><Pill tone="slate">Not profit</Pill></span>}</Td>
              <Td className="whitespace-normal">{e.description}<span className="block text-xs text-slate-500">{num(e)}{e.reference && ` · ${e.reference}`}{e.recorded_by && ` · by ${e.recorded_by}`}</span></Td>
              <Td>{party(e) ?? "—"}</Td><Td>{humanize(e.payment_method)}</Td><Num className="font-semibold">{pkr(e.amount)}</Num>
              <Td className="text-right print:hidden">{canEdit && <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${e.description}`}
                onClick={() => window.confirm(`Delete "${e.description}" (${pkr(e.amount)})? This is kept in the audit log.`) && del.run(async () => { await api.del(`/finance/${isExp ? "expenses" : "income"}/${e.id}`); reload(); })}><Trash2 size={15} /></button>}</Td>
            </tr>))}
        </Table>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- page */
type Tab = "overview" | "transactions" | "expenses" | "income";
const TABS: [Tab, string][] = [["overview", "Overview"], ["transactions", "Transactions"], ["expenses", "Expenses"], ["income", "Other income"]];
const PRESETS: [Preset, string][] = [["today", "Today"], ["month", "This month"], ["last", "Last month"], ["year", "This year"], ["custom", "Custom"]];

export function FinancePage() {
  const can = useCan();
  const canEdit = can("finance.expenses.manage");
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<Range>(() => ({ from: addDaysIso(-6), to: todayIso() }));
  const range = useMemo(() => presetRange(preset, custom), [preset, custom]);
  const prevRange = useMemo(() => previousRange(preset, range), [preset, range]);
  const badRange = range.to < range.from;
  const qs = `from=${range.from}&to=${range.to}`;
  const sum = useData(() => (badRange ? Promise.resolve(null) : api.get<Summary>(`/finance/summary?${qs}`)), [qs, badRange], { live: [...LIVE] });
  const prev = useData(() => (badRange ? Promise.resolve(null) : api.get<Summary>(`/finance/summary?from=${prevRange.from}&to=${prevRange.to}&lite=true`)),
    [prevRange.from, prevRange.to, badRange], { live: [...LIVE] });
  const bal = useData(() => api.get<Balance>("/finance/balance"), [], { live: [...LIVE] });
  const [adding, setAdding] = useState<"expense" | "income" | null>(null);
  const [nonce, setNonce] = useState(0); // remount the entry list after adding

  return (
    <Page title="Cash & profit/loss" subtitle={canEdit ? "Money in and out, cash in hand, and whether the hospital made a profit." : "View only. Expenses and income are recorded by Admin."}
      actions={<div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()}>Print</Button>
        {canEdit && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setAdding("income")}>Record income</Button>}
        {canEdit && <Button icon={<Plus size={16} />} onClick={() => setAdding("expense")}>Record expense</Button>}
      </div>}>
      <div className="flex flex-col gap-3 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Section">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap overflow-hidden rounded-lg ring-1 ring-slate-200" role="group" aria-label="Period">
            {PRESETS.map(([k, l]) => (
              <button key={k} aria-pressed={preset === k} onClick={() => setPreset(k)}
                className={`border-l border-slate-200 px-3 py-2 text-sm first:border-l-0 ${preset === k ? "bg-slate-800 font-semibold text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>))}
          </div>
          {preset === "custom" && <>
            <Input type="date" value={custom.from} max={todayIso()} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} className="w-40" aria-label="From" />
            <span className="text-slate-400">to</span>
            <Input type="date" value={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} className="w-40" aria-label="To" />
          </>}
        </div>
      </div>
      {badRange && <ErrorBanner message="The end date is before the start date." />}
      <ErrorBanner message={sum.error ?? bal.error} />

      <div className="print-area space-y-6">
        <div className="hidden print:block">
          <h1 className="text-xl font-bold">Dua Medical · Cash & profit/loss</h1>
          <p className="text-sm text-slate-600">{TABS.find(([k]) => k === tab)?.[1]} · {rangeText(range)} · printed {fmtDateTime(new Date().toISOString())}</p>
        </div>
        <p className="text-sm text-slate-500 print:hidden">Showing <b className="text-slate-700">{rangeText(range)}</b>{tab === "overview" && <> · compared with {rangeText(prevRange)}</>}</p>
        {tab === "overview" && (sum.loading && !sum.data ? <Loading /> : sum.data && <Overview s={sum.data} prev={prev.data ?? undefined} bal={bal.data ?? undefined} />)}
        {tab === "transactions" && !badRange && <Transactions range={range} />}
        {(tab === "expenses" || tab === "income") && !badRange &&
          <Entries key={`${tab}-${nonce}`} kind={tab === "expenses" ? "expense" : "income"} range={range} canEdit={canEdit} onAdd={() => setAdding(tab === "expenses" ? "expense" : "income")} />}
      </div>

      {adding && <EntryModal kind={adding} onClose={() => setAdding(null)}
        onDone={() => { const k = adding; setAdding(null); setNonce((x) => x + 1); sum.reload(); prev.reload(); bal.reload(); setTab(k === "expense" ? "expenses" : "income"); }} />}
    </Page>
  );
}
