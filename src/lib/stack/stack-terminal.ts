"use client";

/**
 * THE Stack's per-pane terminal registry + the one strip-open signal.
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
 * and let each pane publish only the per-doc facts that chrome needs.
 *
 * ## What a pane publishes
 *
 * A {@link StackTerminal} is the small bag of per-doc answers the single Stack
 * chrome asks for: the doc's editor + attribution + bibliography (the HTML5
 * capture door's inputs — every Stack producer answers the bib question at the
 * add door, task 235), and whether that pane's view is in zen mode.
 *
 * Resolution mirrors `drop-mode/controller.ts`'s `getDropCtx` — the same ladder,
 * for the same reason — 0 entries → null; 1 entry → that one WHATEVER its editor
 * looks like (a pane whose editor has not been created yet, and every hand-built
 * fixture, must still resolve); N entries → focused-then-visible via
 * `pickActiveByEditor`, else `null`. NEVER "whichever registered last".
 *
 * The ZEN gate is deliberately NOT the resolved terminal's answer: it is
 * `someTerminalWantsChrome()`, an ANY over the registry. That preserves exactly
 * today's aggregate semantics (the chrome existed if any mounted pane had
 * `viewPrefs && !zenMode`) — including the surfaces where the ladder is
 * honestly ambiguous, such as PDF view, where every doc slot is `display:none`
 * and no pane wins. Zen is uniform across doc panes (all read one
 * `zenModeOn`) and always `false` in the Reader, so the ANY is not a guess.
 */

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { pickActiveByEditor } from "@/lib/active-editor-probe";
import type { StackBibCtx } from "@/lib/stack/bib-carry";

export interface StackTerminal {
  /** This pane's main editor, or `null` before it is created / in a
   *  view-less fixture. Read live (a getter) because a pane registers once and
   *  its editor arrives later. */
  getEditor: () => Editor | null;
  /** Source attribution stamped onto items this pane's chrome captures. */
  getSource: () => { docId: string | null };
  /** The SOURCE doc's bibliography resolvers for the add door (task 235). */
  getBibCtx: () => StackBibCtx;
  /** False while this pane has no `viewPrefs` or is in zen mode — the chrome
   *  gate this pane would have applied to its own copy. A plain VALUE, not a
   *  getter: it is the one field the host has to re-render on, so a pane
   *  re-registers (same token, new terminal) when it flips, and that
   *  registration emit is the host's signal. Zen toggles, not keystrokes. */
  wantsChrome: boolean;
}

interface Entry {
  token: object;
  terminal: StackTerminal;
}

const registry = new Map<object, Entry>();
const registryListeners = new Set<() => void>();

function emitRegistry() {
  for (const l of registryListeners) l();
}

/**
 * Publish this pane's terminal under its own token. The returned disposer is
 * OWNER-CHECKED: a pane that has already been replaced in the slot removes
 * nothing, so a departing owner can never delete a live owner's entry.
 */
export function registerStackTerminal(
  token: object,
  terminal: StackTerminal,
): () => void {
  registry.set(token, { token, terminal });
  emitRegistry();
  return () => {
    const entry = registry.get(token);
    if (!entry || entry.terminal !== terminal) return; // already replaced — not ours
    registry.delete(token);
    emitRegistry();
  };
}

/** The ACTIVE pane's terminal — see the ladder in this module's header. */
export function getStackTerminal(): StackTerminal | null {
  if (registry.size === 0) return null;
  if (registry.size === 1) {
    return registry.values().next().value?.terminal ?? null;
  }
  const picked = pickActiveByEditor(registry.values(), (e) =>
    e.terminal.getEditor(),
  );
  return picked ? picked.terminal : null;
}

/** True when SOME mounted pane wants the Stack chrome (see header: the gate is
 *  an ANY, not the resolved terminal's answer). */
export function someTerminalWantsChrome(): boolean {
  for (const entry of registry.values()) {
    if (entry.terminal.wantsChrome) return true;
  }
  return false;
}

/** TEST-ONLY: drop every registered terminal. */
export function __resetStackTerminals(): void {
  registry.clear();
  emitRegistry();
}

/**
 * Subscribe to registry membership changes. The host re-reads the gate on each
 * emit; emits happen on mount/unmount of a pane only, never per keystroke.
 */
export function subscribeStackTerminals(fn: () => void): () => void {
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
