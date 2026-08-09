"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJsonFile, SUBDIRS } from "@library/lib/library-storage";
import type { NotificationInbox } from "@library/lib/queue";
import {
  hasQueuedRequest,
  useQueueState,
} from "@library/lib/queue-state-store";
import {
  loadViewedMap,
  markViewedNow,
  type ViewedMap,
} from "@library/lib/row-viewed-store";

export type RowDotTone = "red" | "green" | null;

const POLL_MS = 6000;

interface State {
  latestNotifAt: Map<string, string>;
  viewed: ViewedMap;
}

export function useRowDotState(handle: FileSystemDirectoryHandle | null): {
  toneFor: (citekey: string | null | undefined) => RowDotTone;
  markViewed: (citekey: string) => void;
} {
  const [state, setState] = useState<State>({
    latestNotifAt: new Map(),
    viewed: {},
  });

  // The "a request is pending for this row" half comes from the SHARED
  // queue-state store — the same scan the reader header derives its
  // AI-request checkboxes from, so the dot and the checkboxes can never
  // disagree, and a local queue write reaches both in one `refreshQueueState()`
  // instead of waiting out a poll (task 132).
  const queueSnapshot = useQueueState(handle);

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
      const latestNotifAt = await scanLatestNotifAt(handle);
      if (stopped) return;
      setState((s) =>
        mapsEqual(s.latestNotifAt, latestNotifAt)
          ? s
          : { ...s, latestNotifAt },
      );
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
      if (hasQueuedRequest(queueSnapshot, citekey)) return "red";
      const notif = s.latestNotifAt.get(citekey);
      if (notif && notif > (s.viewed[citekey] ?? "")) return "green";
      return null;
    },
    // stateRef is mutable; consumers re-render via state changes already
    [state, queueSnapshot],
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

async function scanLatestNotifAt(
  handle: FileSystemDirectoryHandle,
): Promise<Map<string, string>> {
  const inbox = await readJsonFile<NotificationInbox>(
    handle,
    `${SUBDIRS.notifications}/inbox.json`,
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

function mapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
