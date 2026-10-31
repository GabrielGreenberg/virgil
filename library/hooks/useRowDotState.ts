"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readNotificationItems } from "@library/lib/queue";
import {
  hasQueuedRequest,
  useQueueState,
} from "@library/lib/queue-state-store";
import {
  loadViewedMap,
  markViewedNow,
  ROW_VIEWED_KEY,
  type ViewedMap,
} from "@library/lib/row-viewed-store";
import { subscribeToStorageKey } from "@/lib/cross-window-storage";
import type { StatusTone } from "@/components/StatusDot";

/**
 * What a Library row's far-left dot MEANS — a subset of the app's one
 * `StatusTone` vocabulary, rendered with `<StatusDot tone=…>` so nothing maps
 * a state to a colour on the way (task 1379, the library half of task 315's
 * `AiDotTone` rename). It was `"red" | "green"` until then: a colour-named
 * union that painted "a request is waiting for Claude" in the DANGER red,
 * while every editor-side surface paints the same state as the amber
 * `pending` dot (task 951). "New result" is `ok`, the tone `AiDotTone` names
 * "AI has replied".
 */
export type RowDotTone = Extract<StatusTone, "pending" | "ok"> | null;

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

  // Hydrate viewed map on mount (client-only), and re-hydrate when a peer
  // window marks a row viewed — otherwise this window's "new result" dot stays lit for a
  // notification the user already acknowledged elsewhere (task 768).
  useEffect(() => {
    const hydrate = () => setState((s) => ({ ...s, viewed: loadViewedMap() }));
    hydrate();
    return subscribeToStorageKey(ROW_VIEWED_KEY, hydrate);
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
      if (hasQueuedRequest(queueSnapshot, citekey)) return "pending";
      const notif = s.latestNotifAt.get(citekey);
      if (notif && notif > (s.viewed[citekey] ?? "")) return "ok";
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
  const items = await readNotificationItems(handle);
  const out = new Map<string, string>();
  for (const item of items) {
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
