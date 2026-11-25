"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { addDaysIso, fmtDate, fmtDateTime, humanize, pkr, qty, round2, todayIso } from "@/lib/format";
import type { Batch, Medicine, Movement, Purchase, Supplier } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Num, Page, Pill, SearchInput, Select, Stat, Table, Td, Textarea, useCan, useData, useDebounced, useSubmit } from "@/components/ui";

const medLabel = (m: { generic_name?: string; medicine_name?: string; strength: string | null }) => `${m.generic_name ?? m.medicine_name}${m.strength ? ` ${m.strength}` : ""}`;

/* ---------------------------------------------------------------- medicines */

type MedForm = { medicine_code: string; generic_name: string; brand_name: string; strength: string; dosage_form: string; category: string; unit: string; reorder_level: string; is_active?: boolean };
const emptyMed: MedForm = { medicine_code: "", generic_name: "", brand_name: "", strength: "", dosage_form: "Tablet", category: "", unit: "tablet", reorder_level: "0" };

export function MedicinesPage() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData(() => api.get<Medicine[]>(`/pharmacy/medicines?include_inactive=true${dq ? `&q=${encodeURIComponent(dq)}` : ""}`), [dq], { live: ["medicines", "stock"] });
  const [form, setForm] = useState<{ id?: string; v: MedForm } | null>(null);
  const { busy, error: saveErr, setError, run } = useSubmit();
  const rows = (data ?? []).filter((m) => !lowOnly || (m.is_active && m.low_stock));
  const lowCount = (data ?? []).filter((m) => m.is_active && m.low_stock).length;

  const save = () => run(async () => {
    const v = form!.v;
    const body = { ...v, reorder_level: Number(v.reorder_level || 0), brand_name: v.brand_name || null, strength: v.strength || null, dosage_form: v.dosage_form || null, category: v.category || null };
    if (form!.id) { const { medicine_code: _c, ...rest } = body; await api.patch(`/pharmacy/medicines/${form!.id}`, rest); }
    else await api.post("/pharmacy/medicines", body);
    setForm(null); reload();
  });
  const set = (k: keyof MedForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => f && { ...f, v: { ...f.v, [k]: e.target.value } });

  return (
    <Page title="Medicines" subtitle="Catalog with live stock. Stock is added through purchases and reduced by sales."
      actions={can("pharmacy.medicines.create") && <Button icon={<Plus size={16} />} onClick={() => { setError(null); setForm({ v: emptyMed }); }}>Add medicine</Button>}>
      <Card title={`${rows.length} medicines`} actions={
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only {lowCount > 0 && <Pill tone="rose">{lowCount}</Pill>}</label>
          <SearchInput value={q} onChange={setQ} placeholder="Name, brand or code" />
        </div>}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !rows.length ? <Empty title="No medicines" hint="Add medicines to the catalog, then receive stock with a purchase." /> : (
          <Table head={["Code", "Medicine", "Form", "Category", "In stock", "Reorder at", "Nearest expiry", ""]}>
            {rows.map((m) => (
              <tr key={m.id} className={`hover:bg-slate-50 ${m.is_active ? "" : "opacity-50"}`}>
                <Td className="font-mono text-xs">{m.medicine_code}</Td>
                <Td><span className="font-medium text-slate-800">{medLabel(m)}</span>{m.brand_name && <span className="block text-xs text-slate-500">{m.brand_name}</span>}</Td>
                <Td>{m.dosage_form ?? "—"}</Td><Td>{m.category ?? "—"}</Td>
                <Num className={m.low_stock && m.is_active ? "font-semibold text-rose-700" : "font-semibold"}>{qty(m.on_hand)} <span className="text-xs font-normal text-slate-500">{m.unit}</span></Num>
                <Num>{qty(m.reorder_level)}</Num>
                <Td>{m.nearest_expiry ? fmtDate(m.nearest_expiry) : "—"}</Td>
                <Td className="text-right">
                  {!m.is_active ? <Pill>Inactive</Pill> : m.low_stock && <Pill tone="rose">Low stock</Pill>}
                  {can("pharmacy.medicines.manage") && <button className="ml-2 rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${m.generic_name}`}
                    onClick={() => { setError(null); setForm({ id: m.id, v: { ...emptyMed, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ?? ""])), reorder_level: String(Number(m.reorder_level)) } as MedForm }); }}><Pencil size={15} /></button>}
                </Td>
              </tr>))}
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit medicine" : "Add medicine"}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
        {form && <div className="space-y-4">
          <ErrorBanner message={saveErr} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code *"><Input value={form.v.medicine_code} onChange={set("medicine_code")} disabled={!!form.id} placeholder="PARA500" /></Field>
            <Field label="Generic name *"><Input value={form.v.generic_name} onChange={set("generic_name")} placeholder="Paracetamol" /></Field>
            <Field label="Brand name"><Input value={form.v.brand_name} onChange={set("brand_name")} placeholder="Panadol" /></Field>
            <Field label="Strength"><Input value={form.v.strength} onChange={set("strength")} placeholder="500mg" /></Field>
            <Field label="Dosage form"><Select value={form.v.dosage_form} onChange={set("dosage_form")}>{["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drip", "Cream", "Ointment", "Drops", "Inhaler", "Sachet", "Other"].map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Category"><Input value={form.v.category} onChange={set("category")} placeholder="Analgesic" /></Field>
            <Field label="Selling unit" hint="What one quantity means: tablet, strip, bottle..."><Input value={form.v.unit} onChange={set("unit")} /></Field>
            <Field label="Reorder level" hint="Warn when stock falls to this"><Input type="number" min="0" value={form.v.reorder_level} onChange={set("reorder_level")} /></Field>
          </div>
          {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.v.is_active !== false} onChange={(e) => setForm({ ...form, v: { ...form.v, is_active: e.target.checked } })} /> Active (available for sale)</label>}
        </div>}
      </Modal>
    </Page>
  );
}

/* ---------------------------------------------------------------- suppliers */

export function SuppliersPage() {
  const can = useCan();
  const { data, error, loading, reload } = useData(() => api.get<Supplier[]>("/pharmacy/suppliers?include_inactive=true"), [], { live: ["suppliers"] });
  const [form, setForm] = useState<Partial<Supplier> | null>(null);
  const { busy, error: saveErr, setError, run } = useSubmit();
  const save = () => run(async () => {
    const { id, ...body } = form!;
    if (id) await api.patch(`/pharmacy/suppliers/${id}`, body); else await api.post("/pharmacy/suppliers", body);
    setForm(null); reload();
  });
  return (
    <Page title="Suppliers" subtitle="Distributors and companies you buy medicines from."
      actions={can("pharmacy.purchases.create") && <Button icon={<Plus size={16} />} onClick={() => { setError(null); setForm({ name: "" }); }}>Add supplier</Button>}>
      <Card>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No suppliers yet" /> : (
          <Table head={["Name", "Contact person", "Phone", "Address", "", ""]}>
            {data.map((s) => (
              <tr key={s.id} className={s.is_active ? "" : "opacity-50"}>
                <Td className="font-medium text-slate-800">{s.name}</Td><Td>{s.contact_person ?? "—"}</Td><Td>{s.phone ?? "—"}</Td>
                <Td className="max-w-xs truncate">{s.address ?? "—"}</Td><Td>{!s.is_active && <Pill>Inactive</Pill>}</Td>
                <Td className="text-right">{can("pharmacy.suppliers.manage") && <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${s.name}`} onClick={() => { setError(null); setForm(s); }}><Pencil size={15} /></button>}</Td>
              </tr>))}
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit supplier" : "Add supplier"}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
        {form && <div className="space-y-4">
          <ErrorBanner message={saveErr} />
          <Field label="Name *"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person"><Input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Address"><Textarea value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>}
        </div>}
      </Modal>
    </Page>
  );
}

/* ---------------------------------------------------------------- purchases */

type Line = { key: number; medicine_id: string; batch_number: string; expiry_date: string; quantity: string; unit_cost: string; selling_price: string };
let lineKey = 0;
const newLine = (): Line => ({ key: ++lineKey, medicine_id: "", batch_number: "", expiry_date: addDaysIso(365), quantity: "", unit_cost: "", selling_price: "" });

function NewPurchaseModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const suppliers = useData(() => open ? api.get<Supplier[]>("/pharmacy/suppliers") : Promise.resolve([]), [open]);
  const medicines = useData(() => open ? api.get<Medicine[]>("/pharmacy/medicines") : Promise.resolve([]), [open]);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const { busy, error, run } = useSubmit();
  const total = round2(lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0));
  const upd = (key: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l) => l.key === key ? { ...l, [k]: v } : l));
  const reset = () => { setSupplierId(""); setInvoiceNo(""); setNotes(""); setLines([newLine()]); };

  const submit = () => run(async () => {
    const items = lines.filter((l) => l.medicine_id);
    if (!supplierId) throw new Error("Choose a supplier.");
    if (!items.length) throw new Error("Add at least one medicine.");
    const today = todayIso();
    items.forEach((l) => {
      const n = lines.indexOf(l) + 1;
      const m = medicines.data?.find((x) => x.id === l.medicine_id);
      const where = `Line ${n}${m ? ` (${m.generic_name})` : ""}`;
      if (!l.batch_number.trim()) throw new Error(`${where}: enter the batch number.`);
      if (!l.expiry_date) throw new Error(`${where}: enter the expiry date.`);
      if (l.expiry_date <= today) throw new Error(`${where}: this batch is already expired.`);
      if (!(Number(l.quantity) > 0)) throw new Error(`${where}: enter a quantity greater than 0.`);
      if (l.unit_cost === "" || Number(l.unit_cost) < 0) throw new Error(`${where}: enter the cost price.`);
      if (l.selling_price === "" || Number(l.selling_price) < 0) throw new Error(`${where}: enter the selling price.`);
    });
    const belowCost = items.filter((l) => Number(l.selling_price) < Number(l.unit_cost));
    if (belowCost.length && !window.confirm(`${belowCost.length} line(s) have a selling price lower than the cost price. Save anyway?`)) return;
    await api.post("/pharmacy/purchases", {
      supplier_id: supplierId, supplier_invoice_no: invoiceNo || null, notes: notes || null,
      items: items.map((l) => ({ medicine_id: l.medicine_id, batch_number: l.batch_number, expiry_date: l.expiry_date,
        quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), selling_price: Number(l.selling_price) })),
    });
    reset(); onDone();
  });

  return (
    <Modal open={open} onClose={onClose} title="Receive purchase" wide
      footer={<><span className="mr-auto self-center text-sm text-slate-600">Total: <b className="text-slate-900">{pkr(total)}</b></span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Post purchase &amp; add stock</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Supplier *"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Supplier invoice no."><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {suppliers.data && !suppliers.data.length && <p className="text-sm text-amber-700">Add a supplier first (Suppliers page).</p>}
        <div className="space-y-2">
          <div className="hidden grid-cols-[2fr_1fr_1fr_0.8fr_0.9fr_0.9fr_auto] gap-2 text-xs font-semibold uppercase text-slate-500 md:grid">
            <span>Medicine</span><span>Batch no.</span><span>Expiry</span><span>Qty</span><span>Cost / unit</span><span>Sell / unit</span><span />
          </div>
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[2fr_1fr_1fr_0.8fr_0.9fr_0.9fr_auto] md:border-0 md:p-0">
              <Select className="col-span-2 md:col-span-1" value={l.medicine_id} onChange={(e) => upd(l.key, "medicine_id", e.target.value)} aria-label="Medicine">
                <option value="">Select medicine…</option>{medicines.data?.map((m) => <option key={m.id} value={m.id}>{medLabel(m)} ({m.medicine_code})</option>)}
              </Select>
              <Input value={l.batch_number} onChange={(e) => upd(l.key, "batch_number", e.target.value)} placeholder="Batch" aria-label="Batch number" />
              <Input type="date" value={l.expiry_date} onChange={(e) => upd(l.key, "expiry_date", e.target.value)} aria-label="Expiry date" />
              <Input type="number" min="0" value={l.quantity} onChange={(e) => upd(l.key, "quantity", e.target.value)} placeholder="Qty" aria-label="Quantity" />
              <Input type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => upd(l.key, "unit_cost", e.target.value)} placeholder="Cost" aria-label="Unit cost" />
              <Input type="number" min="0" step="0.01" value={l.selling_price} onChange={(e) => upd(l.key, "selling_price", e.target.value)} placeholder="Sell" aria-label="Selling price" />
              <button className="justify-self-end rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" disabled={lines.length === 1} aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>
            </div>))}
          <Button variant="ghost" icon={<Plus size={16} />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>
        </div>
      </div>
    </Modal>
  );
}

export function PurchasesPage() {
  const can = useCan();
  const { data, error, loading, reload } = useData(() => api.get<Purchase[]>("/pharmacy/purchases"), [], { live: ["purchases"] });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const detail = useData(() => view ? api.get<Purchase>(`/pharmacy/purchases/${view}`) : Promise.resolve(null), [view], { live: ["purchases"] });
  const monthTotal = (data ?? []).filter((p) => p.purchase_date.slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((s, p) => s + Number(p.total_amount), 0);
  return (
    <Page title="Purchases" subtitle="Goods received from suppliers. Posting a purchase adds the stock immediately."
      actions={can("pharmacy.purchases.create") && <Button icon={<Plus size={16} />} onClick={() => setOpen(true)}>Receive purchase</Button>}>
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Purchased this month" value={pkr(monthTotal)} /><Stat label="Purchase entries" value={data?.length ?? "—"} /></div>
      <Card>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No purchases yet" /> : (
          <Table head={["Purchase no.", "Date", "Supplier", "Supplier invoice", "Items", "Total"]}>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><button className="font-medium text-teal-700 hover:underline" onClick={() => setView(p.id)}>{p.purchase_number}</button></Td>
                <Td>{fmtDate(p.purchase_date)}</Td><Td>{p.supplier_name}</Td><Td>{p.supplier_invoice_no ?? "—"}</Td><Num>{p.item_count}</Num><Num className="font-semibold">{pkr(p.total_amount)}</Num>
              </tr>))}
          </Table>
        )}
      </Card>
      <NewPurchaseModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
      <Modal open={!!view} onClose={() => setView(null)} title={detail.data ? `Purchase ${detail.data.purchase_number}` : "Purchase"} wide>
        {detail.loading ? <Loading /> : detail.data && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{detail.data.supplier_name} · {fmtDate(detail.data.purchase_date)}{detail.data.supplier_invoice_no && ` · Supplier invoice ${detail.data.supplier_invoice_no}`}</p>
            <Table head={["Medicine", "Batch", "Expiry", "Qty", "Cost", "Sell", "Amount"]}>
              {detail.data.items?.map((i, n) => <tr key={n}><Td>{medLabel(i)}</Td><Td>{i.batch_number}</Td><Td>{fmtDate(i.expiry_date)}</Td><Num>{qty(i.quantity)}</Num><Num>{pkr(i.unit_cost)}</Num><Num>{pkr(i.selling_price)}</Num><Num>{pkr(i.line_total)}</Num></tr>)}
            </Table>
            <p className="text-right font-semibold">Total {pkr(detail.data.total_amount)}</p>
          </div>)}
      </Modal>
    </Page>
  );
}

/* ---------------------------------------------------------------- stock */

export function StockPage() {
  const [q, setQ] = useState("");
  const { data, error, loading } = useData(() => api.get<Batch[]>("/pharmacy/stock/batches"), [], { live: ["stock"] });
  const rows = (data ?? []).filter((b) => !q || `${b.medicine_name} ${b.batch_number}`.toLowerCase().includes(q.toLowerCase()));
  const value = rows.reduce((s, b) => s + Number(b.stock_value), 0);
  return (
    <Page title="Stock by batch" subtitle="Current quantity in every batch, sold earliest-expiry first.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Stock value (at cost)" value={pkr(value)} />
        <Stat label="Batches in stock" value={rows.length} />
        <Stat label="Expired batches still in stock" value={rows.filter((b) => b.expired).length} tone="rose" />
      </div>
      <Card actions={<SearchInput value={q} onChange={setQ} placeholder="Medicine or batch" />} title="Batches">
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !rows.length ? <Empty title="No stock" hint="Receive a purchase to add stock." /> : (
          <Table head={["Medicine", "Batch", "Expiry", "On hand", "Cost", "Sell", "Value"]}>
            {rows.map((b) => (
              <tr key={b.batch_id}>
                <Td className="font-medium text-slate-800">{medLabel(b)}</Td><Td>{b.batch_number}</Td>
                <Td><ExpiryCell batch={b} /></Td>
                <Num className="font-semibold">{qty(b.on_hand)}</Num><Num>{pkr(b.purchase_price)}</Num><Num>{pkr(b.selling_price)}</Num><Num>{pkr(b.stock_value)}</Num>
              </tr>))}
          </Table>
        )}
      </Card>
    </Page>
  );
}

function ExpiryCell({ batch }: { batch: Batch }) {
  const tone = batch.expired ? "rose" : batch.days_to_expiry <= 30 ? "rose" : batch.days_to_expiry <= 90 ? "amber" : null;
  return <span className="flex items-center gap-2">{fmtDate(batch.expiry_date)}{tone && <Pill tone={tone}>{batch.expired ? "Expired" : `${batch.days_to_expiry} days`}</Pill>}</span>;
}

export function ExpiryAlertsPage() {
  const [days, setDays] = useState(90);
  const { data, error, loading } = useData(() => api.get<Batch[]>(`/pharmacy/expiry-alerts?days=${days}`), [days], { live: ["stock"] });
  const expired = (data ?? []).filter((b) => b.expired);
  return (
    <Page title="Expiry alerts" subtitle="Batches in stock that have expired or will expire soon. Expired stock is blocked from sale automatically.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Expired (in stock)" value={expired.length} tone="rose" />
        <Stat label={`Expiring within ${days} days`} value={(data?.length ?? 0) - expired.length} tone="amber" />
        <Stat label="Value at risk (cost)" value={pkr((data ?? []).reduce((s, b) => s + Number(b.stock_value), 0))} />
      </div>
      <Card title="Batches" actions={<Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window" className="w-40">{[30, 60, 90, 180].map((d) => <option key={d} value={d}>Next {d} days</option>)}</Select>}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="Nothing expiring soon" /> : (
          <Table head={["Medicine", "Batch", "Expiry", "On hand", "Value"]}>
            {data.map((b) => <tr key={b.batch_id}><Td className="font-medium text-slate-800">{medLabel(b)}</Td><Td>{b.batch_number}</Td><Td><ExpiryCell batch={b} /></Td><Num className="font-semibold">{qty(b.on_hand)}</Num><Num>{pkr(b.stock_value)}</Num></tr>)}
          </Table>
        )}
      </Card>
    </Page>
  );
}

export function MovementsPage() {
  const { data, error, loading } = useData(() => api.get<Movement[]>("/pharmacy/stock/movements?limit=300"), [], { live: ["stock"] });
  return (
    <Page title="Stock movements" subtitle="Every quantity that entered or left the pharmacy, newest first.">
      <Card>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No stock movements yet" /> : (
          <Table head={["Date", "Type", "Medicine", "Batch", "Quantity", "Source", "By"]}>
            {data.map((m) => {
              const inbound = ["RECEIPT", "RETURN", "TRANSFER_IN", "ADJUSTMENT_IN"].includes(m.movement_type);
              return (
                <tr key={m.id}><Td>{fmtDateTime(m.occurred_at)}</Td><Td><Pill tone={inbound ? "emerald" : "slate"}>{humanize(m.movement_type)}</Pill></Td>
                  <Td>{medLabel(m)}</Td><Td>{m.batch_number}</Td>
                  <Num className={`font-semibold ${inbound ? "text-emerald-700" : "text-slate-800"}`}>{inbound ? "+" : "−"}{qty(m.quantity)}</Num>
                  <Td>{humanize(m.reference_type)}</Td><Td>{m.performed_by}</Td></tr>);
            })}
          </Table>
        )}
      </Card>
    </Page>
  );
}
