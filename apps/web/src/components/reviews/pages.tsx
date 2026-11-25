"use client";
import Link from "next/link";
import { useState } from "react";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Button, Card, Empty, ErrorBanner, Loading, Page, Pill, SearchInput, Select, Textarea, useData, useDebounced, useSubmit } from "@/components/ui";

type Review = { rating: number; comment: string | null; created_at: string; updated_at: string | null };
type MyCase = { case_id: string; case_number: string; title: string; status: "OPEN" | "FINALIZED"; finalized_at: string | null;
  visit_count: number; doctor_name: string | null; can_review: boolean; review: Review | null };
type AdminReview = Review & { id: string; patient: { id: string; name: string; mrn: string }; case: { id: string; case_number: string; title: string }; doctor_name: string | null };
type AdminData = { summary: { count: number; average: number | null; distribution: Record<string, number> }; reviews: AdminReview[] };

const LABELS = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

export function Stars({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-slate-300"} aria-hidden />)}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <div className="flex" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? "s" : ""}: ${LABELS[i]}`}
            onMouseEnter={() => setHover(i)} onClick={() => onChange(i)} className="p-1">
            <Star size={32} className={i <= shown ? "fill-amber-400 text-amber-400" : "text-slate-300 hover:text-amber-300"} aria-hidden />
          </button>))}
      </div>
      <span className="text-sm font-medium text-slate-600">{shown ? LABELS[shown] : "Tap a star"}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- patient */

function ReviewForm({ c, onSaved }: { c: MyCase; onSaved: () => void }) {
  const [rating, setRating] = useState(c.review?.rating ?? 0);
  const [comment, setComment] = useState(c.review?.comment ?? "");
  const [editing, setEditing] = useState(!c.review);
  const [thanks, setThanks] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = () => run(async () => {
    if (!rating) throw new Error("Please choose 1 to 5 stars.");
    await api.put(`/reviews/me/${c.case_id}`, { rating, comment: comment || null });
    setEditing(false); setThanks(true); onSaved();
  });
  if (!editing && c.review) return (
    <div className="space-y-2">
      {thanks && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Thank you for your feedback!</p>}
      <div className="flex items-center gap-2"><Stars value={c.review.rating} /><span className="text-sm text-slate-600">{LABELS[c.review.rating]}</span></div>
      {c.review.comment && <p className="whitespace-pre-wrap text-sm text-slate-700">&ldquo;{c.review.comment}&rdquo;</p>}
      <Button variant="secondary" onClick={() => { setEditing(true); setThanks(false); }}>Edit my review</Button>
    </div>
  );
  return (
    <div className="space-y-3">
      <ErrorBanner message={error} />
      <StarPicker value={rating} onChange={setRating} />
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Tell us about your treatment and experience (optional)" aria-label="Your comment" />
      <div className="flex gap-2">
        <Button busy={busy} onClick={submit}>{c.review ? "Update review" : "Submit review"}</Button>
        {c.review && <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
      <p className="text-xs text-slate-500">Only the hospital administration can read your review.</p>
    </div>
  );
}

export function MyReviewsPage() {
  const { data, error, loading, reload } = useData(
    () => api.get<MyCase[]>("/reviews/me").catch((e: { status?: number }) => { if (e.status === 404) return [] as MyCase[]; throw e; }), []);
  const finished = (data ?? []).filter((c) => c.can_review);
  const ongoing = (data ?? []).filter((c) => !c.can_review);
  return (
    <Page title="Review your treatment" subtitle="Your feedback helps Dua Medical Hospital improve. Only the administration reads it.">
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Card><Empty title="No treatments yet" hint="You can review a treatment after it is finished." /></Card> : (
        <>
          {finished.map((c) => (
            <Card key={c.case_id} title={<span className="flex flex-wrap items-center gap-2">{c.title} {c.review ? <Pill tone="emerald">Reviewed</Pill> : <Pill tone="amber">Waiting for your review</Pill>}</span>}
              actions={<span className="text-sm text-slate-500">{c.case_number} · finished {fmtDate(c.finalized_at)}{c.doctor_name && ` · Dr. ${c.doctor_name}`}</span>}>
              <div className="p-5"><ReviewForm c={c} onSaved={reload} /></div>
            </Card>))}
          {ongoing.length > 0 && (
            <Card title="Treatment in progress">
              <ul className="divide-y">
                {ongoing.map((c) => <li key={c.case_id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span><b>{c.title}</b> <span className="text-slate-500">· {c.case_number}</span></span><span className="text-slate-500">You can review it when it is finished.</span></li>)}
              </ul>
            </Card>)}
        </>
      )}
    </Page>
  );
}

export function RateTreatmentLink() {
  return <Link href="/patient/reviews" className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline"><Star size={15} className="fill-amber-400 text-amber-400" aria-hidden />Rate this treatment</Link>;
}

/* ---------------------------------------------------------------- admin */

export function AdminReviewsPage() {
  const [stars, setStars] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, error, loading } = useData(() => api.get<AdminData>(`/reviews?${new URLSearchParams({ ...(stars && { rating: stars }), ...(dq && { q: dq }) })}`),
    [stars, dq], { live: ["reviews"] });
  const s = data?.summary;
  const max = Math.max(1, ...Object.values(s?.distribution ?? {}));
  return (
    <Page title="Patient reviews" subtitle="What patients say after their treatment. Visible to Admin only.">
      <ErrorBanner message={error} />
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <Card>
          <div className="space-y-2 p-5 text-center">
            <p className="text-sm text-slate-500">Average rating</p>
            <p className="text-4xl font-bold text-slate-900 tabular-nums">{s?.average != null ? s.average.toFixed(1) : "—"}</p>
            <Stars value={s?.average ?? 0} size={22} />
            <p className="text-sm text-slate-500">{s ? `${s.count} review${s.count === 1 ? "" : "s"}` : ""}</p>
          </div>
        </Card>
        <Card title="Ratings">
          <div className="space-y-2 p-5">
            {["5", "4", "3", "2", "1"].map((k) => (
              <button key={k} onClick={() => setStars(stars === k ? "" : k)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1 text-sm hover:bg-slate-50 ${stars === k ? "bg-amber-50" : ""}`}>
                <span className="w-14 text-left font-medium text-slate-700">{k} star{k === "1" ? "" : "s"}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${((s?.distribution[k] ?? 0) / max) * 100}%` }} /></span>
                <span className="w-8 text-right tabular-nums text-slate-600">{s?.distribution[k] ?? 0}</span>
              </button>))}
          </div>
        </Card>
      </div>
      <Card title={data ? `${data.reviews.length} review${data.reviews.length === 1 ? "" : "s"}${stars ? ` with ${stars} stars` : ""}` : "Reviews"}
        actions={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Select value={stars} onChange={(e) => setStars(e.target.value)} aria-label="Stars" className="sm:w-36"><option value="">All ratings</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</Select>
          <SearchInput value={q} onChange={setQ} placeholder="Patient, doctor, case, words" />
        </div>}>
        {loading && !data ? <Loading /> : !data?.reviews.length ? <Empty title="No reviews yet" hint="Patients can review a treatment after it is finalized." /> : (
          <ul className="divide-y">
            {data.reviews.map((r) => (
              <li key={r.id} className="space-y-1.5 px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars value={r.rating} /><span className="text-sm font-medium text-slate-700">{LABELS[r.rating]}</span>
                  <span className="text-sm text-slate-500">{fmtDate(r.updated_at ?? r.created_at)}</span>
                </div>
                {r.comment ? <p className="whitespace-pre-wrap text-sm text-slate-800">{r.comment}</p> : <p className="text-sm italic text-slate-400">No comment</p>}
                <p className="text-xs text-slate-500">
                  <Link href={`/admin/patients/${r.patient.id}`} className="font-medium text-teal-700 hover:underline">{r.patient.name}</Link> ({r.patient.mrn}) ·{" "}
                  <Link href={`/admin/visits/${r.case.id}`} className="hover:underline">{r.case.case_number} · {r.case.title}</Link>
                  {r.doctor_name && <> · Dr. {r.doctor_name}</>}
                </p>
              </li>))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
