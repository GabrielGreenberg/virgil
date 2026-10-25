"use client";

/**
 * Stack hook — the visual clipboard. Reads/writes a window-scoped
 * localStorage envelope at `STACK_STORAGE_KEY`. Cross-tab fan-out via
 * the same `storage` event localStorage already raises (no
 * BroadcastChannel needed; the bus is reserved for typed pref events).
 *
 * The store is intentionally simple: a sorted array (newest first) with
 * FIFO eviction at the cap — which is `STACK_MAX_ITEMS` *and*
 * `STACK_MAX_CHARS`, applied together by `fitStackItems`
 * ([budget.ts](../lib/stack/budget.ts)), because the count alone never
 * measured the thing that actually runs out. Pulls do NOT remove items — the
 * Stack is one-way. Removal is explicit via the per-thumbnail X.
 *
 * Every write REPORTS (task 591): the persistence door returns whether it
 * landed, and nothing above it — not the hook's state, not the add door, not
 * the capture terminal that closes a float on the answer — updates on a write
 * that did not.
 */

import { useCallback, useEffect, useState } from "react";
import {
  STACK_STORAGE_KEY,
  type StackEnvelope,
  type StackItem,
  type StackPayload,
} from "@/lib/stack/types";
import { fitStackItems, serializeStackEnvelope } from "@/lib/stack/budget";
import { subscribeToStorageKey } from "@/lib/cross-window-storage";
import {
  normalizeStackItemBib,
  withBibCarry,
  type StackBibCtx,
} from "@/lib/stack/bib-carry";
import type { StackAddReport } from "@/lib/stack/add-report";

/** Key the add door moves a stored blob to when NOBODY can read it (it does
 *  not parse), before starting fresh — so real corruption costs one key's
 *  worth of storage, not the Stack, and a human can still recover it
 *  (task 1100). */
export const STACK_QUARANTINE_KEY = `${STACK_STORAGE_KEY}:quarantine`;

/** Every payload family, typed so a new `StackPayload` kind cannot ship
 *  without the read door recognising it. */
const STACK_PAYLOAD_KINDS: Record<StackPayload["kind"], true> = {
  text: true,
  paragraph: true,
  heading: true,
  card: true,
};

/**
 * What the ONE read door saw (task 1100). "Unreadable" is a separate answer
 * from "empty", because the add door must not treat "I could not read it" as
 * "there is nothing there" — its next write would replace every stored item
 * with the one new capture.
 *
 * - `ok` — absent (truly empty) or a v1 envelope; malformed ITEMS are dropped
 *   one by one, so one bad item costs only itself.
 * - `foreign` — parses, but is not a v1 envelope (another build's version, or
 *   no `items` array). Some build may own it: never overwrite.
 * - `corrupt` — does not parse. No build can ever read it.
 * - `unavailable` — storage itself could not be read (it threw, or there is
 *   no `localStorage`). Nothing was read, so nothing may be written; kept
 *   apart from `foreign` so the refusal can say which (task 1285).
 */
type EnvelopeRead =
  | { state: "ok"; items: StackItem[] }
  | { state: "foreign" }
  | { state: "corrupt"; raw: string }
  | { state: "unavailable" };

function isStackItem(v: unknown): v is StackItem {
  if (!v || typeof v !== "object") return false;
  const it = v as { id?: unknown; payload?: unknown };
  if (typeof it.id !== "string") return false;
  const payload = it.payload as { kind?: unknown } | null | undefined;
  return (
    !!payload &&
    typeof payload === "object" &&
    typeof payload.kind === "string" &&
    Object.prototype.hasOwnProperty.call(STACK_PAYLOAD_KINDS, payload.kind)
  );
}

function readEnvelope(): EnvelopeRead {
  if (typeof window === "undefined") return { state: "unavailable" };
  let raw: string | null;
  try {
    raw = localStorage.getItem(STACK_STORAGE_KEY);
  } catch {
    // Storage itself is unavailable: nothing was read, and nothing will be
    // written either (the write door reports the same failure).
    return { state: "unavailable" };
  }
  if (!raw) return { state: "ok", items: [] };
  let parsed: Partial<StackEnvelope> | null;
  try {
    parsed = JSON.parse(raw) as Partial<StackEnvelope> | null;
  } catch {
    return { state: "corrupt", raw };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.items)
  ) {
    return { state: "foreign" };
  }
  // Validate ITEM BY ITEM, then normalize the pre-235 per-card bib sidecars
  // onto the unified `item.bib` carrier (task 235). This is the ONE read door
  // — the hook's state, its cross-window re-read, and the non-React
  // `readStackItem` the pull spec uses all come through here — so no consumer
  // downstream ever sees the old shape (or a payload-less item: the thumbnail
  // reads `item.payload.kind` unguarded) and needs no legacy branch.
  return {
    state: "ok",
    items: (parsed.items as unknown[]).filter(isStackItem).map(normalizeStackItemBib),
  };
}

/** The items to DISPLAY / look up — an unreadable envelope shows as empty. */
function readItems(): StackItem[] {
  const env = readEnvelope();
  return env.state === "ok" ? env.items : [];
}

/**
 * **THE persistence door, and it REPORTS** (task 591).
 *
 * It used to swallow every `setItem` throw into a `console.error` and return
 * `void`, so `addStackItem` returned `void` too, so `captureKeyToStack`
 * returned `true` unconditionally — and the float producer closed its popout
 * and the lift producer tore down its overlay on a capture that had never
 * landed. THE REPORT IS THE PERMISSION (task 332): a door that cannot fail is
 * a door whose report means nothing. So the one thing that can actually fail
 * says so, and every caller above it carries the answer up.
 *
 * `false` is also the honest answer on the server (no `localStorage`): nothing
 * was persisted there either.
 */
function writeSerialized(json: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(STACK_STORAGE_KEY, json);
    return true;
  } catch (err) {
    console.error("[stack] persist failed", err);
    return false;
  }
}

function writeEnvelope(env: StackEnvelope): boolean {
  return writeSerialized(serializeStackEnvelope(env.items));
}

// ── Same-window listeners ──────────────────────────────────────────────
//   localStorage's `storage` event only fires in OTHER tabs, not the
//   writer. We keep a parallel set of in-window listeners so two stack
//   consumers in the same tab (icon + strip) see writes immediately.
const sameWindowListeners = new Set<() => void>();
function notifySameWindow() {
  for (const fn of sameWindowListeners) fn();
}

export interface UseStackValue {
  items: StackItem[];
  /** `true` iff the removal actually persisted; state follows storage, never
   *  leads it (task 591). */
  remove: (id: string) => boolean;
  // No `getItem` / `clear` (task 863): nothing called them. A by-id lookup
  // is `readStackItem` below (reads STORAGE, never lagging React state); a
  // future clear-all affordance re-adds a door through `persist([])`.
}

export function useStack(): UseStackValue {
  const [items, setItems] = useState<StackItem[]>(readItems);

  // Cross-tab sync — `storage` event fires in OTHER tabs when one tab
  // writes localStorage; routed through the ONE storage-event contract
  // (task 177), which also covers the `key === null` clear() the previous
  // hand-rolled listener missed. Plus same-window listeners for sibling
  // consumers in this tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reread = () => setItems(readItems());
    const offStorage = subscribeToStorageKey(STACK_STORAGE_KEY, reread);
    sameWindowListeners.add(reread);
    return () => {
      offStorage();
      sameWindowListeners.delete(reread);
    };
  }, []);

  // State follows the WRITE, never leads it: a failed persist used to leave
  // React holding a list storage does not have, so the strip showed the
  // removal and the next cross-window re-read undid it (task 591).
  const persist = useCallback((next: StackItem[]): boolean => {
    if (!writeEnvelope({ version: 1, items: next })) return false;
    setItems(next);
    notifySameWindow();
    return true;
  }, []);

  const remove = useCallback(
    (id: string) => {
      // An unreadable envelope reads as no items, so nothing matches and
      // nothing is written — the stored blob is left exactly as it was.
      const cur = readItems();
      const next = cur.filter((it) => it.id !== id);
      if (next.length === cur.length) return false;
      return persist(next);
    },
    [persist],
  );

  return { items, remove };
}

/**
 * Side-channel reader for non-React consumers (e.g. the stack-pull drop
 * spec, which runs from inside a window mouseup handler with no React
 * context). Always reads the latest persisted envelope.
 */
export function readStackItem(id: string): StackItem | null {
  return readItems().find((it) => it.id === id) ?? null;
}

/**
 * **The ONE door into the Stack** — imperative because every producer runs
 * outside the React tree (the `virgil-stack-drop` window listener, StackIcon's
 * HTML5 drop handler). The hook's own `add` was deleted with task 235 rather
 * than given the same signature: it had no caller, and a second add door is a
 * door someone reaches for without the obligation below.
 *
 * Returns whether the item actually LANDED, and when it did not, WHY (task
 * 1285) — a {@link StackAddReport}. Only `ok: true` may be reported as a
 * capture (task 591); the reason is what the terminal's notice is derived
 * from, so a refusal never tells the user to remove items from a Stack that
 * holds none.
 *
 * `bib` is REQUIRED (task 235). The referenced bibliography is resolved HERE,
 * once, for every payload family, so a producer cannot land an item without
 * answering the question — including producers that never touch
 * `lib/stack/snapshot.ts` and would therefore have been missed by a per-helper
 * ctx parameter. A doc with no bibliography answers with resolvers that return
 * undefined, which is an answer; there is no default to omit.
 *
 * **It never overwrites what it could not read** (task 1100) — the write-path
 * law's question, "is this write measured against what was READ?", asked of
 * the Stack. A `foreign` envelope (another build's version) REFUSES: the
 * newer build owns it. A `corrupt` one (does not parse — nobody can ever read
 * it) is moved to {@link STACK_QUARANTINE_KEY} first, and the add proceeds
 * only if that move landed; refusing forever would wedge the Stack.
 */
export function addStackItem(item: StackItem, bib: StackBibCtx): StackAddReport {
  const env = readEnvelope();
  if (env.state === "unavailable") return { ok: false, reason: "unreadable-storage" };
  if (env.state === "foreign") return { ok: false, reason: "foreign" };
  if (env.state === "corrupt" && !quarantine(env.raw)) {
    return { ok: false, reason: "quarantine-failed" };
  }
  const cur = env.state === "ok" ? env.items : [];
  let candidate = [withBibCarry(item, bib), ...cur];
  // The cap is applied here, once, in BOTH its halves — count then the real
  // localStorage budget, FIFO, never at the expense of the item being added
  // ([budget.ts](../lib/stack/budget.ts)).
  for (;;) {
    const fitted = fitStackItems(candidate);
    if (writeSerialized(fitted.serialized)) {
      notifySameWindow();
      return { ok: true };
    }
    // Our own budget is a share of the origin's, not the whole of it — every
    // `virgil:*` pref key spends from the same ~5 MB — so a write can still
    // throw well inside it. Make room the same way and try again. When only
    // the new item is left there is nothing further to give, and the add
    // REFUSES: a failed write is never reported as a capture, because its
    // report is what closes the float and tears down the lift. Whether
    // "remove some items" is honest copy depends on whether there were any
    // (task 1285).
    if (fitted.items.length <= 1) {
      return { ok: false, reason: cur.length > 0 ? "full" : "no-room" };
    }
    candidate = fitted.items.slice(0, fitted.items.length - 1);
  }
}

/**
 * Set an unparseable blob aside. The copy needs the blob's size again, so it
 * is most likely to fail under quota pressure — and a failure used to be a
 * PERMANENT wedge (every later add refused the same way). An earlier
 * quarantine is the one thing here that is ours to give up: it is older
 * damaged data, superseded by this one. So on a throw, drop it and try once
 * more (task 1285).
 */
function quarantine(raw: string): boolean {
  try {
    localStorage.setItem(STACK_QUARANTINE_KEY, raw);
    return true;
  } catch (first) {
    try {
      if (localStorage.getItem(STACK_QUARANTINE_KEY) === null) throw first;
      localStorage.removeItem(STACK_QUARANTINE_KEY);
      localStorage.setItem(STACK_QUARANTINE_KEY, raw);
      return true;
    } catch (err) {
      console.error("[stack] quarantine failed", err);
      return false;
    }
  }
}
