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
} from "@/lib/stack/types";
import { fitStackItems, serializeStackEnvelope } from "@/lib/stack/budget";
import { subscribeToStorageKey } from "@/lib/cross-window-storage";
import {
  normalizeStackItemBib,
  withBibCarry,
  type StackBibCtx,
} from "@/lib/stack/bib-carry";

const EMPTY_ENVELOPE: StackEnvelope = { version: 1, items: [] };

function readEnvelope(): StackEnvelope {
  if (typeof window === "undefined") return EMPTY_ENVELOPE;
  try {
    const raw = localStorage.getItem(STACK_STORAGE_KEY);
    if (!raw) return EMPTY_ENVELOPE;
    const parsed = JSON.parse(raw) as Partial<StackEnvelope>;
    if (!parsed || typeof parsed !== "object") return EMPTY_ENVELOPE;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return EMPTY_ENVELOPE;
    }
    // Normalize the pre-235 per-card bib sidecars onto the unified
    // `item.bib` carrier (task 235). This is the ONE read door — the hook's
    // state, its cross-window re-read, and the non-React `readStackItem` the
    // pull spec uses all come through here — so no consumer downstream ever
    // sees the old shape and the pull side needs no legacy branch.
    return {
      version: 1,
      items: (parsed.items as StackItem[]).map(normalizeStackItemBib),
    };
  } catch {
    return EMPTY_ENVELOPE;
  }
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
  /** `true` iff the clear actually persisted. */
  clear: () => boolean;
  /** Look up a stack item by id — used by the stack-pull drop spec. */
  getItem: (id: string) => StackItem | null;
}

export function useStack(): UseStackValue {
  const [items, setItems] = useState<StackItem[]>(() => readEnvelope().items);

  // Cross-tab sync — `storage` event fires in OTHER tabs when one tab
  // writes localStorage; routed through the ONE storage-event contract
  // (task 177), which also covers the `key === null` clear() the previous
  // hand-rolled listener missed. Plus same-window listeners for sibling
  // consumers in this tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reread = () => setItems(readEnvelope().items);
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
      const cur = readEnvelope().items;
      const next = cur.filter((it) => it.id !== id);
      if (next.length === cur.length) return false;
      return persist(next);
    },
    [persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const getItem = useCallback(
    (id: string) => items.find((it) => it.id === id) ?? null,
    [items],
  );

  return { items, remove, clear, getItem };
}

/**
 * Side-channel reader for non-React consumers (e.g. the stack-pull drop
 * spec, which runs from inside a window mouseup handler with no React
 * context). Always reads the latest persisted envelope.
 */
export function readStackItem(id: string): StackItem | null {
  const env = readEnvelope();
  return env.items.find((it) => it.id === id) ?? null;
}

/**
 * **The ONE door into the Stack** — imperative because every producer runs
 * outside the React tree (the `virgil-stack-drop` window listener, StackIcon's
 * HTML5 drop handler). The hook's own `add` was deleted with task 235 rather
 * than given the same signature: it had no caller, and a second add door is a
 * door someone reaches for without the obligation below.
 *
 * Returns whether the item actually LANDED. `false` means the envelope could
 * not be persisted even after FIFO-evicting everything older — the caller must
 * not report a capture (task 591).
 *
 * `bib` is REQUIRED (task 235). The referenced bibliography is resolved HERE,
 * once, for every payload family, so a producer cannot land an item without
 * answering the question — including producers that never touch
 * `lib/stack/snapshot.ts` and would therefore have been missed by a per-helper
 * ctx parameter. A doc with no bibliography answers with resolvers that return
 * undefined, which is an answer; there is no default to omit.
 */
export function addStackItem(item: StackItem, bib: StackBibCtx): boolean {
  const cur = readEnvelope().items;
  let candidate = [withBibCarry(item, bib), ...cur];
  // The cap is applied here, once, in BOTH its halves — count then the real
  // localStorage budget, FIFO, never at the expense of the item being added
  // ([budget.ts](../lib/stack/budget.ts)).
  for (;;) {
    const fitted = fitStackItems(candidate);
    if (writeSerialized(fitted.serialized)) {
      notifySameWindow();
      return true;
    }
    // Our own budget is a share of the origin's, not the whole of it — every
    // `virgil:*` pref key spends from the same ~5 MB — so a write can still
    // throw well inside it. Make room the same way and try again. When only
    // the new item is left there is nothing further to give, and the add
    // REFUSES: a failed write is never reported as a capture, because its
    // report is what closes the float and tears down the lift.
    if (fitted.items.length <= 1) return false;
    candidate = fitted.items.slice(0, fitted.items.length - 1);
  }
}
