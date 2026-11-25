"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Plus } from "lucide-react";
import { api, type ApiError } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize, pkr } from "@/lib/format";
import type { Account, Due, Invoice, Payment } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Loading, Num, Page, SearchInput, Select, Stat, StatusBadge, Table, Td, useCan, useData, useDebounced } from "@/components/ui";
import { InvoiceModal, RecordPaymentModal } from "./shared";

function usePortalId() { return useParams<{ portal: string }>().portal; }

/* ---------------------------------------------------------------- invoices */

export function InvoicesPage() {
  const can = useCan();
  const [status, setStatus] = useState("OPEN");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData(
    () => api.get<Invoice[]>(`/billing/invoices?${new URLSearchParams({ ...(status && { status }), ...(dq && { q: dq }) })}`), [status, dq], { live: ["billing"] });
  const [openId, setOpenId] = useState<string | null>(null);
  const [collect, setCollect] = useState<Invoice | null>(null);
  const totalDue = (data ?? []).reduce((s, i) => s + Number(i.balance), 0);

  return (
    <Page title="Patient invoices" subtitle="Every charge to a patient: pharmacy, lab, consultation and more.">
      <Card actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter" className="sm:w-48">
            <option value="OPEN">Unpaid &amp; partially paid</option><option value="UNPAID">Unpaid</option>
            <option value="PARTIALLY_PAID">Partially paid</option><option value="PAID">Paid</option><option value="">All</option>
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Invoice no, MRN, name, phone" />
        </div>}
        title={data ? <span>{data.length} invoices{status !== "PAID" && <span className="ml-2 text-sm font-normal text-rose-700">· {pkr(totalDue)} due</span>}</span> : "Invoices"}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No invoices found" hint="Invoices are created automatically when a patient is billed." /> : (
          <Table head={["Invoice", "Date", "Patient", "Total", "Paid", "Balance", "Status", ""]}>
            {data.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td><button className="font-medium text-teal-700 hover:underline" onClick={() => setOpenId(i.id)}>{i.invoice_number}</button></Td>
                <Td>{fmtDate(i.invoice_date)}</Td>
                <Td><span className="font-medium text-slate-800">{i.patient_name}</span> <span className="text-xs text-slate-500">{i.patient_mrn}</span></Td>
                <Num>{pkr(i.total_amount)}</Num><Num>{pkr(i.paid_amount)}</Num>
                <Num className={Number(i.balance) > 0 ? "font-semibold text-rose-700" : ""}>{pkr(i.balance)}</Num>
                <Td><StatusBadge status={i.status} /></Td>
                <Td className="text-right">{can("billing.payments.create") && Number(i.balance) > 0 && <Button variant="secondary" onClick={() => setCollect(i)}>Collect</Button>}</Td>
              </tr>))}
          </Table>
        )}
      </Card>
      <InvoiceModal invoiceId={openId} onClose={() => setOpenId(null)} onCollect={can("billing.payments.create") ? (inv) => { setOpenId(null); setCollect(inv); } : undefined} />
      <RecordPaymentModal open={!!collect} invoice={collect} onClose={() => setCollect(null)}
        patient={collect ? { id: collect.patient_id, name: collect.patient_name ?? "", mrn: collect.patient_mrn ?? "" } : null}
        onDone={() => { setCollect(null); reload(); }} />
    </Page>
  );
}

/* ---------------------------------------------------------------- payments */

export function PaymentsPage() {
  const can = useCan();
  const { data, error, loading, reload } = useData(() => api.get<Payment[]>("/billing/payments"), [], { live: ["billing"] });
  const [open, setOpen] = useState(false);
  return (
    <Page title="Payments" subtitle="Money received from patients against their invoices."
      actions={can("billing.payments.create") && <Button icon={<Plus size={16} />} onClick={() => setOpen(true)}>Record payment</Button>}>
      <Card>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No payments yet" /> : (
          <Table head={["Receipt", "Date", "Patient", "Method", "Reference", "Received by", "Amount"]}>
            {data.map((p) => (
              <tr key={p.id}><Td className="font-medium">{p.receipt_number}</Td><Td>{fmtDateTime(p.received_at)}</Td>
                <Td>{p.patient_name} <span className="text-xs text-slate-500">{p.patient_mrn}</span></Td><Td>{humanize(p.payment_method)}</Td>
                <Td>{p.reference_number ?? "—"}</Td><Td>{p.received_by}</Td><Num className="font-semibold">{pkr(p.amount)}</Num></tr>))}
          </Table>
        )}
      </Card>
      <RecordPaymentModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </Page>
  );
}

/* ---------------------------------------------------------------- dues */

export function DuesPage() {
  const portal = usePortalId();
  const can = useCan();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useData(() => api.get<Due[]>(`/billing/dues${dq ? `?q=${encodeURIComponent(dq)}` : ""}`), [dq], { live: ["billing"] });
  const [collect, setCollect] = useState<Due | null>(null);
  const total = (data ?? []).reduce((s, d) => s + Number(d.outstanding), 0);
  return (
    <Page title="Outstanding dues" subtitle="Patients with unpaid or partially paid invoices.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total pending dues" value={pkr(total)} tone="rose" />
        <Stat label="Patients with dues" value={data?.length ?? "—"} />
        <Stat label="Open invoices" value={(data ?? []).reduce((s, d) => s + d.open_invoices, 0)} />
      </div>
      <Card actions={<SearchInput value={q} onChange={setQ} placeholder="MRN, name, phone" />} title="Pending dues">
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No pending dues" hint="All patient invoices are fully paid." /> : (
          <Table head={["Patient", "MRN", "Phone", "Open invoices", "Oldest since", "Outstanding", ""]}>
            {data.map((d) => (
              <tr key={d.patient_id} className="hover:bg-slate-50">
                <Td><Link href={`/${portal}/patients/${d.patient_id}`} className="font-medium text-teal-700 hover:underline">{d.name}</Link></Td>
                <Td>{d.mrn}</Td><Td>{d.phone}</Td><Num>{d.open_invoices}</Num><Td>{fmtDate(d.oldest_invoice_date)}</Td>
                <Num className="font-semibold text-rose-700">{pkr(d.outstanding)}</Num>
                <Td className="text-right">{can("billing.payments.create") && <Button variant="secondary" onClick={() => setCollect(d)}>Collect</Button>}</Td>
              </tr>))}
          </Table>
        )}
      </Card>
      <RecordPaymentModal open={!!collect} onClose={() => setCollect(null)}
        patient={collect ? { id: collect.patient_id, name: collect.name, mrn: collect.mrn } : null}
        onDone={() => { setCollect(null); reload(); }} />
    </Page>
  );
}

/* ---------------------------------------------------------------- account (shared by staff + patient) */

export function AccountView({ account, onChanged, allowCollect }: { account: Account; onChanged?: () => void; allowCollect?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [collect, setCollect] = useState<Invoice | null | undefined>(undefined);
  const s = account.summary;
  const pt = { id: account.patient.id, name: account.patient.name, mrn: account.patient.mrn };
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Total billed" value={pkr(s.total_billed)} />
        <Stat label="Total paid" value={pkr(s.total_paid)} tone="emerald" />
        <Stat label="Outstanding" value={pkr(s.outstanding)} tone={Number(s.outstanding) > 0 ? "rose" : "emerald"} />
        <Stat label="Open invoices" value={s.open_invoices} tone={s.open_invoices ? "amber" : "slate"} />
      </div>
      <Card title="Invoices" actions={allowCollect && Number(s.outstanding) > 0 && <Button onClick={() => setCollect(null)}>Collect payment</Button>}>
        {!account.invoices.length ? <Empty title="No invoices yet" /> : (
          <Table head={["Invoice", "Date", "Details", "Total", "Paid", "Balance", "Status"]}>
            {account.invoices.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td><button className="font-medium text-teal-700 hover:underline" onClick={() => setOpenId(i.id)}>{i.invoice_number}</button></Td>
                <Td>{fmtDate(i.invoice_date)}</Td><Td className="text-slate-500">{i.notes ?? "—"}</Td>
                <Num>{pkr(i.total_amount)}</Num><Num>{pkr(i.paid_amount)}</Num>
                <Num className={Number(i.balance) > 0 ? "font-semibold text-rose-700" : ""}>{pkr(i.balance)}</Num>
                <Td><StatusBadge status={i.status} /></Td>
              </tr>))}
          </Table>
        )}
      </Card>
      <Card title="Payments">
        {!account.payments.length ? <Empty title="No payments yet" /> : (
          <Table head={["Receipt", "Date", "Method", "Reference", "Amount"]}>
            {account.payments.map((p) => <tr key={p.id}><Td className="font-medium">{p.receipt_number}</Td><Td>{fmtDateTime(p.received_at)}</Td><Td>{humanize(p.payment_method)}</Td><Td>{p.reference_number ?? "—"}</Td><Num className="font-semibold">{pkr(p.amount)}</Num></tr>)}
          </Table>
        )}
      </Card>
      <InvoiceModal invoiceId={openId} onClose={() => setOpenId(null)} onCollect={allowCollect ? (inv) => { setOpenId(null); setCollect(inv); } : undefined} />
      {allowCollect && <RecordPaymentModal open={collect !== undefined} invoice={collect ?? null} patient={pt} onClose={() => setCollect(undefined)} onDone={() => { setCollect(undefined); onChanged?.(); }} />}
    </div>
  );
}

export function MyAccountPage() {
  // null = this login has no patient record (e.g. Admin previewing the patient portal).
  const { data, error, loading } = useData(
    () => api.get<Account>("/billing/me/account").catch((e: ApiError) => { if (e.status === 404) return null; throw e; }),
    [], { live: ["billing"] });
  return (
    <Page title="My dues & payments" subtitle="Your invoices, payments and any balance due to Dua Medical Hospital.">
      <ErrorBanner message={error} />
      {loading && data === null && !error ? <Loading /> : data ? <AccountView account={data} />
        : !error && <Card><Empty title="No patient record linked to this login" hint="Patient bills appear here when a patient signs in. Please contact the counter if you are a patient." /></Card>}
    </Page>
  );
}
