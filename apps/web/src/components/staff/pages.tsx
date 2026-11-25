"use client";
import { useState } from "react";
import { Copy, KeyRound, Pencil, RefreshCw, ShieldCheck, UserPlus, UserRoundCheck, UserRoundX } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize, todayIso } from "@/lib/format";
import type { StaffMember, StaffOptions } from "@/lib/types";
import { usePortalUser } from "@/lib/portal-user";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Page, Pill, SearchInput, Select, Stat, Table, Td, Textarea, useData, useDebounced, useSubmit } from "@/components/ui";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", DOCTOR: "Doctor", NURSE: "Nurse", MEDICAL_STORE: "Medical Store", CLEANING_STAFF: "Cleaning",
  ACCOUNTANT: "Accountant", HR: "HR", COUNTER: "Counter",
};
const roleLabel = (r: string | null | undefined) => (r ? ROLE_LABELS[r] ?? humanize(r) : "—");

/** Readable random password (no 0/O, 1/l/I), 14 characters. */
export function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("").replace(/(.{4})(.{5})(.{5})/, "$1-$2-$3");
}

type Form = {
  full_name: string; role: string; department_id: string; designation: string; username: string; password: string;
  cnic: string; phone: string; email: string; address: string; joining_date: string; employment_status: string;
};
const emptyForm = (o?: StaffOptions | null): Form => ({
  full_name: "", role: o?.roles.find((r) => r.name !== "ADMIN")?.name ?? "", department_id: o?.departments[0]?.id ?? "",
  designation: "", username: "", password: generatePassword(), cnic: "", phone: "", email: "", address: "",
  joining_date: todayIso(), employment_status: "ACTIVE",
});

export function StaffPage() {
  const me = usePortalUser();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [show, setShow] = useState<"active" | "inactive" | "all">("active");
  const dq = useDebounced(q);
  const opts = useData(() => api.get<StaffOptions>("/staff/options"), []);
  const list = useData(() => api.get<StaffMember[]>(`/staff?${new URLSearchParams({
    ...(dq && { q: dq }), ...(role && { role }), ...(show !== "all" && { active: String(show === "active") }) })}`),
    [dq, role, show], { live: ["staff"] });
  const [form, setForm] = useState<{ id?: string; v: Form } | null>(null);
  const [created, setCreated] = useState<{ name: string; username: string; password: string } | null>(null);
  const [manage, setManage] = useState<StaffMember | null>(null);
  const can = opts.data?.can;
  const rows = list.data ?? [];

  return (
    <Page title="Staff" subtitle="Register staff with a role. Each person signs in and sees only their own portal."
      actions={can?.create && <Button icon={<UserPlus size={16} />} onClick={() => setForm({ v: emptyForm(opts.data) })}>Register staff</Button>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={show === "inactive" ? "Deactivated staff" : "Staff shown"} value={list.data ? rows.length : "—"} />
        <Stat label="Must change password" value={rows.filter((s) => s.user?.must_change_password).length} tone="amber" />
        <Stat label="Never logged in" value={rows.filter((s) => s.user && !s.user.last_login_at).length} />
      </div>
      <Card title="Staff list" actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className="sm:w-40">
            <option value="">All roles</option>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Status" className="sm:w-36">
            <option value="active">Active</option><option value="inactive">Deactivated</option><option value="all">All</option>
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Name, code, CNIC, phone" />
        </div>}>
        <ErrorBanner message={list.error ?? opts.error} />
        {list.loading && !list.data ? <Loading /> : !rows.length ? (
          <Empty title="No staff found" hint={can?.create ? "Register your first staff member." : undefined}
            action={can?.create && <Button icon={<UserPlus size={16} />} onClick={() => setForm({ v: emptyForm(opts.data) })}>Register staff</Button>} />
        ) : (
          <Table head={["Name", "Role", "Department", "Phone", "CNIC", "Login", "Last login", ""]}>
            {rows.map((s) => (
              <tr key={s.id} className={`hover:bg-slate-50 ${s.user?.is_active === false ? "opacity-60" : ""}`}>
                <Td><span className="font-medium text-slate-800">{s.full_name}</span><span className="block text-xs text-slate-500">{s.employee_code} · {s.designation}</span></Td>
                <Td><Pill tone={s.user?.role === "ADMIN" ? "rose" : "teal"}>{roleLabel(s.user?.role)}</Pill></Td>
                <Td>{s.department.name}</Td>
                <Td>{s.phone ?? "—"}</Td>
                <Td className="font-mono text-xs">{s.cnic ?? "—"}</Td>
                <Td>{s.user ? <span>{s.user.username}{!s.user.is_active ? <Pill tone="rose">Deactivated</Pill> : s.user.must_change_password && <Pill tone="amber">New password</Pill>}</span> : "—"}</Td>
                <Td className="text-xs">{s.user?.last_login_at ? fmtDateTime(s.user.last_login_at) : "Never"}</Td>
                <Td className="text-right">
                  {can?.edit && (me.is_superuser || s.user?.role !== "ADMIN") && (
                    <Button variant="ghost" icon={<Pencil size={15} />} onClick={() => setManage(s)}>Manage</Button>)}
                </Td>
              </tr>))}
          </Table>
        )}
      </Card>

      {form && opts.data && (
        <StaffFormModal options={opts.data} initial={form.v} onClose={() => setForm(null)}
          onCreated={(c) => { setForm(null); setCreated(c); list.reload(); }} />
      )}
      {manage && opts.data && (
        <ManageStaffModal staff={manage} options={opts.data} isSelf={manage.user?.id === me.id}
          onClose={() => setManage(null)} onChanged={(s) => { setManage(s); list.reload(); }} />
      )}
      <Modal open={!!created} onClose={() => setCreated(null)} title="Staff registered"
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
        {created && <CredentialsBox {...created} />}
      </Modal>
    </Page>
  );
}

export function CredentialsBox({ name, username, password }: { name: string; username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Dua Medical HMS login\nName: ${name}\nUsername: ${username}\nPassword: ${password}\n(You will be asked to set your own password at first login.)`;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600"><b>{name}</b> can now sign in. Give them these details privately. They must choose their own password at first login.</p>
      <dl className="space-y-1 rounded-lg border bg-slate-50 p-3 font-mono text-sm">
        <div><dt className="inline text-slate-500">Username: </dt><dd className="inline font-semibold">{username}</dd></div>
        <div><dt className="inline text-slate-500">Password: </dt><dd className="inline font-semibold">{password}</dd></div>
      </dl>
      <Button variant="secondary" icon={<Copy size={16} />} onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? "Copied" : "Copy login details"}</Button>
      <p className="text-xs text-slate-500">This password is not shown again. If it is lost, an Admin can reset it.</p>
    </div>
  );
}

function StaffFields({ v, set, options, creating }: { v: Form; set: (k: keyof Form, val: string) => void; options: StaffOptions; creating: boolean }) {
  const on = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name *"><Input value={v.full_name} onChange={on("full_name")} autoFocus /></Field>
      {creating && <Field label="Role *" hint="Decides which portal they see.">
        <Select value={v.role} onChange={on("role")}>{options.roles.map((r) => <option key={r.name} value={r.name}>{roleLabel(r.name)}</option>)}</Select>
      </Field>}
      <Field label="Department *"><Select value={v.department_id} onChange={on("department_id")}>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Designation *"><Input value={v.designation} onChange={on("designation")} placeholder="Staff Nurse, Store Keeper..." /></Field>
      <Field label="CNIC" hint="13 digits, e.g. 35202-1234567-1"><Input value={v.cnic} onChange={on("cnic")} inputMode="numeric" /></Field>
      <Field label="Phone *"><Input value={v.phone} onChange={on("phone")} inputMode="tel" placeholder="03001234567" /></Field>
      <Field label="Email" hint="Optional. They can also sign in with it."><Input type="email" value={v.email} onChange={on("email")} /></Field>
      <Field label="Joining date"><Input type="date" value={v.joining_date} onChange={on("joining_date")} /></Field>
      {!creating && <Field label="Employment status"><Select value={v.employment_status} onChange={on("employment_status")}>{options.statuses.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>}
      <Field label="Address" className="sm:col-span-2"><Textarea value={v.address} onChange={on("address")} /></Field>
      {creating && <>
        <Field label="Username *" hint="Used to sign in. No spaces."><Input value={v.username} onChange={on("username")} autoComplete="off" /></Field>
        <Field label="First password *" hint="At least 12 characters. They change it at first login.">
          <div className="flex gap-2"><Input value={v.password} onChange={on("password")} autoComplete="new-password" className="font-mono" />
            <Button type="button" variant="secondary" aria-label="Generate password" onClick={() => set("password", generatePassword())}><RefreshCw size={16} /></Button></div>
        </Field>
      </>}
    </div>
  );
}

const toBody = (v: Partial<Form>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x]));

function StaffFormModal({ options, initial, onClose, onCreated }: { options: StaffOptions; initial: Form; onClose: () => void; onCreated: (c: { name: string; username: string; password: string }) => void }) {
  const [v, setV] = useState(initial);
  const { busy, error, run } = useSubmit();
  const set = (k: keyof Form, val: string) => setV((f) => {
    const next = { ...f, [k]: val };
    // Suggest a username from the name until the user types one.
    if (k === "full_name" && (!f.username || f.username === suggest(f.full_name))) next.username = suggest(val);
    return next;
  });
  const submit = () => run(async () => {
    if (!v.full_name.trim() || !v.designation.trim() || !v.username.trim() || !v.phone.trim()) throw new Error("Fill in name, designation, phone and username.");
    const { employment_status: _e, ...body } = v;
    const s = await api.post<StaffMember>("/staff", toBody(body));
    onCreated({ name: s.full_name, username: s.user?.username ?? v.username, password: v.password });
  });
  return (
    <Modal open onClose={onClose} title="Register staff" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Register &amp; create login</Button></>}>
      <div className="space-y-4"><ErrorBanner message={error} /><StaffFields v={v} set={set} options={options} creating /></div>
    </Modal>
  );
}

const suggest = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");

function ManageStaffModal({ staff, options, isSelf, onClose, onChanged }: { staff: StaffMember; options: StaffOptions; isSelf: boolean; onClose: () => void; onChanged: (s: StaffMember) => void }) {
  const [v, setV] = useState<Form>({ ...emptyForm(options), full_name: staff.full_name, department_id: staff.department.id,
    designation: staff.designation, cnic: staff.cnic ?? "", phone: staff.phone ?? "", email: staff.user?.email ?? "",
    address: staff.address ?? "", joining_date: staff.joining_date ?? "", employment_status: staff.employment_status, role: staff.user?.role ?? "" });
  const [newRole, setNewRole] = useState(staff.user?.role ?? "");
  const [resetPw, setResetPw] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useSubmit();
  const can = options.can;
  const done = (s: StaffMember, msg: string) => { onChanged(s); setNotice(msg); };

  const save = () => run(async () => {
    const { full_name, department_id, designation, cnic, phone, email, address, joining_date, employment_status } = v;
    done(await api.patch<StaffMember>(`/staff/${staff.id}`, toBody({ full_name, department_id, designation, cnic, phone, email, address, joining_date, employment_status })), "Details saved.");
  });
  const changeRole = () => run(async () => {
    if (!window.confirm(`Change ${staff.full_name}'s role to ${roleLabel(newRole)}? They will be signed out and see the ${roleLabel(newRole)} portal next time.`)) return;
    done(await api.put<StaffMember>(`/staff/${staff.id}/role`, { role: newRole }), `Role changed to ${roleLabel(newRole)}.`);
  });
  const toggle = () => run(async () => {
    const activate = !staff.user?.is_active;
    if (!activate && !window.confirm(`Deactivate ${staff.full_name}? They will be signed out and cannot log in. Their records stay.`)) return;
    done(await api.put<StaffMember>(`/staff/${staff.id}/status`, { is_active: activate }), activate ? "Account activated." : "Account deactivated.");
  });
  const reset = () => run(async () => {
    const pw = generatePassword();
    if (!window.confirm(`Reset ${staff.full_name}'s password? They will be signed out everywhere.`)) return;
    await api.post(`/staff/${staff.id}/reset-password`, { password: pw });
    setResetPw(pw); setNotice(null);
  });

  return (
    <Modal open onClose={onClose} title={`${staff.full_name} · ${staff.employee_code}`} wide
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{can.edit && <Button busy={busy} onClick={save}>Save details</Button>}</>}>
      <div className="space-y-5">
        <ErrorBanner message={error} />
        {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        <StaffFields v={v} set={(k, val) => setV((f) => ({ ...f, [k]: val }))} options={options} creating={false} />
        {staff.user && (can.change_role || can.deactivate || can.reset_password) && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck size={18} />Login &amp; access <span className="text-sm font-normal text-slate-500">({staff.user.username})</span></h3>
            {can.change_role && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field label="Role" className="sm:w-60"><Select value={newRole} onChange={(e) => setNewRole(e.target.value)} disabled={isSelf}>{options.roles.map((r) => <option key={r.name} value={r.name}>{roleLabel(r.name)}</option>)}</Select></Field>
                <Button variant="secondary" disabled={isSelf || newRole === staff.user.role} busy={busy} onClick={changeRole}>Change role</Button>
              </div>)}
            <div className="flex flex-wrap gap-2">
              {can.reset_password && <Button variant="secondary" icon={<KeyRound size={16} />} busy={busy} onClick={reset}>Reset password</Button>}
              {can.deactivate && !isSelf && (staff.user.is_active
                ? <Button variant="danger" icon={<UserRoundX size={16} />} busy={busy} onClick={toggle}>Deactivate account</Button>
                : <Button icon={<UserRoundCheck size={16} />} busy={busy} onClick={toggle}>Activate account</Button>)}
            </div>
            {isSelf && <p className="text-xs text-slate-500">You cannot change your own role or deactivate yourself.</p>}
            {resetPw && <CredentialsBox name={staff.full_name} username={staff.user.username} password={resetPw} />}
            <p className="text-xs text-slate-500">Joined {fmtDate(staff.joining_date)} · Last login {staff.user.last_login_at ? fmtDateTime(staff.user.last_login_at) : "never"}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
