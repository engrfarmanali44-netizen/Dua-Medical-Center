"use client";
import { useMemo, useState } from "react";
import { Minus, Plus, Printer, ShoppingCart, Trash2, UserRound, Users } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize, pkr, qty, round2, todayIso } from "@/lib/format";
import { PAYMENT_METHODS, type Batch, type Medicine, type Patient, type Sale } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Num, Page, Pill, SearchInput, Select, Stat, StatusBadge, Table, Td, useCan, useData, useSubmit } from "@/components/ui";
import { PatientPicker, Row } from "@/components/billing/shared";

type CartLine = { medicine: Medicine; quantity: number };

/** Mirror of the server's FEFO pick so the cashier sees the real price before posting. */
function previewLine(batches: Batch[], medicineId: string, wanted: number) {
  let remaining = wanted, amount = 0;
  for (const b of batches.filter((x) => x.medicine_id === medicineId && !x.expired).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))) {
    if (remaining <= 0) break;
    const take = Math.min(Number(b.on_hand), remaining);
    amount += take * Number(b.selling_price);
    remaining -= take;
  }
  return { amount: round2(amount), short: remaining > 0 };
}

function Receipt({ sale }: { sale: Sale }) {
  return (
    <div className="print-area space-y-3 text-sm">
      <div className="text-center">
        <p className="text-base font-bold text-teal-800">Dua Medical Hospital — Pharmacy</p>
        <p className="text-slate-500">Receipt {sale.sale_number} · {fmtDateTime(sale.sold_at)}</p>
        <p className="text-slate-600">{sale.is_walk_in ? `Walk-in${sale.customer_name ? `: ${sale.customer_name}` : ""}` : `Patient: ${sale.customer_name}`}</p>
      </div>
      <Table head={["Item", "Batch / exp", "Qty", "Price", "Amount"]}>
        {sale.items?.map((i, n) => (
          <tr key={n}><Td>{i.medicine_name} {i.strength}</Td><Td className="text-xs text-slate-500">{i.batch_number} · {fmtDate(i.expiry_date)}</Td>
            <Num>{qty(i.quantity)}</Num><Num>{pkr(i.unit_price)}</Num><Num>{pkr(i.line_total)}</Num></tr>))}
      </Table>
      <dl className="ml-auto w-full max-w-xs space-y-1">
        <Row label="Subtotal" value={pkr(sale.subtotal)} />
        {Number(sale.discount_amount) > 0 && <Row label="Discount" value={`− ${pkr(sale.discount_amount)}`} />}
        <Row label="Total" value={pkr(sale.total_amount)} strong />
        <Row label={`Paid${sale.payment_method ? ` (${humanize(sale.payment_method)})` : ""}`} value={pkr(sale.paid_amount)} />
        {Number(sale.due_amount) > 0 && <Row label="Added to patient dues" value={pkr(sale.due_amount)} strong tone="text-rose-700" />}
      </dl>
      <p className="text-center text-xs text-slate-500">Served by {sale.sold_by}. Medicines once sold are returnable only as per pharmacy policy.</p>
    </div>
  );
}

export function SalesPage() {
  const can = useCan();
  const canSell = can("pharmacy.sales.create");
  const meds = useData(() => api.get<Medicine[]>("/pharmacy/medicines?in_stock_only=true"), [], { live: ["medicines", "stock"] });
  const batches = useData(() => api.get<Batch[]>("/pharmacy/stock/batches"), [], { live: ["stock"] });
  const [day, setDay] = useState(todayIso());
  const sales = useData(() => api.get<Sale[]>(`/pharmacy/sales?day=${day}`), [day], { live: ["sales"] });

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<"walkin" | "patient">("walkin");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState<string | null>(null);
  const [method, setMethod] = useState("CASH");
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const { busy, error, setError, run } = useSubmit();

  const lines = cart.map((l) => ({ ...l, ...previewLine(batches.data ?? [], l.medicine.id, l.quantity) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const disc = Math.min(Number(discount || 0), subtotal);
  const total = round2(subtotal - disc);
  const paidNum = mode === "walkin" ? total : Math.min(Number(paid ?? total), total);
  const due = round2(total - paidNum);
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (meds.data ?? []).filter((m) => `${m.generic_name} ${m.brand_name ?? ""} ${m.medicine_code}`.toLowerCase().includes(q)).slice(0, 8);
  }, [search, meds.data]);

  const add = (m: Medicine) => {
    setCart((c) => c.some((l) => l.medicine.id === m.id) ? c.map((l) => l.medicine.id === m.id ? { ...l, quantity: l.quantity + 1 } : l) : [...c, { medicine: m, quantity: 1 }]);
    setSearch("");
  };
  const setQty = (id: string, q: number) => setCart((c) => c.map((l) => l.medicine.id === id ? { ...l, quantity: Math.max(0, q) } : l).filter((l) => l.quantity > 0));
  const reset = () => { setCart([]); setPatient(null); setCustomer(""); setDiscount(""); setPaid(null); setMethod("CASH"); setError(null); };

  const checkout = () => run(async () => {
    if (mode === "patient" && !patient) throw new Error("Select the patient, or switch to walk-in");
    const sale = await api.post<Sale>("/pharmacy/sales", {
      patient_id: mode === "patient" ? patient!.id : null, customer_name: mode === "walkin" ? customer || null : null,
      discount_amount: disc, paid_amount: paidNum, payment_method: paidNum > 0 ? method : null,
      items: cart.map((l) => ({ medicine_id: l.medicine.id, quantity: l.quantity })),
    });
    setReceipt(sale); reset(); meds.reload(); batches.reload(); setDay(todayIso()); sales.reload();
  });

  const daySales = sales.data ?? [];
  return (
    <Page title="Pharmacy sales" subtitle="Counter sales for walk-in customers and hospital patients.">
      {canSell && (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3" title={<span className="flex items-center gap-2"><ShoppingCart size={18} />Cart</span>}>
            <div className="space-y-4 p-5">
              <div className="relative">
                <SearchInput value={search} onChange={setSearch} placeholder="Search medicine to add (name, brand, code)" />
                {results.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg sm:max-w-md">
                    {results.map((m) => (
                      <li key={m.id}><button type="button" onClick={() => add(m)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50">
                        <span><span className="font-medium text-slate-800">{m.generic_name} {m.strength}</span>{m.brand_name && <span className="ml-1 text-xs text-slate-500">{m.brand_name}</span>}</span>
                        <span className="text-xs text-slate-500">{qty(m.on_hand)} {m.unit} in stock</span>
                      </button></li>))}
                  </ul>
                )}
                {search.trim() && !results.length && meds.data && <p className="mt-1 text-xs text-slate-500">No in-stock medicine matches.</p>}
              </div>
              {!cart.length ? <Empty title="Cart is empty" hint="Search above to add medicines." /> : (
                <Table head={["Medicine", "Qty", "Amount", ""]}>
                  {lines.map((l) => (
                    <tr key={l.medicine.id}>
                      <Td><span className="font-medium text-slate-800">{l.medicine.generic_name} {l.medicine.strength}</span>
                        <span className="block text-xs text-slate-500">{qty(l.medicine.on_hand)} {l.medicine.unit} available</span>
                        {l.short && <span className="block text-xs font-semibold text-rose-700">Not enough stock</span>}</Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <button className="rounded border p-1 hover:bg-slate-50" aria-label="Decrease" onClick={() => setQty(l.medicine.id, l.quantity - 1)}><Minus size={14} /></button>
                          <Input type="number" min="1" value={l.quantity} onChange={(e) => setQty(l.medicine.id, Number(e.target.value))} className="w-20 text-center" aria-label="Quantity" />
                          <button className="rounded border p-1 hover:bg-slate-50" aria-label="Increase" onClick={() => setQty(l.medicine.id, l.quantity + 1)}><Plus size={14} /></button>
                        </div>
                      </Td>
                      <Num className="font-semibold">{pkr(l.amount)}</Num>
                      <Td><button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove" onClick={() => setQty(l.medicine.id, 0)}><Trash2 size={16} /></button></Td>
                    </tr>))}
                </Table>
              )}
            </div>
          </Card>

          <Card className="h-fit lg:col-span-2" title="Checkout">
            <div className="space-y-4 p-5">
              <ErrorBanner message={error} onClose={() => setError(null)} />
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Customer type">
                {([["walkin", "Walk-in", Users], ["patient", "Hospital patient", UserRound]] as const).map(([v, label, Icon]) => (
                  <button key={v} role="radio" aria-checked={mode === v} onClick={() => { setMode(v); setPaid(null); }}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${mode === v ? "border-teal-600 bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-50"}`}>
                    <Icon size={16} />{label}</button>))}
              </div>
              {mode === "walkin"
                ? <Field label="Customer name (optional)"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></Field>
                : <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} /></Field>}
              <dl className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm"><Row label="Subtotal" value={pkr(subtotal)} /><Row label="Discount" value={`− ${pkr(disc)}`} /><Row label="Total" value={pkr(total)} strong /></dl>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Discount (PKR)"><Input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
                <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</Select></Field>
              </div>
              {mode === "patient" && (
                <Field label="Amount paid now (PKR)" hint="Anything unpaid is added to the patient's dues.">
                  <Input type="number" min="0" max={total} value={paid ?? String(total)} onChange={(e) => setPaid(e.target.value)} />
                </Field>
              )}
              {mode === "patient" && due > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{pkr(due)} will be added to the patient&apos;s account as a due.</p>}
              <Button className="w-full py-3" busy={busy} onClick={checkout} disabled={!cart.length || lines.some((l) => l.short)}>
                Complete sale · {pkr(total)}
              </Button>
              {!!cart.length && <Button variant="ghost" className="w-full" onClick={reset}>Clear</Button>}
            </div>
          </Card>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Sales" value={daySales.length} />
        <Stat label="Total sold" value={pkr(daySales.reduce((s, x) => s + Number(x.total_amount), 0))} />
        <Stat label="Collected" value={pkr(daySales.reduce((s, x) => s + Number(x.paid_amount), 0))} tone="emerald" />
        <Stat label="Added to dues" value={pkr(daySales.reduce((s, x) => s + Number(x.due_amount), 0))} tone="amber" />
      </div>
      <Card title="Sales history" actions={<Input type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} className="w-44" aria-label="Day" />}>
        <ErrorBanner message={sales.error ?? (canSell ? null : error)} onClose={canSell ? undefined : () => setError(null)} />
        {sales.loading && !sales.data ? <Loading /> : !daySales.length ? <Empty title="No sales on this day" /> : (
          <Table head={["Receipt", "Time", "Customer", "Total", "Paid", "Due", "Status", "By"]}>
            {daySales.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td><button className="font-medium text-teal-700 hover:underline" onClick={() => api.get<Sale>(`/pharmacy/sales/${s.id}`).then(setReceipt).catch((e: Error) => setError(e.message))}>{s.sale_number}</button></Td>
                <Td>{fmtDateTime(s.sold_at)}</Td>
                <Td>{s.customer_name ?? "Walk-in"} {s.is_walk_in ? <Pill>Walk-in</Pill> : <Pill tone="teal">Patient</Pill>}</Td>
                <Num>{pkr(s.total_amount)}</Num><Num>{pkr(s.paid_amount)}</Num><Num className={Number(s.due_amount) > 0 ? "font-semibold text-rose-700" : ""}>{pkr(s.due_amount)}</Num>
                <Td><StatusBadge status={s.payment_status} /></Td><Td>{s.sold_by}</Td>
              </tr>))}
          </Table>
        )}
      </Card>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Sale receipt" wide
        footer={<><Button variant="secondary" onClick={() => setReceipt(null)}>Close</Button><Button icon={<Printer size={16} />} onClick={() => window.print()}>Print receipt</Button></>}>
        {receipt && <Receipt sale={receipt} />}
      </Modal>
    </Page>
  );
}
