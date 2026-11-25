"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CheckCircle2, ClipboardPlus, FileText, Image as ImageIcon, Loader2, Plus, RotateCcw, Save, Stethoscope, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Medicine, Patient, PatientCase, Visit, VisitAttachment, VisitMedicine } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Page, Pill, SearchInput, Select, Table, Td, Textarea, useCan, useData, useDebounced, useSubmit } from "@/components/ui";
import { PatientPicker } from "@/components/billing/shared";
import { RateTreatmentLink } from "@/components/reviews/pages";

type Doctor = { id: string; name: string; designation: string };
const KIND_LABEL: Record<VisitAttachment["kind"], string> = { SLIP: "Medicine slip", LAB_REPORT: "Lab report", OTHER: "Other" };

function usePortal() { return useParams<{ portal: string }>().portal; }

/* ---------------------------------------------------------------- images: shrink on the device before upload */

async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/* ---------------------------------------------------------------- case list */

export function CasesPage() {
  const portal = usePortal();
  const can = useCan();
  const [status, setStatus] = useState("OPEN");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading } = useData(() => api.get<PatientCase[]>(`/visits/cases?${new URLSearchParams({ ...(status && { status }), ...(dq && { q: dq }) })}`),
    [status, dq], { live: ["visits"] });
  const [open, setOpen] = useState(false);
  return (
    <Page title="Patient visits" subtitle="Each problem is a case: Visit 1, Visit 2... until the patient recovers and the case is finalized."
      actions={can("visits.create") && <Button icon={<ClipboardPlus size={16} />} onClick={() => setOpen(true)}>Open new case</Button>}>
      <Card title={data ? `${data.length} cases` : "Cases"} actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="sm:w-48">
            <option value="OPEN">Under treatment</option><option value="FINALIZED">Finalized (recovered)</option><option value="">All</option>
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Case no, patient, MRN, problem" />
        </div>}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No cases" hint={can("visits.create") ? "Open a case when a patient arrives." : undefined} /> : (
          <Table head={["Case", "Patient", "Problem", "Visits", "Last visit", "Doctor", "Status"]}>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td><Link href={`/${portal}/visits/${c.id}`} className="font-medium text-teal-700 hover:underline">{c.case_number}</Link></Td>
                <Td><span className="font-medium text-slate-800">{c.patient.name}</span> <span className="text-xs text-slate-500">{c.patient.mrn}</span></Td>
                <Td className="max-w-xs truncate">{c.title}</Td>
                <Td>{c.visit_count}</Td>
                <Td>{fmtDate(c.last_visit_date)}</Td>
                <Td>{c.last_doctor ?? "—"}</Td>
                <Td><CaseStatus c={c} /></Td>
              </tr>))}
          </Table>
        )}
      </Card>
      {open && <OpenCaseModal onClose={() => setOpen(false)} />}
    </Page>
  );
}

const CaseStatus = ({ c }: { c: Pick<PatientCase, "status"> }) =>
  c.status === "OPEN" ? <Pill tone="amber">Under treatment</Pill> : <Pill tone="emerald">Finalized</Pill>;

export function OpenCaseModal({ onClose, patient: fixed }: { onClose: () => void; patient?: Patient | null }) {
  const portal = usePortal();
  const router = useRouter();
  const [patient, setPatient] = useState<Patient | null>(fixed ?? null);
  const [title, setTitle] = useState("");
  const [complaint, setComplaint] = useState("");
  const { busy, error, run } = useSubmit();
  const submit = () => run(async () => {
    if (!patient) throw new Error("Select the patient.");
    if (title.trim().length < 2) throw new Error("Enter the main problem (e.g. Fever and cough).");
    const c = await api.post<PatientCase>("/visits/cases", { patient_id: patient.id, title, complaint: complaint || null });
    router.push(`/${portal}/visits/${c.id}`);
  });
  return (
    <Modal open onClose={onClose} title="Open new case (Visit 1)"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Open case</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {fixed ? <p className="text-sm text-slate-600">Patient: <b>{fixed.first_name} {fixed.last_name}</b> ({fixed.mrn})</p>
          : <Field label="Patient *" hint="Not found? Register the patient first."><PatientPicker value={patient} onChange={setPatient} autoFocus /></Field>}
        <Field label="Main problem *" hint="Short title for this illness, e.g. Fever and cough"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Problem in the patient's words"><Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- case detail */

export function CaseDetailPage({ caseId }: { caseId: string }) {
  const portal = usePortal();
  const can = useCan();
  const { data: c, error, loading, setData } = useData(() => api.get<PatientCase>(`/visits/cases/${caseId}`), [caseId], { live: ["visits"] });
  const doctors = useData(() => can("visits.read") ? api.get<Doctor[]>("/visits/doctors") : Promise.resolve([] as Doctor[]), []);
  const [finalizing, setFinalizing] = useState(false);
  const [finalNotes, setFinalNotes] = useState("");
  const act = useSubmit();
  if (loading && !c) return <Loading />;
  if (!c) return <Page title="Case"><ErrorBanner message={error ?? "Case not found"} /></Page>;
  const isOpen = c.status === "OPEN";
  const canWrite = isOpen && can("visits.write");

  const addVisit = () => act.run(async () => { setData(await api.post<PatientCase>(`/visits/cases/${c.id}/visits`, {})); });
  const finalize = () => act.run(async () => { setData(await api.post<PatientCase>(`/visits/cases/${c.id}/finalize`, { final_notes: finalNotes || null })); setFinalizing(false); });
  const reopen = () => act.run(async () => { if (window.confirm("Reopen this case so it can be changed again?")) setData(await api.post<PatientCase>(`/visits/cases/${c.id}/reopen`, {})); });

  return (
    <Page title={`${c.case_number} · ${c.title}`}
      subtitle={`${c.patient.name} (${c.patient.mrn}) · opened ${fmtDate(c.opened_at)}${c.opened_by ? ` by ${c.opened_by}` : ""}`}
      actions={<>
        <CaseStatus c={c} />
        {isOpen && can("visits.create") && <Button variant="secondary" icon={<Plus size={16} />} busy={act.busy} onClick={addVisit}>Add next visit</Button>}
        {isOpen && can("visits.finalize") && <Button icon={<CheckCircle2 size={16} />} onClick={() => setFinalizing(true)}>Finalize (recovered)</Button>}
        {!isOpen && can("visits.reopen") && <Button variant="secondary" icon={<RotateCcw size={16} />} busy={act.busy} onClick={reopen}>Reopen</Button>}
      </>}>
      <ErrorBanner message={act.error ?? error} />
      {!isOpen && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>Finalized</b> on {fmtDateTime(c.finalized_at)}{c.finalized_by && ` by ${c.finalized_by}`}. {c.final_notes && <span>Notes: {c.final_notes}</span>}
          <span className="block text-xs text-emerald-700">This case is read-only.</span>
        </div>)}
      <div className="flex items-center gap-2 text-sm"><Link className="text-teal-700 hover:underline" href={`/${portal}/patients/${c.patient.id}`}>Open patient record</Link><span className="text-slate-400">·</span><span className="text-slate-500">{c.patient.phone}</span></div>
      <div className="space-y-6">
        {[...(c.visits ?? [])].reverse().map((v) => (
          <VisitCard key={v.id} visit={v} canWrite={canWrite} doctors={doctors.data ?? []} onSaved={setData} />
        ))}
      </div>
      <Modal open={finalizing} onClose={() => setFinalizing(false)} title="Finalize case: patient recovered"
        footer={<><Button variant="secondary" onClick={() => setFinalizing(false)}>Cancel</Button><Button busy={act.busy} onClick={finalize}>Finalize</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">After finalizing, the visits of this case can no longer be changed. An Admin can reopen it if needed.</p>
          <Field label="Final notes (optional)"><Textarea value={finalNotes} onChange={(e) => setFinalNotes(e.target.value)} placeholder="Recovered fully, no further follow-up needed" /></Field>
        </div>
      </Modal>
    </Page>
  );
}

/* ---------------------------------------------------------------- one visit */

type MedRow = VisitMedicine & { key: number };
let medKey = 0;
const toRows = (m: VisitMedicine[]): MedRow[] => m.map((x) => ({ ...x, key: ++medKey }));

function VisitCard({ visit, canWrite, doctors, onSaved }: { visit: Visit; canWrite: boolean; doctors: Doctor[]; onSaved: (c: PatientCase) => void }) {
  const writer = canWrite;
  const [f, setF] = useState({ complaint: visit.complaint ?? "", analysis: visit.analysis ?? "", notes: visit.notes ?? "",
    follow_up_date: visit.follow_up_date ?? "", doctor_employee_id: visit.doctor_employee_id ?? "" });
  const [meds, setMeds] = useState<MedRow[]>(toRows(visit.medicines));
  const [dirty, setDirty] = useState(false);
  const save = useSubmit();
  // Take server changes (live updates from other users) unless this card has unsaved edits.
  useEffect(() => {
    if (dirty) return;
    setF({ complaint: visit.complaint ?? "", analysis: visit.analysis ?? "", notes: visit.notes ?? "",
      follow_up_date: visit.follow_up_date ?? "", doctor_employee_id: visit.doctor_employee_id ?? "" });
    setMeds(toRows(visit.medicines));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.updated_at, visit.medicines.length]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };

  const submit = () => save.run(async () => {
    const lines = meds.filter((m) => m.name.trim());
    const body = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v])),
      medicines: lines.map(({ key: _k, id: _i, ...m }) => ({ ...m, name: m.name.trim() })) };
    onSaved(await api.patch<PatientCase>(`/visits/${visit.id}`, body));
    setDirty(false);
  });

  const ro = !writer;
  const cnt = visit.attachments.length;
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2"><Stethoscope size={18} className="text-teal-700" />Visit {visit.visit_number}
      <span className="text-sm font-normal text-slate-500">{fmtDateTime(visit.visit_date)}{visit.doctor_name && ` · Dr. ${visit.doctor_name}`}</span></span>}
      actions={writer && <Button icon={<Save size={16} />} busy={save.busy} disabled={!dirty} onClick={submit}>{dirty ? "Save visit" : "Saved"}</Button>}>
      <div className="space-y-5 p-5">
        <ErrorBanner message={save.error} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Problem (what the patient says)"><Textarea value={f.complaint} onChange={set("complaint")} readOnly={ro} /></Field>
          <Field label="Analysis / diagnosis"><Textarea value={f.analysis} onChange={set("analysis")} readOnly={ro} placeholder={ro ? "" : "Examination findings and diagnosis"} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Doctor">
            <Select value={f.doctor_employee_id} onChange={set("doctor_employee_id")} disabled={ro}>
              <option value="">—</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Next visit (follow-up)"><Input type="date" value={f.follow_up_date} onChange={set("follow_up_date")} readOnly={ro} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={set("notes")} readOnly={ro} /></Field>
        </div>
        <MedicinesEditor rows={meds} readOnly={ro} onChange={(r) => { setMeds(r); setDirty(true); }} />
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Medicine slip &amp; lab reports {cnt > 0 && <span className="font-normal text-slate-500">({cnt})</span>}</h3>
          <Attachments visit={visit} canUpload={writer} onChanged={onSaved} />
        </div>
      </div>
    </Card>
  );
}

function MedicinesEditor({ rows, readOnly, onChange }: { rows: MedRow[]; readOnly: boolean; onChange: (r: MedRow[]) => void }) {
  const can = useCan();
  const catalog = useData(() => can("pharmacy.stock.read") || can("visits.write")
    ? api.get<Medicine[]>("/pharmacy/medicines").catch(() => [] as Medicine[]) : Promise.resolve([] as Medicine[]), []);
  const upd = (key: number, patch: Partial<MedRow>) => onChange(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  const listId = "visit-medicine-catalog";
  if (readOnly && !rows.length) return <div><h3 className="mb-1 text-sm font-semibold text-slate-700">Medicines given</h3><p className="text-sm text-slate-500">None recorded.</p></div>;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Medicines given</h3>
      <datalist id={listId}>{catalog.data?.map((m) => <option key={m.id} value={`${m.generic_name}${m.strength ? ` ${m.strength}` : ""}`}>{m.brand_name ?? ""}</option>)}</datalist>
      {readOnly ? (
        <Table head={["Medicine", "Dose", "How often", "For", "Instructions"]}>
          {rows.map((m) => <tr key={m.key}><Td className="font-medium">{m.name}</Td><Td>{m.dosage ?? "—"}</Td><Td>{m.frequency ?? "—"}</Td><Td>{m.duration ?? "—"}</Td><Td>{m.instructions ?? "—"}</Td></tr>)}
        </Table>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.key} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_auto] md:border-0 md:p-0">
              <Input className="col-span-2 md:col-span-1" list={listId} value={m.name} placeholder="Medicine name"
                onChange={(e) => {
                  const match = catalog.data?.find((x) => `${x.generic_name}${x.strength ? ` ${x.strength}` : ""}` === e.target.value);
                  upd(m.key, { name: e.target.value, medicine_id: match?.id ?? null });
                }} aria-label="Medicine" />
              <Input value={m.dosage ?? ""} placeholder="Dose (1 tab)" onChange={(e) => upd(m.key, { dosage: e.target.value })} aria-label="Dose" />
              <Input value={m.frequency ?? ""} placeholder="3 times a day" onChange={(e) => upd(m.key, { frequency: e.target.value })} aria-label="How often" />
              <Input value={m.duration ?? ""} placeholder="5 days" onChange={(e) => upd(m.key, { duration: e.target.value })} aria-label="Duration" />
              <Input value={m.instructions ?? ""} placeholder="After meals" onChange={(e) => upd(m.key, { instructions: e.target.value })} aria-label="Instructions" />
              <button className="justify-self-end rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove medicine" onClick={() => onChange(rows.filter((r) => r.key !== m.key))}><Trash2 size={16} /></button>
            </div>))}
          <Button variant="ghost" icon={<Plus size={16} />} onClick={() => onChange([...rows, { key: ++medKey, medicine_id: null, name: "", dosage: null, frequency: null, duration: null, instructions: null }])}>Add medicine</Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- files */

export function Attachments({ visit, canUpload, onChanged }: { visit: Visit; canUpload: boolean; onChanged?: (c: PatientCase) => void }) {
  const [kind, setKind] = useState<VisitAttachment["kind"]>("SLIP");
  const [uploading, setUploading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; a: VisitAttachment } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !onChanged) return;
    setError(null);
    for (const original of Array.from(files)) {
      setUploading(original.name);
      try {
        const file = await shrinkImage(original);
        const form = new FormData();
        form.append("kind", kind);
        form.append("file", file, file.name);
        onChanged(await api.upload<PatientCase>(`/visits/${visit.id}/attachments`, form));
      } catch (e) {
        setError(`${original.name}: ${(e as Error).message}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (camRef.current) camRef.current.value = "";
  };
  const open = async (a: VisitAttachment) => {
    try {
      const { url } = await api.get<{ url: string }>(`/visits/attachments/${a.id}/url`);
      if (a.content_type.startsWith("image/") && a.content_type !== "image/heic") setPreview({ url, a });
      else window.open(url, "_blank", "noopener");
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (a: VisitAttachment) => {
    if (!onChanged || !window.confirm(`Delete "${a.file_name}"?`)) return;
    try { onChanged(await api.del<PatientCase>(`/visits/attachments/${a.id}`)); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} onClose={() => setError(null)} />
      {visit.attachments.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visit.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border bg-slate-50 p-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-white text-teal-700">{a.content_type === "application/pdf" ? <FileText size={20} /> : <ImageIcon size={20} />}</span>
              <button className="min-w-0 flex-1 text-left" onClick={() => open(a)}>
                <span className="block truncate text-sm font-medium text-teal-800 hover:underline">{a.file_name}</span>
                <span className="block text-xs text-slate-500">{KIND_LABEL[a.kind]} · {(a.size_bytes / 1024).toFixed(0)} KB · {fmtDate(a.created_at)}</span>
              </button>
              {canUpload && <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${a.file_name}`} onClick={() => remove(a)}><Trash2 size={15} /></button>}
            </li>))}
        </ul>
      ) : <p className="text-sm text-slate-500">No files uploaded.</p>}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as VisitAttachment["kind"])} aria-label="File type" className="w-44">
            <option value="SLIP">Medicine slip</option><option value="LAB_REPORT">Lab report</option><option value="OTHER">Other</option>
          </Select>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
          <Button variant="secondary" icon={<Upload size={16} />} disabled={!!uploading} onClick={() => fileRef.current?.click()}>Upload file</Button>
          <Button variant="secondary" icon={<Camera size={16} />} disabled={!!uploading} onClick={() => camRef.current?.click()}>Take photo</Button>
          {uploading && <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" />Uploading {uploading}…</span>}
        </div>
      )}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${KIND_LABEL[preview.a.kind]} · ${preview.a.file_name}` : ""} wide
        footer={preview && <a href={preview.url} target="_blank" rel="noopener noreferrer"><Button variant="secondary">Open full size</Button></a>}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img src={preview.url} alt={preview.a.file_name} className="mx-auto max-h-[70vh] rounded" />}
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- patient record + patient portal */

export function PatientCasesSection({ patient }: { patient: Patient }) {
  const portal = usePortal();
  const can = useCan();
  const { data } = useData(() => can("visits.read") ? api.get<PatientCase[]>(`/visits/cases?patient_id=${patient.id}`) : Promise.resolve(null), [patient.id], { live: ["visits"] });
  const [open, setOpen] = useState(false);
  if (!can("visits.read")) return null;
  return (
    <Card title="Visits & treatment" actions={can("visits.create") && <Button variant="secondary" icon={<ClipboardPlus size={16} />} onClick={() => setOpen(true)}>Open new case</Button>}>
      {!data ? <Loading /> : !data.length ? <Empty title="No visits yet" /> : (
        <Table head={["Case", "Problem", "Visits", "Last visit", "Status"]}>
          {data.map((c) => <tr key={c.id} className="hover:bg-slate-50"><Td><Link className="font-medium text-teal-700 hover:underline" href={`/${portal}/visits/${c.id}`}>{c.case_number}</Link></Td><Td>{c.title}</Td><Td>{c.visit_count}</Td><Td>{fmtDate(c.last_visit_date)}</Td><Td><CaseStatus c={c} /></Td></tr>)}
        </Table>
      )}
      {open && <OpenCaseModal patient={patient} onClose={() => setOpen(false)} />}
    </Card>
  );
}

export function MyVisitsPage() {
  const { data, error, loading } = useData(
    () => api.get<PatientCase[]>("/visits/me").catch((e: { status?: number }) => { if (e.status === 404) return [] as PatientCase[]; throw e; }),
    [], { live: ["visits"] });
  return (
    <Page title="My visits & reports" subtitle="Your treatment at Dua Medical Hospital: visits, medicines and reports.">
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Card><Empty title="No visits yet" /></Card> : data.map((c) => (
        <Card key={c.id} title={<span className="flex flex-wrap items-center gap-2">{c.title} <CaseStatus c={c} /></span>}
          actions={<span className="flex flex-wrap items-center gap-3 text-sm text-slate-500">{c.case_number} · since {fmtDate(c.opened_at)}{c.status === "FINALIZED" && <RateTreatmentLink />}</span>}>
          <div className="divide-y">
            {[...(c.visits ?? [])].reverse().map((v) => (
              <div key={v.id} className="space-y-3 p-5">
                <p className="font-semibold text-slate-800">Visit {v.visit_number} <span className="text-sm font-normal text-slate-500">· {fmtDateTime(v.visit_date)}{v.doctor_name && ` · Dr. ${v.doctor_name}`}</span></p>
                {v.analysis && <p className="text-sm text-slate-700"><b>Doctor&apos;s notes:</b> {v.analysis}</p>}
                {v.medicines.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {v.medicines.map((m, i) => <li key={i}><b>{m.name}</b>{[m.dosage, m.frequency, m.duration && `for ${m.duration}`, m.instructions].filter(Boolean).map((x) => ` · ${x}`).join("")}</li>)}
                  </ul>)}
                {v.follow_up_date && <p className="text-sm text-amber-800">Next visit: {fmtDate(v.follow_up_date)}</p>}
                {v.attachments.length > 0 && <Attachments visit={v} canUpload={false} />}
              </div>))}
          </div>
        </Card>
      ))}
    </Page>
  );
}
