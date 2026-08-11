/**
 * Print-intent store — mounts the print appendices ONLY while a print is
 * actually happening.
 *
 * Before perf Wave 0 the appendices (a complete duplicate FootnotePanel +
 * bibliography panel) sat mounted-but-display:none in EVERY editor pane at
 * all times — one live TipTap editor per collapsed footnote card, doubled.
 * That was HALF of the measured 881-editor explosion and a large share of
 * the 50s doc-open (MEMO_PERF_DEEP_RESEARCH_2026_08_08.md §6).
 *
 * Flow: `runPrint()` calls `requestAppendices(options)` and awaits the
 * mount ack; the visible EditorPane subscribes, mounts `<PrintAppendices>`,
 * and acks via `notifyReady()` after its post-commit RAF; `runPrint` then
 * applies the print attrs and calls `window.print()`; `releaseAppendices()`
 * runs from the same afterprint/matchMedia cleanup path, unmounting the
 * appendix tree.
 *
 * The browser's native File→Print (no Cmd+P interception) is covered by a
 * best-effort `beforeprint` listener in print.ts — the mount races the
 * browser's snapshot there, which is the documented trade for not keeping
 * hundreds of hidden editors alive full-time. Kill-switch:
 * `localStorage["virgil:print-gate"] = "off"` restores the always-mounted
 * legacy behavior.
 */

import type { PrintOptions } from "@/lib/print";

interface PrintIntentState {
  active: boolean;
  options: PrintOptions | null;
}

let state: PrintIntentState = { active: false, options: null };
const subscribers = new Set<() => void>();
let readyResolvers: (() => void)[] = [];

/** Read once at module load — a pure kill-switch, not a live toggle. */
export const printGateEnabled: boolean = (() => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem("virgil:print-gate") !== "off";
  } catch {
    return true;
  }
})();

function emit() {
  for (const fn of subscribers) fn();
}

export function subscribePrintIntent(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getPrintIntent(): PrintIntentState {
  return state;
}

/**
 * Activate the appendices and resolve when a mounted `<PrintAppendices>`
 * acks (or after a fallback timeout, so a doc-less window still prints).
 */
export function requestAppendices(options: PrintOptions): Promise<void> {
  state = { active: true, options };
  emit();
  return new Promise<void>((resolve) => {
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      resolve();
    };
    readyResolvers.push(settle);
    // No pane may be subscribed (no doc open, reader view) — don't hang the
    // print behind an ack that will never come.
    setTimeout(settle, 1500);
  });
}

/** Ack from the mounted appendix tree (post-commit, next frame). */
export function notifyAppendicesReady(): void {
  const resolvers = readyResolvers;
  readyResolvers = [];
  for (const r of resolvers) r();
}

export function releaseAppendices(): void {
  if (!state.active) return;
  state = { active: false, options: null };
  readyResolvers = [];
  emit();
}
