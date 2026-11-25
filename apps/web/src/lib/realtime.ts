"use client";
/**
 * Live updates through Supabase Realtime.
 *
 * The API broadcasts only which kind of data changed ({ topics: ["sales", ...] }), never the data.
 * Screens subscribe to the topics they show and refetch through the API, so every refetch still
 * goes through login and permission checks. Only the PUBLISHABLE key is used here.
 */
import { useEffect, useRef } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

// Keep in sync with apps/api/app/core/realtime.py
export type LiveTopic = "sales" | "purchases" | "stock" | "medicines" | "suppliers" | "patients" | "billing" | "tasks" | "staff" | "visits" | "attendance" | "chat" | "reviews" | "leave" | "advances" | "inventory" | "finance" | "dashboard";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const CHANNEL = process.env.NEXT_PUBLIC_REALTIME_CHANNEL || "hms-events";

type Listener = (topics: string[]) => void;
const listeners = new Set<Listener>();
let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

function ensureChannel() {
  if (channel || !URL || !KEY || typeof window === "undefined") return;
  client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  channel = client.channel(CHANNEL)
    .on("broadcast", { event: "changed" }, ({ payload }) => {
      const topics: string[] = Array.isArray(payload?.topics) ? payload.topics : [];
      listeners.forEach((l) => l(topics));
    })
    .subscribe();
}

export const realtimeEnabled = Boolean(URL && KEY);

/** Calls `onChange` (debounced) whenever the server reports a change in any of `topics`. */
export function useLive(topics: LiveTopic[] | undefined, onChange: () => void, debounceMs = 400) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = (topics ?? []).join(",");
  useEffect(() => {
    if (!key) return;
    ensureChannel();
    const wanted = new Set(key.split(","));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener: Listener = (changed) => {
      if (!changed.some((t) => wanted.has(t))) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); clearTimeout(timer); };
  }, [key, debounceMs]);
}
