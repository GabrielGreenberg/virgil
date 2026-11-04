"use client";

/**
 * SESSION 4 (task 2026-07-03-020) — the transient "which side am I previewing"
 * state for an APPLIED pending AI change.
 *
 * The applied-suggestion card gained a NON-committing Original / Suggested
 * toggle that flips the LIVE in-document paragraph between the pre-splice
 * original and the AI suggestion so you can compare in place WITHOUT committing.
 * That preview direction is:
 *   - keyed by (paper, card id) — task 1455, see `PreviewDocKey`,
 *   - NEVER persisted to the sidecar (it's a UI compare state, not a decision),
 *   - default `"suggested"` (matches the live doc right after auto-apply), and
 *   - read by BOTH the card body (to render the active segment) AND the commit
 *     path (so Check / Cross reconcile from the canonical `appliedChange`, not
 *     the transient preview — a mid-preview commit stays deterministic).
 *
 * It is a tiny module-level external store rather than React state so the
 * `PendingChangeController` value can stay referentially stable across
 * keystrokes (baking preview state into the controller would re-identify it on
 * every toggle and thread `cards[]`-like churn through every consuming card
 * body). The store is poked ONLY by click-driven toggle / commit actions, so it
 * never fires on a plain keystroke — `usePreviewDir` subscribers stay quiet
 * while typing (keystroke sanctity).
 */

import { useCallback, useSyncExternalStore } from "react";

export type PreviewDir = "suggested" | "original";

/** TASK 1455 — the store is a REGISTRY keyed by the owning paper, never one
 *  namespace of bare card ids. Card ids are unique only WITHIN a paper (and
 *  identical across a duplicated folder), while N papers are warm at once
 *  (multi-doc keep-alive), so a bare-id map let paper A's "original" toggle
 *  read as B's — and B's Check then cleared it, so A's Check finalized the
 *  ORIGINAL text. `null` is the doc-less bucket (a card rendered with no
 *  controller, e.g. in isolation); it is a bucket of its own, never a
 *  wildcard. */
export type PreviewDocKey = string | null;

/** Only cards currently previewing the ORIGINAL are stored; a missing id means
 *  the default `"suggested"` (so the maps stay empty in the common case). */
const dirs = new Map<PreviewDocKey, Map<string, PreviewDir>>();
const listeners = new Map<PreviewDocKey, Map<string, Set<() => void>>>();

function emit(docId: PreviewDocKey, id: string): void {
  const set = listeners.get(docId)?.get(id);
  if (set) for (const cb of set) cb();
}

/** The current preview direction for card `id` of paper `docId` (default
 *  `"suggested"`). */
export function getPreviewDir(docId: PreviewDocKey, id: string): PreviewDir {
  return dirs.get(docId)?.get(id) ?? "suggested";
}

/** Set the preview direction for card `id` of paper `docId`; no-op (no emit)
 *  when unchanged. */
export function setPreviewDir(
  docId: PreviewDocKey,
  id: string,
  dir: PreviewDir,
): void {
  if (getPreviewDir(docId, id) === dir) return;
  if (dir === "suggested") {
    const doc = dirs.get(docId);
    doc?.delete(id);
    if (doc && doc.size === 0) dirs.delete(docId);
  } else {
    let doc = dirs.get(docId);
    if (!doc) {
      doc = new Map();
      dirs.set(docId, doc);
    }
    doc.set(id, dir);
  }
  emit(docId, id);
}

/** Reset card `id` of paper `docId` back to the default `"suggested"` —
 *  called on commit (Check / Cross) so a re-applied card next time starts on
 *  the suggested view. */
export function resetPreviewDir(docId: PreviewDocKey, id: string): void {
  setPreviewDir(docId, id, "suggested");
}

function subscribe(
  docId: PreviewDocKey,
  id: string,
  cb: () => void,
): () => void {
  let doc = listeners.get(docId);
  if (!doc) {
    doc = new Map();
    listeners.set(docId, doc);
  }
  let set = doc.get(id);
  if (!set) {
    set = new Set();
    doc.set(id, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) doc.delete(id);
    if (doc.size === 0) listeners.delete(docId);
  };
}

/** Subscribe a card body to its own preview direction in its own paper.
 *  Re-renders ONLY when `setPreviewDir(docId, id, …)` runs for this pair (a
 *  click), never on a keystroke. */
export function usePreviewDir(docId: PreviewDocKey, id: string): PreviewDir {
  const sub = useCallback(
    (cb: () => void) => subscribe(docId, id, cb),
    [docId, id],
  );
  return useSyncExternalStore(
    sub,
    () => getPreviewDir(docId, id),
    () => "suggested",
  );
}
