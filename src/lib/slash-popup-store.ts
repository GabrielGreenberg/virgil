"use client";

/**
 * Per-EDITOR store for the inline `\`-command popup. The ProseMirror plugin
 * owns the canonical state (see slash-popup.ts) and publishes it here from its
 * plugin VIEW (never from `apply`, so a `state.apply` dry run publishes
 * nothing). The popup React component subscribes via
 * `useSlashPopupState(editor)` and re-renders.
 *
 * Task 750 — a REGISTRY keyed by the owning editor, never a single slot. N
 * `EditorPane`s are mounted at once under multi-doc keep-alive, each with its
 * own `<SlashCommandPopup>`. When this was one module-level `_state`, typing
 * `\` in the visible doc opened the popup in EVERY pane, and each hidden
 * (`display:none`) pane portalled a dead copy of it to the window's top-left
 * corner (its `coordsAtPos` answers an all-zero rect). Keyed by owner, a
 * pane's popup can only ever read its OWN plugin's state — the "per-doc
 * services under multi-pane keep-alive" law.
 *
 * `useSyncExternalStore` keeps us dependency-free and works across portals /
 * popped-out surfaces.
 */

import { useCallback, useSyncExternalStore } from "react";

export type SlashPopupState =
  | { open: false }
  | {
      open: true;
      slashPos: number;
      query: string;
      selectedIndex: number;
      filtered: string[];
      /**
       * The subset of `filtered` that must render GREYED — the registry's own
       * `applies()` verdict for this caret, resolved ONCE in the plugin's state
       * derivation (task 398) so the OFFER (this list) and the COMMIT
       * (`executeSelection`) read literally the same array.
       *
       * A plain sorted `string[]` rather than a `Set` so `statesEqual` below can
       * compare two snapshots BY VALUE: a fresh Set identity per transaction
       * would re-render the popup on every keystroke while it is open.
       */
      disabled: string[];
    };

/**
 * The popup's owner — the TipTap `Editor` whose `SlashPopupExtension` plugin
 * publishes, and whose `<SlashCommandPopup>` reads. Typed as a bare object so
 * this module stays free of editor imports; any stable per-editor identity works.
 */
export type SlashPopupOwner = object;

interface Entry {
  state: SlashPopupState;
  listeners: Set<() => void>;
}

const CLOSED: SlashPopupState = { open: false };

/** Owner → its popup. Weak, so a destroyed editor's entry is collected. */
const _entries = new WeakMap<SlashPopupOwner, Entry>();

function entryFor(owner: SlashPopupOwner): Entry {
  let e = _entries.get(owner);
  if (!e) {
    e = { state: CLOSED, listeners: new Set() };
    _entries.set(owner, e);
  }
  return e;
}

export const slashPopupStore = {
  /** This owner's popup state; `CLOSED` for an owner that never published. */
  getState(owner: SlashPopupOwner | null | undefined): SlashPopupState {
    if (!owner) return CLOSED;
    return _entries.get(owner)?.state ?? CLOSED;
  },
  /** Publish `next` for `owner`; notifies ONLY that owner's subscribers. */
  set(owner: SlashPopupOwner, next: SlashPopupState): void {
    const e = entryFor(owner);
    if (statesEqual(e.state, next)) return;
    e.state = next;
    for (const fn of e.listeners) fn();
  },
  subscribe(owner: SlashPopupOwner, fn: () => void): () => void {
    const e = entryFor(owner);
    e.listeners.add(fn);
    return () => {
      e.listeners.delete(fn);
    };
  },
};

function statesEqual(a: SlashPopupState, b: SlashPopupState): boolean {
  if (a.open !== b.open) return false;
  if (!a.open || !b.open) return true;
  if (a.slashPos !== b.slashPos) return false;
  if (a.query !== b.query) return false;
  if (a.selectedIndex !== b.selectedIndex) return false;
  if (a.filtered.length !== b.filtered.length) return false;
  for (let i = 0; i < a.filtered.length; i++) {
    if (a.filtered[i] !== b.filtered[i]) return false;
  }
  if (a.disabled.length !== b.disabled.length) return false;
  for (let i = 0; i < a.disabled.length; i++) {
    if (a.disabled[i] !== b.disabled[i]) return false;
  }
  return true;
}

const getServerSnapshot = () => CLOSED;
const noopUnsubscribe = () => {};

/** The popup state of `owner`'s editor (closed while `owner` is null). */
export function useSlashPopupState(owner: SlashPopupOwner | null | undefined): SlashPopupState {
  const subscribe = useCallback(
    (fn: () => void) => (owner ? slashPopupStore.subscribe(owner, fn) : noopUnsubscribe),
    [owner],
  );
  const getSnapshot = useCallback(() => slashPopupStore.getState(owner), [owner]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
