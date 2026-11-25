"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { KeyRound, Pencil, RefreshCw, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, humanize } from "@/lib/format";
import { findLink } from "@/config/portals";
import { patientName, type Account, type Patient } from "@/lib/types";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Page, Pill, SearchInput, Select, Table, Td, Textarea, useCan, useData, useDebounced, useSubmit } from "@/components/ui";
import { AccountView } from "@/components/billing/pages";
import { PatientCasesSection } from "@/components/visits/pages";
import { CredentialsBox, generatePassword } from "@/components/staff/pages";

const ageText = (p: Pick<Patient, "age">) => (p.age === null || p.age === undefined ? null : `${p.age} yrs`);

export function PatientsPage() {
  const { portal } = useParams<{ portal: string }>();
  const can = useCan();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading } = useData(() => api.get<Patient[]>(`/patients?limit=100${dq ? `&q=${encodeURIComponent(dq)}` : ""}`), [dq], { live: ["patients"] });
  const registerSlug = findLink(portal, "patients/new") ? "patients/new" : "patients/register";
  return (
    <Page title="Patients" subtitle="Search by MRN, name or phone number."
      actions={can("patients.create") && <Link href={`/${portal}/${registerSlug}`}><Button icon={<UserPlus size={16} />}>Register patient</Button></Link>}>
      <Card actions={<SearchInput value={q} onChange={setQ} placeholder="MRN, name or phone" />} title={data ? `${data.length} patients${dq ? " found" : " (most recent)"}` : "Patients"}>
        <ErrorBanner message={error} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No patients found" /> : (
          <Table head={["MRN", "Name", "Gender / age", "Phone", "Portal login", "Registered"]}>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{p.mrn}</Td>
                <Td><Link href={`/${portal}/patients/${p.id}`} className="font-medium text-teal-700 hover:underline">{patientName(p)}</Link></Td>
                <Td>{[p.gender && humanize(p.gender), ageText(p)].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>{p.phone}</Td>
                <Td>{p.login_username ? <Pill tone="teal">{p.login_username}</Pill> : <span className="text-xs text-slate-400">No login</span>}</Td>
                <Td>{fmtDate(p.created_at)}</Td>
              </tr>))}
          </Table>
        )}
      </Card>
    </Page>
  );
}

type FormState = { first_name: string; last_name: string; gender: string; age: string; blood_group: string; phone: string; email: string; address: string; mrn?: string };
const emptyForm: FormState = { first_name: "", last_name: "", gender: "", age: "", blood_group: "", phone: "", email: "", address: "", mrn: "" };
const toPayload = (f: FormState) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : k === "age" ? Number(v) : v]));
const suggestUsername = (f: FormState) => `${f.first_name}.${f.last_name || f.phone.slice(-4)}`.trim().toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/^\.|\.$/g, "");

function PatientForm({ value, onChange, showMrn }: { value: FormState; onChange: (f: FormState) => void; showMrn?: boolean }) {
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="First name *"><Input value={value.first_name} onChange={set("first_name")} required autoFocus /></Field>
      <Field label="Last name"><Input value={value.last_name} onChange={set("last_name")} /></Field>
      <Field label="Phone *" hint="e.g. 03001234567"><Input value={value.phone} onChange={set("phone")} inputMode="tel" required /></Field>
      <Field label="Age (years)"><Input type="number" min={0} max={130} inputMode="numeric" value={value.age} onChange={set("age")} /></Field>
      <Field label="Gender"><Select value={value.gender} onChange={set("gender")}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
      <Field label="Blood group"><Select value={value.blood_group} onChange={set("blood_group")}><option value="">—</option>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}</Select></Field>
      <Field label="Email" hint="Optional. The patient can also sign in with it."><Input type="email" value={value.email} onChange={set("email")} /></Field>
      {showMrn && <Field label="MRN" hint="Leave empty to generate automatically"><Input value={value.mrn} onChange={set("mrn")} /></Field>}
      <Field label="Address" className="sm:col-span-2"><Textarea value={value.address} onChange={set("address")} /></Field>
    </div>
  );
}

function LoginFields({ username, password, onUsername, onPassword }: { username: string; password: string; onUsername: (v: string) => void; onPassword: (v: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Username *" hint="Letters, numbers, dots. They can also sign in with their email."><Input value={username} onChange={(e) => onUsername(e.target.value)} autoComplete="off" /></Field>
      <Field label="First password *" hint="At least 12 characters. They change it at first login.">
        <div className="flex gap-2"><Input value={password} onChange={(e) => onPassword(e.target.value)} className="font-mono" autoComplete="new-password" />
          <Button type="button" variant="secondary" aria-label="Generate password" onClick={() => onPassword(generatePassword())}><RefreshCw size={16} /></Button></div>
      </Field>
    </div>
  );
}

export function RegisterPatientPage() {
  const { portal } = useParams<{ portal: string }>();
  const router = useRouter();
  const can = useCan();
  const canLogin = can("patients.portal.manage");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [withLogin, setWithLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState(generatePassword());
  const [created, setCreated] = useState<{ patient: Patient; password: string } | null>(null);
  const { busy, error, run } = useSubmit();
  const shownUsername = usernameTouched ? username : suggestUsername(form);

  const submit = (e: React.FormEvent) => { e.preventDefault(); run(async () => {
    const login = withLogin ? { username: shownUsername, password } : null;
    if (login && login.username.length < 3) throw new Error("Enter a username for the portal login.");
    const p = await api.post<Patient>("/patients", { ...toPayload(form), login });
    if (login) setCreated({ patient: p, password });
    else router.push(`/${portal}/patients/${p.id}?registered=1`);
  }); };
  const reset = () => { setForm(emptyForm); setWithLogin(false); setUsername(""); setUsernameTouched(false); setPassword(generatePassword()); };

  return (
    <Page title="Register patient" subtitle="Creates the patient record, issues an MRN and (optionally) a portal login.">
      <Card>
        <form onSubmit={submit} className="space-y-5 p-5">
          <ErrorBanner message={error} />
          <PatientForm value={form} onChange={setForm} showMrn />
          {canLogin && (
            <div className="space-y-4 rounded-xl border border-slate-200 p-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} />
                Create patient portal login <span className="font-normal text-slate-500">(see reports and dues, chat with doctor)</span>
              </label>
              {withLogin && <LoginFields username={shownUsername} password={password}
                onUsername={(v) => { setUsername(v); setUsernameTouched(true); }} onPassword={setPassword} />}
            </div>
          )}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={reset}>Clear</Button><Button type="submit" busy={busy}>Register patient</Button></div>
        </form>
      </Card>
      <Modal open={!!created} onClose={() => created && router.push(`/${portal}/patients/${created.patient.id}?registered=1`)} title={`Patient registered · ${created?.patient.mrn ?? ""}`}
        footer={<Button onClick={() => created && router.push(`/${portal}/patients/${created.patient.id}?registered=1`)}>Open patient record</Button>}>
        {created && <CredentialsBox name={patientName(created.patient)} username={created.patient.login_username ?? shownUsername} password={created.password} />}
      </Modal>
    </Page>
  );
}

function PortalLoginCard({ patient, onChanged }: { patient: Patient; onChanged: () => void }) {
  const [mode, setMode] = useState<"create" | "reset" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(generatePassword());
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null);
  const { busy, error, run } = useSubmit();
  const start = (m: "create" | "reset") => {
    setMode(m); setShown(null); setPassword(generatePassword());
    setUsername(`${patient.first_name}.${patient.last_name || patient.phone.slice(-4)}`.toLowerCase().replace(/[^a-z0-9.]/g, ""));
  };
  const submit = () => run(async () => {
    if (mode === "create") {
      const p = await api.post<Patient>(`/patients/${patient.id}/login`, { username, password });
      setShown({ username: p.login_username ?? username, password });
    } else {
      if (!window.confirm("Reset this patient's password? They will be signed out.")) return;
      await api.post(`/patients/${patient.id}/login/reset-password`, { password });
      setShown({ username: patient.login_username ?? "", password });
    }
    setMode(null); onChanged();
  });
  return (
    <Card title="Patient portal login" actions={patient.login_username
      ? <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => start("reset")}>Reset password</Button>
      : <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => start("create")}>Create login</Button>}>
      <div className="space-y-4 p-5">
        <ErrorBanner message={error} />
        <p className="text-sm text-slate-600">{patient.login_username
          ? <>Signs in as <b>{patient.login_username}</b>{patient.email && <> or <b>{patient.email}</b></>}. {patient.login_active === false && <Pill tone="rose">Deactivated</Pill>}</>
          : "No login yet. With a login the patient can see their visits, reports and dues, and chat with their doctor."}</p>
        {mode && (
          <div className="space-y-3 rounded-lg border p-4">
            {mode === "create" ? <LoginFields username={username} password={password} onUsername={setUsername} onPassword={setPassword} />
              : <Field label="New password" hint="At least 12 characters. They change it at next login."><div className="flex gap-2"><Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" /><Button type="button" variant="secondary" aria-label="Generate password" onClick={() => setPassword(generatePassword())}><RefreshCw size={16} /></Button></div></Field>}
            <div className="flex gap-2"><Button busy={busy} onClick={submit}>{mode === "create" ? "Create login" : "Reset password"}</Button><Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button></div>
          </div>)}
        {shown && <CredentialsBox name={patientName(patient)} username={shown.username} password={shown.password} />}
      </div>
    </Card>
  );
}

export function PatientDetailPage({ patientId }: { patientId: string }) {
  const can = useCan();
  const { data: p, error, loading, reload } = useData(() => api.get<Patient>(`/patients/${patientId}`), [patientId], { live: ["patients"] });
  const canBilling = can("billing.read");
  const acct = useData(() => canBilling ? api.get<Account>(`/billing/patients/${patientId}/account`) : Promise.resolve(null), [patientId, canBilling], { live: ["billing"] });
  const [editing, setEditing] = useState<FormState | null>(null);
  const { busy, error: saveErr, run } = useSubmit();
  const registered = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("registered");

  if (loading && !p) return <Loading />;
  if (error || !p) return <Page title="Patient"><ErrorBanner message={error ?? "Patient not found"} /></Page>;
  const save = () => run(async () => { const { mrn: _mrn, ...rest } = editing!; await api.patch(`/patients/${p.id}`, toPayload(rest as FormState)); setEditing(null); reload(); });
  const info: [string, string][] = [
    ["MRN", p.mrn], ["Phone", p.phone], ["Gender", p.gender ? humanize(p.gender) : "—"], ["Age", ageText(p) ?? "—"],
    ["Blood group", p.blood_group ?? "—"], ["Email", p.email ?? "—"], ["Address", p.address ?? "—"], ["Registered", fmtDate(p.created_at)],
  ];
  const editForm = (): FormState => ({ first_name: p.first_name, last_name: p.last_name ?? "", gender: p.gender ?? "", age: p.age?.toString() ?? "",
    blood_group: p.blood_group ?? "", phone: p.phone, email: p.email ?? "", address: p.address ?? "" });
  return (
    <Page title={patientName(p)} subtitle={`MRN ${p.mrn}`}
      actions={can("patients.update") && <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => setEditing(editForm())}>Edit details</Button>}>
      {registered && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Patient registered successfully. MRN <b>{p.mrn}</b>.</div>}
      <Card title="Profile">
        <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {info.map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-sm text-slate-800">{v}</dd></div>)}
        </dl>
      </Card>
      {can("patients.portal.manage") && <PortalLoginCard patient={p} onChanged={reload} />}
      <PatientCasesSection patient={p} />
      {canBilling && (acct.loading && !acct.data ? <Loading label="Loading account..." /> : acct.data &&
        <AccountView account={acct.data} allowCollect={can("billing.payments.create")} onChanged={acct.reload} />)}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit patient" wide
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button busy={busy} onClick={save}>Save changes</Button></>}>
        <ErrorBanner message={saveErr} />
        {editing && <div className="mt-3"><PatientForm value={editing} onChange={setEditing} /></div>}
      </Modal>
    </Page>
  );
}
