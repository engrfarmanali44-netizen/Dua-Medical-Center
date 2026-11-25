"use client";
import { useEffect, useState } from "react";
import { Printer, UserRound, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize, pkr, qty } from "@/lib/format";
import { PAYMENT_METHODS, patientName, type Invoice, type Patient, type Payment } from "@/lib/types";
import { Button, ErrorBanner, Field, Input, Loading, Modal, Select, StatusBadge, Table, Td, Num, useData, useDebounced, useSubmit } from "@/components/ui";

/** Type-ahead patient search. Shows the selected patient as a chip. */
export function PatientPicker({ value, onChange, autoFocus }: { value: Patient | null; onChange: (p: Patient | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const [results, setResults] = useState<Patient[]>([]);
  useEffect(() => {
    if (dq.length < 2) { setResults([]); return; }
    let live = true;
    api.get<Patient[]>(`/patients?limit=8&q=${encodeURIComponent(dq)}`).then((r) => live && setResults(r)).catch(() => live && setResults([]));
    return () => { live = false; };
  }, [dq]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <UserRound size={16} className="text-teal-700" aria-hidden />
          <span className="font-semibold text-slate-800">{patientName(value)}</span>
          <span className="text-slate-500">{value.mrn} · {value.phone}</span>
        </div>
        <button onClick={() => onChange(null)} aria-label="Clear patient" className="rounded p-1 text-slate-500 hover:bg-white"><X size={16} /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient by MRN, name or phone" aria-label="Search patient" />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onChange(p); setQ(""); setResults([]); }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50">
                <span className="font-medium text-slate-800">{patientName(p)}</span>
                <span className="text-xs text-slate-500">{p.mrn} · {p.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {dq.length >= 2 && results.length === 0 && <p className="mt-1 text-xs text-slate-500">No matching patient. Register them at reception first.</p>}
    </div>
  );
}

/** Collect a payment from a patient, optionally against one invoice. */
export function RecordPaymentModal({ open, onClose, onDone, patient: fixedPatient, invoice }: {
  open: boolean; onClose: () => void; onDone: (p: Payment) => void;
  patient?: { id: string; name: string; mrn: string } | null; invoice?: Invoice | null;
}) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [outstanding, setOutstanding] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const { busy, error, setError, run } = useSubmit();
  const patientId = fixedPatient?.id ?? patient?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setAmount(invoice ? invoice.balance : ""); setReference(""); setMethod("CASH"); setError(null);
    if (!fixedPatient) setPatient(null);
  }, [open, invoice, fixedPatient, setError]);

  useEffect(() => {
    setOutstanding(null);
    if (!open || !patientId) return;
    if (invoice) { setOutstanding(invoice.balance); return; }
    api.get<{ summary: { outstanding: string } }>(`/billing/patients/${patientId}/account`)
      .then((a) => { setOutstanding(a.summary.outstanding); setAmount((v) => v || a.summary.outstanding); })
      .catch(() => setOutstanding(null));
  }, [open, patientId, invoice]);

  const submit = () => run(async () => {
    if (!patientId) throw new Error("Select a patient");
    const p = await api.post<Payment>("/billing/payments", {
      patient_id: patientId, amount: Number(amount), payment_method: method,
      invoice_id: invoice?.id ?? null, reference_number: reference || null,
    });
    onDone(p);
  });

  return (
    <Modal open={open} onClose={onClose} title={invoice ? `Collect payment · ${invoice.invoice_number}` : "Record payment"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit} disabled={!patientId || !(Number(amount) > 0)}>Save payment</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {fixedPatient ? (
          <p className="text-sm text-slate-600">Patient: <span className="font-semibold text-slate-800">{fixedPatient.name}</span> ({fixedPatient.mrn})</p>
        ) : (
          <Field label="Patient"><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>
        )}
        {patientId && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {invoice ? "Invoice balance" : "Total outstanding"}: <span className="font-semibold text-rose-700">{outstanding === null ? "…" : pkr(outstanding)}</span>
            {!invoice && <span className="block text-xs text-slate-500">Payment is applied to the oldest unpaid invoices first.</span>}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (PKR)"><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</Select></Field>
        </div>
        {method !== "CASH" && <Field label="Reference / transaction no."><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

/** Invoice detail with items, payments and a print button. */
export function InvoiceModal({ invoiceId, onClose, onCollect }: { invoiceId: string | null; onClose: () => void; onCollect?: (inv: Invoice) => void }) {
  const { data: inv, error, loading } = useData(() => invoiceId ? api.get<Invoice>(`/billing/invoices/${invoiceId}`) : Promise.resolve(null), [invoiceId], { live: ["billing"] });
  return (
    <Modal open={!!invoiceId} onClose={onClose} title={inv ? `Invoice ${inv.invoice_number}` : "Invoice"} wide
      footer={<>
        <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()} disabled={!inv}>Print</Button>
        {inv && onCollect && Number(inv.balance) > 0 && <Button onClick={() => onCollect(inv)}>Collect payment</Button>}
      </>}>
      <ErrorBanner message={error} />
      {loading && <Loading />}
      {inv && (
        <div className="print-area space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-lg font-bold text-teal-800">Dua Medical Hospital</p>
              <p className="text-sm text-slate-500">Invoice {inv.invoice_number} · {fmtDate(inv.invoice_date)}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-semibold text-slate-800">{inv.patient_name}</p>
              <p className="text-slate-500">{inv.patient_mrn} · {inv.patient_phone}</p>
              <div className="mt-1"><StatusBadge status={inv.status} /></div>
            </div>
          </div>
          <Table head={["Description", "Qty", "Unit price", "Amount"]}>
            {inv.items?.map((i, n) => <tr key={n}><Td>{i.description}</Td><Num>{qty(i.quantity)}</Num><Num>{pkr(i.unit_price)}</Num><Num>{pkr(i.line_total)}</Num></tr>)}
          </Table>
          <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <Row label="Subtotal" value={pkr(inv.subtotal)} />
            {Number(inv.discount_amount) > 0 && <Row label="Discount" value={`− ${pkr(inv.discount_amount)}`} />}
            <Row label="Total" value={pkr(inv.total_amount)} strong />
            <Row label="Paid" value={pkr(inv.paid_amount)} />
            <Row label="Balance due" value={pkr(inv.balance)} strong tone={Number(inv.balance) > 0 ? "text-rose-700" : "text-emerald-700"} />
          </dl>
          {!!inv.payments?.length && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Payments</h3>
              <Table head={["Receipt", "Date", "Method", "Amount"]}>
                {inv.payments.map((p) => <tr key={p.receipt_number}><Td>{p.receipt_number}</Td><Td>{fmtDateTime(p.received_at)}</Td><Td>{humanize(p.payment_method)}</Td><Num>{pkr(p.allocated_amount)}</Num></tr>)}
              </Table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function Row({ label, value, strong, tone = "" }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return <div className={`flex justify-between gap-4 ${strong ? "font-semibold" : ""}`}><dt className="text-slate-500">{label}</dt><dd className={`tabular-nums ${tone}`}>{value}</dd></div>;
}
