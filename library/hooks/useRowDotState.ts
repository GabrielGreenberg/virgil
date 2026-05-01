"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listDir, readJsonFile, SUBDIRS } from "@library/lib/library-storage";
import type { NotificationInbox, QueueEntry } from "@library/lib/queue";
import {
  loadViewedMap,
  markViewedNow,
  type ViewedMap,
} from "@library/lib/row-viewed-store";

export type RowDotTone = "red" | "green" | null;

const POLL_MS = 6000;

interface State {
  pending: Set<string>;
  latestNotifAt: Map<string, string>;
  viewed: ViewedMap;
}

export function useRowDotState(handle: FileSystemDirectoryHandle | null): {
  toneFor: (citekey: string | null | undefined) => RowDotTone;
  markViewed: (citekey: string) => void;
} {
  const [state, setState] = useState<State>({
    pending: new Set(),
    latestNotifAt: new Map(),
    viewed: {},
  });

  // Hydrate viewed map on mount (client-only).
  useEffect(() => {
    setState((s) => ({ ...s, viewed: loadViewedMap() }));
  }, []);

  // Stable refs so the polling loop doesn't churn.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!handle) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      const [pending, latestNotifAt] = await Promise.all([
        scanPending(handle),
        scanLatestNotifAt(handle),
      ]);
      if (stopped) return;
      setState((s) => {
        if (
          setsEqual(s.pending, pending) &&
          mapsEqual(s.latestNotifAt, latestNotifAt)
        ) {
          return s;
        }
        return { ...s, pending, latestNotifAt };
      });
    };

    void tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [handle]);

  const toneFor = useCallback(
    (citekey: string | null | undefined): RowDotTone => {
      if (!citekey) return null;
      const s = stateRef.current;
      if (s.pending.has(citekey)) return "red";
      const notif = s.latestNotifAt.get(citekey);
      if (notif && notif > (s.viewed[citekey] ?? "")) return "green";
      return null;
    },
    // stateRef is mutable; consumers re-render via state changes already
    [state],
  );

  const markViewed = useCallback((citekey: string) => {
    if (!citekey) return;
    const at = markViewedNow(citekey);
    setState((s) => ({ ...s, viewed: { ...s.viewed, [citekey]: at } }));
  }, []);

  return { toneFor, markViewed };
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

async function scanPending(
  handle: FileSystemDirectoryHandle,
): Promise<Set<string>> {
  const entries = await listDir(handle, SUBDIRS.queue);
  if (!entries) return new Set();
  const out = new Set<string>();
  await Promise.all(
    entries.map(async (e) => {
      if (e.kind !== "file") return;
      if (!e.name.endsWith(".json")) return;
      // Skip aggregate files and triage entries (no citekey to attach to).
      if (e.name === "pending-reviews.json") return;
      if (e.name.startsWith("_triage-")) return;
      // .done.json is the rotated-stale-done sibling; skip.
      if (e.name.endsWith(".done.json")) return;
      const entry = await readJsonFile<QueueEntry>(
        handle,
        `${SUBDIRS.queue}/${e.name}`,
      );
      if (!entry) return;
      if (entry.status !== "requested") return;
      if (!entry.citekey) return;
      out.add(entry.citekey);
    }),
  );
  return out;
}

async function scanLatestNotifAt(
  handle: FileSystemDirectoryHandle,
): Promise<Map<string, string>> {
  const inbox = await readJsonFile<NotificationInbox>(
    handle,
    "notifications/inbox.json",
  );
  const out = new Map<string, string>();
  if (!inbox?.items) return out;
  for (const item of inbox.items) {
    if (!item.citekey) continue;
    const cur = out.get(item.citekey);
    if (!cur || item.at > cur) out.set(item.citekey, item.at);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Equality helpers — avoid re-render storms when the polled data is stable.
// ---------------------------------------------------------------------------

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
