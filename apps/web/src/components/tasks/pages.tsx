"use client";
import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Play, Plus, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/format";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Modal, Page, Pill, SearchInput, Select, Stat, Textarea, useData, useSubmit } from "@/components/ui";

type Task = { id: string; title: string; description: string | null; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; due_date: string | null; overdue: boolean;
  assignee: { user_id: string; name: string | null }; assigned_by: string | null; created_at: string; completed_at: string | null; completion_note: string | null };
type Person = { user_id: string; name: string; designation: string; role: string };

const PRIORITY: Record<Task["priority"], { label: string; tone: "slate" | "teal" | "amber" | "rose" }> = {
  LOW: { label: "Low", tone: "slate" }, NORMAL: { label: "Normal", tone: "teal" }, HIGH: { label: "High", tone: "amber" }, URGENT: { label: "Urgent", tone: "rose" },
};
const STATUS: Record<Task["status"], { label: string; tone: "slate" | "teal" | "amber" | "rose" | "emerald" }> = {
  PENDING: { label: "To do", tone: "amber" }, IN_PROGRESS: { label: "In progress", tone: "teal" }, COMPLETED: { label: "Done", tone: "emerald" }, CANCELLED: { label: "Cancelled", tone: "slate" },
};

function TaskRow({ t, mode, onChanged }: { t: Task; mode: "mine" | "board"; onChanged: () => void }) {
  const [note, setNote] = useState(t.completion_note ?? "");
  const [finishing, setFinishing] = useState(false);
  const { busy, error, run } = useSubmit();
  const set = (status: Task["status"], withNote = false) => run(async () => {
    await api.post(`/tasks/${t.id}/status`, { status, ...(withNote && { note }) }); setFinishing(false); onChanged();
  });
  const open = t.status === "PENDING" || t.status === "IN_PROGRESS";
  return (
    <li className={`space-y-2 px-4 py-3 ${t.status === "COMPLETED" || t.status === "CANCELLED" ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium text-slate-800 ${t.status === "COMPLETED" ? "line-through decoration-slate-400" : ""}`}>{t.title}</p>
          {t.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{t.description}</p>}
          <p className="mt-0.5 text-xs text-slate-500">
            {mode === "board" ? <>For <b>{t.assignee.name}</b> · </> : t.assigned_by && <>From {t.assigned_by} · </>}
            {fmtDate(t.due_date)}{t.overdue && <span className="font-semibold text-rose-700"> · overdue</span>}
            {t.completed_at && <> · done {fmtDateTime(t.completed_at)}</>}
          </p>
          {t.completion_note && !finishing && <p className="mt-1 text-sm text-slate-600">Note: {t.completion_note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><Pill tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Pill><Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill></div>
      </div>
      <ErrorBanner message={error} />
      {open && (
        <div className="flex flex-wrap gap-2">
          {mode === "mine" && t.status === "PENDING" && <Button variant="secondary" icon={<Play size={15} />} busy={busy} onClick={() => set("IN_PROGRESS")}>Start</Button>}
          {mode === "mine" && !finishing && <Button icon={<CheckCircle2 size={15} />} onClick={() => setFinishing(true)}>Mark done</Button>}
          {mode === "board" && <Button variant="ghost" icon={<XCircle size={15} />} busy={busy} onClick={() => window.confirm(`Cancel "${t.title}"?`) && set("CANCELLED")}>Cancel task</Button>}
        </div>)}
      {finishing && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. finished at 10:30" aria-label="Completion note" />
          <div className="flex gap-2"><Button busy={busy} onClick={() => set("COMPLETED", true)}>Done</Button><Button variant="secondary" onClick={() => setFinishing(false)}>Back</Button></div>
        </div>)}
    </li>
  );
}

/* ---------------------------------------------------------------- my tasks (every staff member) */

export function MyTasksList() {
  const [scope, setScope] = useState<"open" | "done">("open");
  const { data, error, loading, reload } = useData(() => api.get<Task[]>(`/tasks/mine?scope=${scope}`), [scope], { live: ["tasks"] });
  const today = todayIso();
  const groups = useMemo(() => {
    const rows = data ?? [];
    if (scope === "done") return [["Finished", rows]] as [string, Task[]][];
    return ([["Overdue", rows.filter((t) => t.overdue)], ["Today", rows.filter((t) => t.due_date === today)],
      ["Upcoming", rows.filter((t) => t.due_date && t.due_date > today)]] as [string, Task[]][]).filter(([, r]) => r.length);
  }, [data, scope, today]);
  return (
    <>
      <div className="flex gap-2" role="tablist">
        {([["open", "To do"], ["done", "Finished"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={scope === k} onClick={() => setScope(k)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${scope === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
      </div>
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !groups.length ? <Card><Empty title={scope === "open" ? "No tasks to do. 🎉" : "Nothing finished yet"} /></Card> : groups.map(([g, rows]) => (
        <Card key={g} title={<span className={g === "Overdue" ? "text-rose-700" : ""}>{g} ({rows.length})</span>}>
          <ul className="divide-y">{rows.map((t) => <TaskRow key={t.id} t={t} mode="mine" onChanged={reload} />)}</ul>
        </Card>))}
    </>
  );
}

export function MyTasksPage() {
  return <Page title="My tasks" subtitle="Tasks assigned to you. Tap Start, then Mark done."><MyTasksList /></Page>;
}

/* ---------------------------------------------------------------- task board (Admin / HR) */

function AssignModal({ onClose, onDone, day }: { onClose: () => void; onDone: () => void; day: string }) {
  const people = useData(() => api.get<Person[]>("/tasks/assignees"), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("NORMAL");
  const [due, setDue] = useState(day < todayIso() ? todayIso() : day);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const { busy, error, run } = useSubmit();
  const shown = (people.data ?? []).filter((p) => !q || `${p.name} ${p.designation} ${p.role}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = () => run(async () => {
    if (title.trim().length < 2) throw new Error("Write what needs to be done.");
    if (!picked.size) throw new Error("Choose at least one person.");
    await api.post("/tasks", { title, description: description || null, priority, due_date: due, assignee_user_ids: [...picked] });
    onDone();
  });
  return (
    <Modal open onClose={onClose} title="Assign task" wide
      footer={<><span className="mr-auto self-center text-sm text-slate-500">{picked.size} selected</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={submit}>Assign</Button></>}>
      <div className="space-y-4">
        <ErrorBanner message={error ?? people.error} />
        <Field label="Task *"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Clean ward 3 before 10 am" autoFocus /></Field>
        <Field label="Details"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><Input type="date" min={todayIso()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>{(Object.keys(PRIORITY) as Task["priority"][]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}</Select></Field>
        </div>
        <Field label="Assign to *" hint="Each person gets their own copy and marks it done separately.">
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Find staff" />
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
              {people.loading && !people.data ? <li><Loading /></li> : shown.map((p) => (
                <li key={p.user_id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={picked.has(p.user_id)} onChange={() => toggle(p.user_id)} />
                  <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{p.name}</span><span className="block text-xs text-slate-500">{p.designation}</span></span>
                </label></li>))}
            </ul>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export function TasksBoardPage() {
  const [tab, setTab] = useState<"board" | "mine">("board");
  const [day, setDay] = useState(todayIso());
  const [who, setWho] = useState("");
  const [assigning, setAssigning] = useState(false);
  const { data, error, loading, reload } = useData(() => api.get<Task[]>(`/tasks?date=${day}`), [day], { live: ["tasks"] });
  const rows = (data ?? []).filter((t) => !who || t.assignee.user_id === who);
  const people = useMemo(() => [...new Map((data ?? []).map((t) => [t.assignee.user_id, t.assignee.name ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const count = (s: Task["status"]) => rows.filter((t) => t.status === s).length;
  return (
    <Page title="Daily tasks" subtitle="Assign tasks to staff and watch them get done, live."
      actions={tab === "board" && <Button icon={<Plus size={16} />} onClick={() => setAssigning(true)}>Assign task</Button>}>
      <div className="flex gap-2" role="tablist">
        {([["board", "Assign & track"], ["mine", "My tasks"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{l}</button>))}
      </div>
      {tab === "mine" ? <MyTasksList /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="To do" value={count("PENDING")} tone="amber" /><Stat label="In progress" value={count("IN_PROGRESS")} />
            <Stat label="Done" value={count("COMPLETED")} tone="emerald" /><Stat label="Overdue" value={rows.filter((t) => t.overdue).length} tone="rose" />
          </div>
          <Card title={<span className="flex items-center gap-2"><ClipboardList size={18} />Tasks for {fmtDate(day)}</span>}
            actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="sm:w-40" aria-label="Date" />
              <Select value={who} onChange={(e) => setWho(e.target.value)} className="sm:w-48" aria-label="Person"><option value="">Everyone</option>{people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
            </div>}>
            <ErrorBanner message={error} />
            {loading && !data ? <Loading /> : !rows.length ? <Empty title="No tasks for this day" action={<Button icon={<Plus size={16} />} onClick={() => setAssigning(true)}>Assign task</Button>} /> : (
              <ul className="divide-y">{rows.map((t) => <TaskRow key={t.id} t={t} mode="board" onChanged={reload} />)}</ul>
            )}
          </Card>
        </>
      )}
      {assigning && <AssignModal day={day} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); reload(); }} />}
    </Page>
  );
}
