"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, humanize, pkr, todayIso } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Num, Page, Select, Stat, Table, Td, useCan, useData, useSubmit } from "@/components/ui";

type Summary = {
  period: { from: string; to: string };
  cash: { in: string; out: string; net: string; in_breakdown: Record<string, string>; out_breakdown: Record<string, string>;
    in_by_method: Record<string, string>; out_by_method: Record<string, string> };
  profit_loss: { store_sales: string; other_patient_charges: string; revenue: string; cost_of_medicines_sold: string; gross_profit: string;
    expenses_by_category: Record<string, string>; expenses: string; staff_advances: string; net_profit: string };
  outstanding_dues: string;
  daily: { date: string; in: string; out: string }[];
};
type Expense = { id: string; expense_number: string; expense_date: string; category: string; description: string; amount: string;
  payment_method: string; paid_to: string | null; reference: string | null; recorded_by: string | null };

// Chart series colours: validated categorical pair (blue / orange), not status green/red.
const IN_COLOR = "#2a78d6";
const OUT_COLOR = "#eb6834";
const CATS = ["SALARIES", "UTILITIES", "RENT", "MAINTENANCE", "SUPPLIES", "EQUIPMENT", "TRANSPORT", "OTHER"];
const LABEL: Record<string, string> = { patient_payments: "Patient payments (counter + store patients)", walk_in_store_sales: "Walk-in medical store sales",
  expenses: "Expenses", staff_advances: "Staff advances paid", medicine_purchases: "Medicine purchases (suppliers)", SUPPLIER: "Supplier purchases" };

function monthRange(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}
const n = (v: string | number) => Number(v || 0);

/** Paired daily bars: money in (blue) vs money out (orange). Hover shows the day's numbers. */
function DailyChart({ daily }: { daily: Summary["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.flatMap((d) => [n(d.in), n(d.out)]));
  const H = 160;
  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: IN_COLOR }} />Money in</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: OUT_COLOR }} />Money out</span>
        <span className="ml-auto text-xs text-slate-500">{h ? <>{fmtDate(h.date)}: <b className="text-slate-800">in {pkr(h.in)}</b> · <b className="text-slate-800">out {pkr(h.out)}</b></> : "Point at a day to see its numbers"}</span>
      </div>
      <div className="relative" style={{ height: H + 22 }} role="img" aria-label="Daily money in and money out for the period. Exact figures are in the tables below.">
        <div className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ top: 0 }} />
        <div className="absolute inset-x-0 border-t border-slate-300" style={{ top: H }} />
        <div className="absolute inset-0 flex items-end" style={{ height: H }}>
          {daily.map((d, i) => (
            <div key={d.date} className={`flex h-full flex-1 items-end justify-center gap-[2px] px-[1px] ${hover === i ? "bg-slate-100" : ""}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)}>
              <span className="w-full max-w-2 rounded-t-[4px]" style={{ height: `${(n(d.in) / max) * 100}%`, background: IN_COLOR, minHeight: n(d.in) ? 2 : 0 }} />
              <span className="w-full max-w-2 rounded-t-[4px]" style={{ height: `${(n(d.out) / max) * 100}%`, background: OUT_COLOR, minHeight: n(d.out) ? 2 : 0 }} />
            </div>))}
        </div>
        <div className="absolute inset-x-0 flex justify-between text-[11px] text-slate-500" style={{ top: H + 4 }}>
          <span>{fmtDate(daily[0]?.date)}</span><span>{fmtDate(daily[daily.length - 1]?.date)}</span>
        </div>
        <span className="absolute right-0 -translate-y-full text-[11px] text-slate-400" style={{ top: 0 }}>{pkr(max)}</span>
      </div>
    </div>
  );
}

function Line({ label, value, strong, minus, tone = "" }: { label: string; value: string; strong?: boolean; minus?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "border-t font-semibold" : ""}`}>
      <dt className={strong ? "text-slate-800" : "text-slate-600"}>{label}</dt>
      <dd className={`tabular-nums ${tone}`}>{minus ? `− ${pkr(value)}` : pkr(value)}</dd>
    </div>
  );
}

function AddExpense({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ expense_date: todayIso(), category: "UTILITIES", description: "", amount: "", payment_method: "CASH", paid_to: "", reference: "" });
  const { busy, error, run } = useSubmit();
  const on = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => run(async () => {
    if (!(Number(f.amount) > 0)) throw new Error("Enter the amount.");
    if (f.description.trim().length < 2) throw new Error("Describe the expense.");
    await api.post("/finance/expenses", { ...f, amount: Number(f.amount), paid_to: f.paid_to || null, reference: f.reference || null }); onDone();
  });
  return (
    <Modal open onClose={onClose} title="Record expense"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Save expense</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" max={todayIso()} value={f.expense_date} onChange={on("expense_date")} /></Field>
          <Field label="Category"><Select value={f.category} onChange={on("category")}>{CATS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
          <Field label="Amount (PKR) *"><Input type="number" min={1} value={f.amount} onChange={on("amount")} autoFocus /></Field>
          <Field label="Paid by"><Select value={f.payment_method} onChange={on("payment_method")}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</Select></Field>
        </div>
        <Field label="Description *"><Input value={f.description} onChange={on("description")} placeholder="e.g. Electricity bill November" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid to"><Input value={f.paid_to} onChange={on("paid_to")} placeholder="e.g. LESCO" /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={on("reference")} placeholder="Bill / receipt no." /></Field>
        </div>
      </div>
    </Modal>
  );
}

export function FinancePage() {
  const can = useCan();
  const canEdit = can("finance.expenses.manage");
  const [tab, setTab] = useState<"overview" | "expenses">("overview");
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const range = useMemo(() => monthRange(month), [month]);
  const qs = `from=${range.from}&to=${range.to}`;
  const sum = useData(() => api.get<Summary>(`/finance/summary?${qs}`), [qs], { live: ["finance", "sales", "billing", "advances", "purchases"] });
  const exp = useData(() => api.get<Expense[]>(`/finance/expenses?${qs}`), [qs], { live: ["finance"] });
  const [adding, setAdding] = useState(false);
  const del = useSubmit();
  const s = sum.data;
  const net = s ? n(s.profit_loss.net_profit) : 0;

  return (
    <Page title="Cash & profit/loss" subtitle={canEdit ? "Money in and out, and whether the hospital made a profit." : "View only. Expenses are recorded by Admin."}
      actions={<div className="flex items-center gap-2">
        <Input type="month" value={month} max={todayIso().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Month" />
        {canEdit && <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Record expense</Button>}
      </div>}>
      <div className="flex gap-2" role="tablist">
        {([["overview", "Overview"], ["expenses", "Expenses"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
      </div>
      <ErrorBanner message={sum.error ?? exp.error ?? del.error} />
      {tab === "overview" ? (sum.loading && !s ? <Loading /> : s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Money in" value={pkr(s.cash.in)} />
            <Stat label="Money out" value={pkr(s.cash.out)} />
            <Stat label={net >= 0 ? "Net profit" : "Net loss"} value={pkr(Math.abs(net))} tone={net >= 0 ? "emerald" : "rose"} />
            <Stat label="Patients still owe (all time)" value={pkr(s.outstanding_dues)} tone="amber" />
          </div>
          <Card title={`Daily money in and out · ${fmtDate(s.period.from)} – ${fmtDate(s.period.to)}`}>
            <div className="p-5"><DailyChart daily={s.daily} /></div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Profit & loss">
              <dl className="p-5 text-sm">
                <Line label="Medical store sales" value={s.profit_loss.store_sales} />
                <Line label="Other patient charges" value={s.profit_loss.other_patient_charges} />
                <Line label="Revenue" value={s.profit_loss.revenue} strong />
                <Line label="Cost of medicines sold" value={s.profit_loss.cost_of_medicines_sold} minus />
                <Line label="Gross profit" value={s.profit_loss.gross_profit} strong />
                {CATS.filter((c) => n(s.profit_loss.expenses_by_category[c])).map((c) => <Line key={c} label={`${humanize(c)} expenses`} value={s.profit_loss.expenses_by_category[c]} minus />)}
                <Line label="Staff advances paid" value={s.profit_loss.staff_advances} minus />
                <div className={`mt-1 flex justify-between gap-4 border-t-2 pt-2 text-base font-bold ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  <dt>{net >= 0 ? "Net profit" : "Net loss"}</dt><dd className="tabular-nums">{pkr(Math.abs(net))}</dd>
                </div>
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
                <div className="mt-1 flex justify-between border-t-2 pt-2 text-base font-bold text-slate-800"><dt>Net cash</dt><dd className="tabular-nums">{pkr(s.cash.net)}</dd></div>
              </dl>
            </Card>
          </div>
          <Card title="By payment method">
            <Table head={["Method", "Money in", "Money out"]}>
              {[...new Set([...Object.keys(s.cash.in_by_method), ...Object.keys(s.cash.out_by_method)])].map((mth) => (
                <tr key={mth}><Td>{LABEL[mth] ?? humanize(mth)}</Td><Num>{pkr(s.cash.in_by_method[mth] ?? 0)}</Num><Num>{pkr(s.cash.out_by_method[mth] ?? 0)}</Num></tr>))}
            </Table>
          </Card>
        </>
      )) : (
        <Card title={exp.data ? `${exp.data.length} expenses · ${pkr(exp.data.reduce((t, e) => t + n(e.amount), 0))}` : "Expenses"}>
          {exp.loading && !exp.data ? <Loading /> : !exp.data?.length ? <Empty title="No expenses this month" action={canEdit && <Button icon={<Plus size={16} />} onClick={() => setAdding(true)}>Record expense</Button>} /> : (
            <Table head={["Date", "Category", "Description", "Paid to", "Method", "Amount", ""]}>
              {exp.data.map((e) => (
                <tr key={e.id}><Td>{fmtDate(e.expense_date)}</Td><Td>{humanize(e.category)}</Td>
                  <Td className="whitespace-normal">{e.description}<span className="block text-xs text-slate-500">{e.expense_number}{e.reference && ` · ${e.reference}`}</span></Td>
                  <Td>{e.paid_to ?? "—"}</Td><Td>{humanize(e.payment_method)}</Td><Num className="font-semibold">{pkr(e.amount)}</Num>
                  <Td className="text-right">{canEdit && <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${e.description}`}
                    onClick={() => window.confirm(`Delete this expense (${pkr(e.amount)})?`) && del.run(async () => { await api.del(`/finance/expenses/${e.id}`); exp.reload(); sum.reload(); })}><Trash2 size={15} /></button>}</Td>
                </tr>))}
            </Table>
          )}
        </Card>
      )}
      {adding && <AddExpense onClose={() => setAdding(false)} onDone={() => { setAdding(false); exp.reload(); sum.reload(); }} />}
    </Page>
  );
}
