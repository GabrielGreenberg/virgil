"use client";

/**
 * THE Stack's per-pane chrome-gate registry + the one strip-open signal.
 *
 * ## Why this module exists (task 589)
 *
 * The Stack is APP-GLOBAL: one localStorage envelope (`useStack`), one cached
 * icon rect (`stack-drop-target.ts`), one illuminated-ring signal. Its CHROME,
 * however, was mounted once per `EditorPane` and `createPortal`-ed to
 * `document.body`, with no visibility gate. A portal escapes its React parent's
 * DOM, so the keep-alive wrapper's `display:none` hid nothing: N warm panes
 * (capacity 3, plus the Library Reader, which mounts the same component) painted
 * N identical buttons at the same fixed bottom-left spot, and:
 *
 *   - **capture went dead.** Every mounted `StackIcon` wrote the ONE
 *     module-level `iconRect`, and each one's cleanup set it to `null`. Evict a
 *     pane (open a 4th paper) or close a Reader and the survivors — whose
 *     publish effect has `[]` deps — never re-published. From then on
 *     `isOverStackIcon` answered `false`, so `FloatingPanel` never lit the ring
 *     or fired `virgil-stack-drop` and `LiftHost` never captured a lifted
 *     paragraph. A window resize repaired it, which is why it read as flaky.
 *   - **the icon toggled a hidden pane's strip.** The topmost portal was the
 *     LAST-mounted pane's, while a capture opened the VISIBLE pane's strip — so
 *     after a switch the button could no longer close what the user was
 *     looking at.
 *
 * Both are the same shape the law names: *a module-level value that is
 * per-DOCUMENT is a registry keyed by its owner, never a single slot* — except
 * here the value is not per-document at all. The Stack's chrome is global, so
 * the fix is to mount it ONCE (`StackChromeHost`, above the keep-alive slots)
 * and let each pane publish only the one per-pane fact that chrome needs.
 *
 * ## What a pane publishes
 *
 * ONE fact: whether that pane wants the chrome at all (`viewPrefs && !zenMode`)
 * — a per-pane chrome GATE, registered under the pane's own token.
 *
 * It used to publish a whole `StackTerminal` — the pane's editor, source
 * attribution and bibliography resolvers, resolved for "the active pane"
 * through a `pickActiveByEditor` ladder — as the inputs of the icon's HTML5
 * drop door. Task 590 deleted that door (every Stack producer is an in-app
 * gesture that already runs INSIDE its own pane and captures through the pane's
 * own refs, `captureKeyToStack`), and task 1287 deleted the getters and the
 * ladder with it: a registry earns its name by being read, and a live-looking
 * "which pane is active" resolver nobody calls invites the next producer to ask
 * it instead of its own pane.
 *
 * The gate is an ANY over the registry (`someStackPaneWantsChrome`), which
 * preserves exactly the aggregate semantics the per-pane mount had (the chrome
 * existed if any mounted pane had `viewPrefs && !zenMode`) — including the
 * surfaces where no pane is honestly "active", such as PDF view, where every
 * doc slot is `display:none`. Zen is uniform across doc panes (all read one
 * `zenModeOn`) and always `false` in the Reader, so the ANY is not a guess.
 */

import { useEffect, useState } from "react";

/** One registration. Its identity is what the owner-checked disposer compares,
 *  so a superseded registration under the same token can remove nothing. */
interface Entry {
  wantsChrome: boolean;
}

const registry = new Map<object, Entry>();
const registryListeners = new Set<() => void>();

function emitRegistry() {
  for (const l of registryListeners) l();
}

/**
 * Publish this pane's chrome gate under its own token. A pane re-registers
 * (same token, new entry) when its gate flips — zen toggles, never keystrokes —
 * and that emit is the host's re-render signal. The returned disposer is
 * OWNER-CHECKED: a registration that has already been replaced in the slot
 * removes nothing, so a departing owner can never delete a live owner's entry.
 */
export function registerStackChromeGate(
  token: object,
  wantsChrome: boolean,
): () => void {
  const entry: Entry = { wantsChrome };
  registry.set(token, entry);
  emitRegistry();
  return () => {
    if (registry.get(token) !== entry) return; // already replaced — not ours
    registry.delete(token);
    emitRegistry();
  };
}

/** True when SOME mounted pane wants the Stack chrome (see header: the gate is
 *  an ANY over the registry). */
export function someStackPaneWantsChrome(): boolean {
  for (const entry of registry.values()) {
    if (entry.wantsChrome) return true;
  }
  return false;
}

/** TEST-ONLY: drop every registered gate. */
export function __resetStackChromeGates(): void {
  registry.clear();
  emitRegistry();
}

/**
 * Subscribe to registry membership changes. The host re-reads the gate on each
 * emit; emits happen on mount/unmount of a pane only, never per keystroke.
 */
export function subscribeStackChromeGates(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => {
    registryListeners.delete(fn);
  };
}

// ── The strip-open signal ──────────────────────────────────────────────
//
// `stackOpen` used to be per-pane `useState`, which is what made the icon
// toggle a hidden pane's strip. The strip shows ONE global envelope, so its
// open/closed state is global too — and a capture in any pane opens the one
// strip the user is looking at.

let stripOpen = false;
const openListeners = new Set<() => void>();

function emitOpen() {
  for (const l of openListeners) l();
}

export function isStackStripOpen(): boolean {
  return stripOpen;
}

export function setStackStripOpen(next: boolean): void {
  if (stripOpen === next) return;
  stripOpen = next;
  emitOpen();
}

/** Open the strip so a just-captured item is visible (the capture terminal's
 *  third half — capability + add + SHOW). */
export function openStackStrip(): void {
  setStackStripOpen(true);
}

export function toggleStackStrip(): void {
  setStackStripOpen(!stripOpen);
}

export function useStackStripOpen(): boolean {
  const [open, setOpen] = useState<boolean>(stripOpen);
  useEffect(() => {
    const sub = () => setOpen(isStackStripOpen());
    openListeners.add(sub);
    sub();
    return () => {
      openListeners.delete(sub);
    };
  }, []);
  return open;
}

/** TEST-ONLY: reset the strip to closed. */
export function __resetStackStripOpen(): void {
  stripOpen = false;
  emitOpen();
}
