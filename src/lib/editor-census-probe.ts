/**
 * Editor census probe — counts LIVE TipTap editor instances by mount site.
 *
 * The 2026-08-08 perf diagnosis found the app mounting one live editor per
 * footnote/example card (881 instances at 2,883 blocks — the doc-open and
 * DOM-scale driver, MEMO_PERF_DEEP_RESEARCH_2026_08_08.md §6). This probe is
 * the standing instrument for that class: every editor-mounting component
 * registers on mount and unregisters on unmount, and
 * `window.__editorCensus()` reports the live totals.
 *
 * Cost: two Map ops per editor mount/unmount — safe to keep in production.
 * The card-presence-tiers doctrine (plan Wave 3) uses this as its runtime
 * guard: total ≤ main surfaces + expanded/near-zone cards.
 */

export type EditorCensusKind =
  | "main"
  | "borrowed-main-text"
  | "rich-text-field"
  | "example-card";

const counts = new Map<EditorCensusKind, number>();
let peak = 0;
let total = 0;

/** Register a mounted editor; returns the matching unregister. */
export function registerEditorMount(kind: EditorCensusKind): () => void {
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  total += 1;
  if (total > peak) peak = total;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts.set(kind, Math.max(0, (counts.get(kind) ?? 1) - 1));
    total = Math.max(0, total - 1);
  };
}

export interface EditorCensus {
  total: number;
  /** High-water mark since page load — catches transient double-mounts. */
  peak: number;
  byKind: Record<string, number>;
}

export function readEditorCensus(): EditorCensus {
  const byKind: Record<string, number> = {};
  for (const [kind, n] of counts) byKind[kind] = n;
  return { total, peak, byKind };
}

declare global {
  interface Window {
    __editorCensus?: () => EditorCensus;
  }
}

if (typeof window !== "undefined") {
  window.__editorCensus = readEditorCensus;
}
