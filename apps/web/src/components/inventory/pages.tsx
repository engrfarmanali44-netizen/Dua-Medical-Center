"use client";
import { useState } from "react";
import { History, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize, pkr } from "@/lib/format";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Num, Page, Pill, SearchInput, Select, Stat, Table, Td, Textarea, useCan, useData, useDebounced, useSubmit } from "@/components/ui";

type Item = { id: string; item_code: string; name: string; category: string; location: string | null; quantity: number; unit: string;
  condition: "GOOD" | "NEEDS_REPAIR" | "DAMAGED"; unit_cost: string | null; total_value: string | null; purchase_date: string | null; notes: string | null; updated_at: string | null };
type Data = { summary: { items: number; pieces: number; by_category: Record<string, number>; needs_repair: number; damaged: number; value: string }; items: Item[] };
type Hist = { change: number; quantity_after: number; note: string; at: string; by: string };

const CATEGORIES = ["FURNITURE", "EQUIPMENT", "ELECTRONICS", "LINEN", "OTHER"];
const COND = { GOOD: { label: "Good", tone: "emerald" }, NEEDS_REPAIR: { label: "Needs repair", tone: "amber" }, DAMAGED: { label: "Damaged", tone: "rose" } } as const;

type Form = { name: string; category: string; location: string; quantity: string; unit: string; condition: string; unit_cost: string; purchase_date: string; notes: string };
const empty: Form = { name: "", category: "FURNITURE", location: "", quantity: "1", unit: "piece", condition: "GOOD", unit_cost: "", purchase_date: "", notes: "" };

function ItemModal({ item, onClose, onDone }: { item: Item | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Form>(item ? { name: item.name, category: item.category, location: item.location ?? "", quantity: String(item.quantity), unit: item.unit,
    condition: item.condition, unit_cost: item.unit_cost ? String(Number(item.unit_cost)) : "", purchase_date: item.purchase_date ?? "", notes: item.notes ?? "" } : empty);
  const { busy, error, run } = useSubmit();
  const on = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => run(async () => {
    if (f.name.trim().length < 2) throw new Error("Enter the item name.");
    const body: Record<string, unknown> = { name: f.name, category: f.category, location: f.location || null, unit: f.unit || "piece", condition: f.condition,
      unit_cost: f.unit_cost === "" ? null : Number(f.unit_cost), purchase_date: f.purchase_date || null, notes: f.notes || null };
    if (item) await api.patch(`/inventory/${item.id}`, body);
    else await api.post("/inventory", { ...body, quantity: Number(f.quantity || 0) });
    onDone();
  });
  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.item_code}` : "Add item"} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item *"><Input value={f.name} onChange={on("name")} placeholder="e.g. Visitor chair, Steel stool, Patient bed" autoFocus /></Field>
          <Field label="Category"><Select value={f.category} onChange={on("category")}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
          <Field label="Location" hint="Ward, room or department"><Input value={f.location} onChange={on("location")} placeholder="e.g. OPD waiting area" /></Field>
          <Field label="Condition"><Select value={f.condition} onChange={on("condition")}>{Object.entries(COND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          {!item && <Field label="Quantity *"><Input type="number" min={0} value={f.quantity} onChange={on("quantity")} /></Field>}
          <Field label="Unit"><Input value={f.unit} onChange={on("unit")} placeholder="piece, set, pair" /></Field>
          <Field label="Cost per unit (PKR)" hint="Optional, for the total value"><Input type="number" min={0} value={f.unit_cost} onChange={on("unit_cost")} /></Field>
          <Field label="Purchase date"><Input type="date" value={f.purchase_date} onChange={on("purchase_date")} /></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={on("notes")} /></Field>
        {item && <p className="text-xs text-slate-500">To change the quantity use the + / − buttons, so the reason is kept in the history.</p>}
      </div>
    </Modal>
  );
}

function AdjustModal({ item, dir, onClose, onDone }: { item: Item; dir: 1 | -1; onClose: () => void; onDone: () => void }) {
  const [n, setN] = useState("1");
  const [note, setNote] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = () => run(async () => {
    if (!(Number(n) > 0)) throw new Error("Enter how many.");
    if (note.trim().length < 3) throw new Error("Write the reason (e.g. 3 broken, 10 new bought).");
    await api.post(`/inventory/${item.id}/adjust`, { change: dir * Number(n), note }); onDone();
  });
  return (
    <Modal open onClose={onClose} title={`${dir > 0 ? "Add to" : "Remove from"} ${item.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} variant={dir > 0 ? "primary" : "danger"} onClick={submit}>{dir > 0 ? "Add" : "Remove"}</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-slate-600">Now: <b>{item.quantity} {item.unit}</b></p>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="How many"><Input type="number" min={1} max={dir < 0 ? item.quantity : undefined} value={n} onChange={(e) => setN(e.target.value)} autoFocus /></Field>
          <Field label="Reason *"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={dir > 0 ? "e.g. 10 new bought" : "e.g. 3 broken, sent for disposal"} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, error, loading } = useData(() => api.get<Hist[]>(`/inventory/${item.id}/history`), [item.id]);
  return (
    <Modal open onClose={onClose} title={`History · ${item.name}`} wide>
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty title="No history" /> : (
        <Table head={["When", "Change", "Now", "Reason", "By"]}>
          {data.map((h, i) => <tr key={i}><Td>{fmtDateTime(h.at)}</Td>
            <Num className={h.change > 0 ? "font-semibold text-emerald-700" : h.change < 0 ? "font-semibold text-rose-700" : ""}>{h.change > 0 ? `+${h.change}` : h.change || "—"}</Num>
            <Num>{h.quantity_after}</Num><Td className="whitespace-normal">{h.note}</Td><Td>{h.by}</Td></tr>)}
        </Table>
      )}
    </Modal>
  );
}

export function InventoryPage() {
  const can = useCan();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [cond, setCond] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData(() => api.get<Data>(`/inventory?${new URLSearchParams({ ...(dq && { q: dq }), ...(cat && { category: cat }), ...(cond && { condition: cond }) })}`),
    [dq, cat, cond], { live: ["inventory"] });
  const [edit, setEdit] = useState<Item | null | undefined>(undefined);
  const [adj, setAdj] = useState<{ item: Item; dir: 1 | -1 } | null>(null);
  const [hist, setHist] = useState<Item | null>(null);
  const del = useSubmit();
  const s = data?.summary;
  return (
    <Page title="Hospital inventory" subtitle="Chairs, tables, stools, beds, equipment and other hospital items."
      actions={<Button icon={<Plus size={16} />} onClick={() => setEdit(null)}>Add item</Button>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Items" value={s ? `${s.items} types · ${s.pieces} pcs` : "—"} />
        <Stat label="Needs repair" value={s?.needs_repair ?? "—"} tone="amber" />
        <Stat label="Damaged" value={s?.damaged ?? "—"} tone="rose" />
        <Stat label="Total value" value={s ? pkr(s.value) : "—"} />
      </div>
      <ErrorBanner message={error ?? del.error} />
      <Card title="Items" actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-40" aria-label="Category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)} {s ? `(${s.by_category[c]})` : ""}</option>)}</Select>
        <Select value={cond} onChange={(e) => setCond(e.target.value)} className="sm:w-40" aria-label="Condition"><option value="">Any condition</option>{Object.entries(COND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <SearchInput value={q} onChange={setQ} placeholder="Item, location, code" />
      </div>}>
        {loading && !data ? <Loading /> : !data?.items.length ? <Empty title="No items" hint="Add chairs, tables, stools and other items." action={<Button icon={<Plus size={16} />} onClick={() => setEdit(null)}>Add item</Button>} /> : (
          <Table head={["Item", "Category", "Location", "Quantity", "Condition", "Value", ""]}>
            {data.items.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <Td><span className="font-medium text-slate-800">{a.name}</span><span className="block text-xs text-slate-500">{a.item_code}{a.purchase_date && ` · bought ${fmtDate(a.purchase_date)}`}</span></Td>
                <Td>{humanize(a.category)}</Td><Td>{a.location ?? "—"}</Td>
                <Td><div className="flex items-center gap-1">
                  <button className="rounded border p-1 hover:bg-slate-50 disabled:opacity-30" disabled={a.quantity === 0} aria-label={`Remove ${a.name}`} onClick={() => setAdj({ item: a, dir: -1 })}><Minus size={14} /></button>
                  <span className="min-w-14 text-center font-semibold tabular-nums">{a.quantity} <span className="text-xs font-normal text-slate-500">{a.unit}</span></span>
                  <button className="rounded border p-1 hover:bg-slate-50" aria-label={`Add ${a.name}`} onClick={() => setAdj({ item: a, dir: 1 })}><Plus size={14} /></button>
                </div></Td>
                <Td><Pill tone={COND[a.condition].tone}>{COND[a.condition].label}</Pill></Td>
                <Num>{a.total_value ? pkr(a.total_value) : "—"}</Num>
                <Td className="text-right">
                  <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`History of ${a.name}`} onClick={() => setHist(a)}><History size={15} /></button>
                  <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil size={15} /></button>
                  {can("inventory.delete") && <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${a.name}`}
                    onClick={() => window.confirm(`Delete "${a.name}" (${a.quantity} ${a.unit})?`) && del.run(async () => { await api.del(`/inventory/${a.id}`); reload(); })}><Trash2 size={15} /></button>}
                </Td>
              </tr>))}
          </Table>
        )}
      </Card>
      {edit !== undefined && <ItemModal item={edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); reload(); }} />}
      {adj && <AdjustModal item={adj.item} dir={adj.dir} onClose={() => setAdj(null)} onDone={() => { setAdj(null); reload(); }} />}
      {hist && <HistoryModal item={hist} onClose={() => setHist(null)} />}
    </Page>
  );
}
