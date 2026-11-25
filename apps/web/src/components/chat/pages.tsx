"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCheck, MessageSquarePlus, Send } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useLive } from "@/lib/realtime";
import { Button, Empty, ErrorBanner, Loading, Modal, Page, Pill, SearchInput, useData, useDebounced } from "@/components/ui";

type Person = { user_id: string; name: string; role: string | null; active: boolean; detail?: string };
type Conv = { id: string; with: Person; last_message: { body: string; created_at: string; mine: boolean } | null; unread: number };
type Msg = { id: string; body: string; created_at: string; mine: boolean; sender_id: string; pending?: boolean };
type Thread = { messages: Msg[]; has_more: boolean; other_last_read_at: string | null; can_send: boolean };

const ROLE: Record<string, string> = { DOCTOR: "Doctor", PATIENT: "Patient", ADMIN: "Admin", HR: "HR", NURSE: "Nurse" };
const time = new Intl.DateTimeFormat("en-PK", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" });
const shortWhen = (iso: string) => (dayKey.format(new Date(iso)) === dayKey.format(new Date()) ? time.format(new Date(iso)) : fmtDate(iso));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

function Avatar({ p }: { p: Person }) {
  const tone = p.role === "PATIENT" ? "bg-amber-100 text-amber-800" : p.role === "DOCTOR" ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-slate-700";
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${tone}`}>{initials(p.name)}</span>;
}

export function ChatPage() {
  const convs = useData(() => api.get<Conv[]>("/chat/conversations"), [], { live: ["chat"] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const active = convs.data?.find((c) => c.id === activeId) ?? null;

  const startWith = async (p: Person) => {
    const c = await api.post<{ id: string }>("/chat/conversations", { user_id: p.user_id });
    setPicking(false);
    convs.reload();
    setActiveId(c.id);
  };

  return (
    <Page title="Chat" subtitle="Messages update live. Patients can message their doctor and the hospital admin.">
      <ErrorBanner message={convs.error} />
      <div className="grid h-[calc(100vh-14rem)] min-h-[28rem] overflow-hidden rounded-xl border bg-white shadow-sm md:grid-cols-[20rem_1fr]">
        {/* conversation list */}
        <aside className={`flex min-h-0 flex-col border-r ${activeId ? "hidden md:flex" : "flex"}`}>
          <div className="flex items-center justify-between border-b p-3">
            <span className="font-semibold text-slate-800">Conversations</span>
            <Button variant="secondary" icon={<MessageSquarePlus size={16} />} onClick={() => setPicking(true)}>New chat</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {convs.loading && !convs.data ? <Loading /> : !convs.data?.length ? (
              <Empty title="No conversations yet" action={<Button onClick={() => setPicking(true)}>Start a chat</Button>} />
            ) : convs.data.map((c) => (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left hover:bg-slate-50 ${c.id === activeId ? "bg-teal-50" : ""}`}>
                <Avatar p={c.with} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{c.with.name}</span>
                    {c.last_message && <span className="shrink-0 text-xs text-slate-400">{shortWhen(c.last_message.created_at)}</span>}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? "font-semibold text-slate-800" : "text-slate-500"}`}>
                      {c.last_message ? `${c.last_message.mine ? "You: " : ""}${c.last_message.body}` : <i>{ROLE[c.with.role ?? ""] ?? ""}</i>}
                    </span>
                    {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white">{c.unread}</span>}
                  </span>
                </span>
              </button>))}
          </div>
        </aside>
        {/* thread */}
        <section className={`min-h-0 flex-col ${activeId ? "flex" : "hidden md:flex"}`}>
          {active ? <ThreadView key={active.id} conv={active} onBack={() => setActiveId(null)} onActivity={convs.reload} />
            : <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">Choose a conversation or start a new chat.</div>}
        </section>
      </div>
      {picking && <ContactPicker onClose={() => setPicking(false)} onPick={startWith} />}
    </Page>
  );
}

function ContactPicker({ onClose, onPick }: { onClose: () => void; onPick: (p: Person) => Promise<void> }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading } = useData(() => api.get<Person[]>(`/chat/contacts${dq ? `?q=${encodeURIComponent(dq)}` : ""}`), [dq]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New chat">
      <div className="space-y-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or MRN" />
        <ErrorBanner message={error ?? err} />
        {loading && !data ? <Loading /> : !data?.length ? <Empty title="No one found" hint="You can only message the people your role is allowed to chat with." /> : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border">
            {data.map((p) => (
              <li key={p.user_id}>
                <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-teal-50" onClick={() => onPick(p).catch((e: Error) => setErr(e.message))}>
                  <Avatar p={p} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{p.name}</span>{p.detail && <span className="block truncate text-xs text-slate-500">{p.detail}</span>}</span>
                  <Pill tone={p.role === "PATIENT" ? "amber" : "teal"}>{ROLE[p.role ?? ""] ?? p.role}</Pill>
                </button>
              </li>))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function ThreadView({ conv, onBack, onActivity }: { conv: Conv; onBack: () => void; onActivity: () => void }) {
  const thread = useData(() => api.get<Thread>(`/chat/conversations/${conv.id}/messages`), [conv.id]);
  const [pending, setPending] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useLive(["chat"], thread.reload, 250);

  const msgs = useMemo(() => [...(thread.data?.messages ?? []), ...pending], [thread.data, pending]);
  const lastMsgId = msgs[msgs.length - 1]?.id;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lastMsgId]);
  // Opening the thread / receiving a message marks it read.
  const lastFromOther = [...(thread.data?.messages ?? [])].reverse().find((m) => !m.mine)?.id;
  useEffect(() => {
    if (!lastFromOther) return;
    api.post(`/chat/conversations/${conv.id}/read`, {}).then(onActivity).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, lastFromOther]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const temp: Msg = { id: `tmp-${Date.now()}`, body, created_at: new Date().toISOString(), mine: true, sender_id: "", pending: true };
    setPending((p) => [...p, temp]); setText(""); setError(null);
    try {
      await api.post<Msg>(`/chat/conversations/${conv.id}/messages`, { body });
      thread.reload(); onActivity();
    } catch (e) {
      setError((e as Error).message); setText(body);
    } finally {
      setPending((p) => p.filter((m) => m.id !== temp.id));
    }
  };

  const seenAt = thread.data?.other_last_read_at;
  const lastMine = [...msgs].reverse().find((m) => m.mine && !m.pending);
  let lastDay = "";
  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 py-2.5">
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={20} /></button>
        <Avatar p={conv.with} />
        <div className="min-w-0"><p className="truncate font-semibold text-slate-800">{conv.with.name}</p><p className="truncate text-xs text-slate-500">{ROLE[conv.with.role ?? ""] ?? ""}{conv.with.detail ? ` · ${conv.with.detail}` : ""}</p></div>
      </header>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-slate-50 px-3 py-4">
        {thread.loading && !thread.data ? <Loading /> : !msgs.length ? <p className="py-10 text-center text-sm text-slate-500">No messages yet. Say hello 👋</p> : msgs.map((m) => {
          const d = dayKey.format(new Date(m.created_at));
          const sep = d !== lastDay ? (lastDay = d, <div key={`d-${d}`} className="py-2 text-center text-xs font-medium text-slate-400">{fmtDate(m.created_at)}</div>) : null;
          return (
            <div key={m.id}>
              {sep}
              <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm shadow-sm ${m.mine ? "rounded-br-sm bg-teal-700 text-white" : "rounded-bl-sm bg-white text-slate-800"} ${m.pending ? "opacity-60" : ""}`}>
                  {m.body}
                  <span className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${m.mine ? "text-teal-100" : "text-slate-400"}`}>
                    {time.format(new Date(m.created_at))}
                    {m.mine && (m.pending ? "…" : m.id === lastMine?.id && seenAt && seenAt >= m.created_at ? <CheckCheck size={14} aria-label="Seen" /> : <Check size={14} aria-label="Sent" />)}
                  </span>
                </div>
              </div>
            </div>);
        })}
        <div ref={bottom} />
      </div>
      <footer className="border-t p-3">
        <ErrorBanner message={error} onClose={() => setError(null)} />
        {thread.data && !thread.data.can_send ? <p className="text-center text-sm text-slate-500">You can no longer send messages in this conversation.</p> : (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Type a message"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20" aria-label="Message" />
            <Button type="submit" icon={<Send size={16} />} disabled={!text.trim()}>Send</Button>
          </form>
        )}
      </footer>
    </>
  );
}

/** Unread-message count for the sidebar badge (live). */
export function useChatUnread(enabled: boolean) {
  const { data, reload } = useData(() => enabled ? api.get<{ unread: number }>("/chat/unread").catch(() => ({ unread: 0 })) : Promise.resolve({ unread: 0 }), [enabled]);
  useLive(enabled ? ["chat"] : undefined, reload, 500);
  return data?.unread ?? 0;
}
