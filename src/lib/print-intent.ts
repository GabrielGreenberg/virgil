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
 * `beforeprint` listener in print.ts that prints with the user's SAVED
 * options (`getSavedPrintOptions` below, task 608) — the mount races the
 * browser's snapshot there, which is the documented trade for not keeping
 * hundreds of hidden editors alive full-time. Kill-switch:
 * `localStorage["virgil:print-gate"] = "off"` restores the always-mounted
 * legacy behavior.
 */

import type { PrintOptions } from "@/lib/print";
import { readFlag } from "@/lib/feature-flags";

interface PrintIntentState {
  active: boolean;
  options: PrintOptions | null;
}

let state: PrintIntentState = { active: false, options: null };
const subscribers = new Set<() => void>();
let readyResolvers: (() => void)[] = [];

/** Read once at module load — a pure kill-switch, not a live toggle. */
export const printGateEnabled: boolean = readFlag("virgil:print-gate");

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

// ── The user's saved print options, for the door React cannot reach ──────
// The browser's own File → Print fires `beforeprint` in print.ts, which has no
// React state to read. The owner of `viewPrefs.prefs.printOptions`
// (EditorLayout — the same value it hands PrintDialog) publishes it here.
//
// ONE slot, not a per-pane registry, and that is deliberate under the
// per-doc-services law: `printOptions` is a GLOBAL view pref (one value per
// profile, synced across windows), not a per-document fact, so every pane in
// this window would publish the same value. A departing owner clears only its
// own value (`clearSavedPrintOptions` compares identity).
let savedOptions: PrintOptions | null = null;

export function setSavedPrintOptions(options: PrintOptions): void {
  savedOptions = options;
}

export function clearSavedPrintOptions(options: PrintOptions): void {
  if (savedOptions === options) savedOptions = null;
}

/** `null` when no owner is mounted — the caller falls back to the shipped defaults. */
export function getSavedPrintOptions(): PrintOptions | null {
  return savedOptions;
}
