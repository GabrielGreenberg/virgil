"use client";

/**
 * Stack hook — the visual clipboard. Reads/writes a window-scoped
 * localStorage envelope at `STACK_STORAGE_KEY`. Cross-tab fan-out via
 * the same `storage` event localStorage already raises (no
 * BroadcastChannel needed; the bus is reserved for typed pref events).
 *
 * The store is intentionally simple: a sorted array (newest first) with
 * FIFO eviction at `STACK_MAX_ITEMS`. Pulls do NOT remove items — the
 * Stack is one-way. Removal is explicit via the per-thumbnail X.
 */

import { useCallback, useEffect, useState } from "react";
import {
  STACK_MAX_ITEMS,
  STACK_STORAGE_KEY,
  type StackEnvelope,
  type StackItem,
} from "@/lib/stack/types";
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

function writeEnvelope(env: StackEnvelope) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STACK_STORAGE_KEY, JSON.stringify(env));
  } catch (err) {
    console.error("[stack] persist failed", err);
  }
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
  remove: (id: string) => void;
  clear: () => void;
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

  const persist = useCallback((next: StackItem[]) => {
    writeEnvelope({ version: 1, items: next });
    setItems(next);
    notifySameWindow();
  }, []);

  const remove = useCallback(
    (id: string) => {
      const cur = readEnvelope().items;
      const next = cur.filter((it) => it.id !== id);
      if (next.length === cur.length) return;
      persist(next);
    },
    [persist],
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

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
 * `bib` is REQUIRED (task 235). The referenced bibliography is resolved HERE,
 * once, for every payload family, so a producer cannot land an item without
 * answering the question — including producers that never touch
 * `lib/stack/snapshot.ts` and would therefore have been missed by a per-helper
 * ctx parameter. A doc with no bibliography answers with resolvers that return
 * undefined, which is an answer; there is no default to omit.
 */
export function addStackItem(item: StackItem, bib: StackBibCtx): void {
  const cur = readEnvelope().items;
  const next = [withBibCarry(item, bib), ...cur].slice(0, STACK_MAX_ITEMS);
  writeEnvelope({ version: 1, items: next });
  notifySameWindow();
}
