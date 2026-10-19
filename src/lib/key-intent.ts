/**
 * Key intent — "is this keydown a fresh, deliberate press?" (task 994).
 *
 * Two shapes of keydown are NOT the user asking for an action, and every
 * surface that activates something on a key must say so the same way:
 *
 *   - **IME composition.** While a Japanese/Chinese/Korean input method is
 *     composing, Enter COMMITS the candidate and arrows move within the
 *     candidate list. Those keys belong to the IME. `isComposing` is the
 *     standard flag; `keyCode === 229` is the legacy "IME processed this key"
 *     marker some engines still send instead (Safari's commit Enter).
 *   - **Auto-repeat.** A HELD key repeats. An activation must answer the first
 *     press only — and, if it closed the surface that consumed it, the repeats
 *     that follow must not leak into whatever is now underneath (the editor).
 *
 * Readers: `isPlainEnter` (dialog Enter policy), the menu keyboard controller
 * (`useMenuKeyboard`), the typed-LaTeX Backspace revert. A new key gate asks
 * here rather than re-spelling the check.
 *
 * **Enter has ONE spelling** (task 1165): `isCommitEnter`. Every Enter gate in
 * the app — an inline rename, a label field, a PM `handleKeyDown`, a
 * role=button row — asks it, never a bare `key === "Enter"`, so the Enter that
 * picks an IME candidate can never also commit the field it is typed in.
 * Modifiers and repeat stay the CALLER's question (`isCommitEnter(e) &&
 * e.metaKey`; `isPlainEnter` for dialogs). Pinned by
 * `enter-key-census.test.ts`: this file is the only one that compares a key to
 * "Enter".
 *
 * **Escape has ONE spelling in the menu doors** (task 1188): `isCancelEscape`.
 * Escape pressed mid-composition CANCELS THE COMPOSITION — it is the IME's key,
 * not "cancel this menu / field". Pinned (for the menu-door population — every
 * file built on `@/components/menu`) by `menu-key-intent-census.test.ts`.
 *
 * **"Would this key EDIT the document?" has ONE spelling** (task 1189):
 * `editsDocument`. It decides by EFFECT, not by modifier — Option/AltGr type
 * characters and Option/Cmd+Backspace delete words and lines, so "any modifier
 * means a command" is wrong. Reader: the menu controller's owned-host rule
 * (task 1180), which swallows every editing key behind an open caret-parked
 * menu while commands (undo, clipboard, select-all) still pass.
 */

import { isMac } from "@/lib/platform";

type KeyLike = Pick<KeyboardEvent, "isComposing" | "keyCode" | "key" | "code" | "repeat">;

/**
 * What the IME probe reads — a DOM `KeyboardEvent` or a React synthetic one
 * (React's type carries no `isComposing`; its `nativeEvent` does).
 */
type ImeProbe = {
  keyCode: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};

/** True while an IME owns the key (composition in progress or the 229 marker). */
export function isImeComposing(e: ImeProbe): boolean {
  return !!e.isComposing || !!e.nativeEvent?.isComposing || e.keyCode === 229;
}

/**
 * An Enter the USER pressed — not the IME's candidate-commit Enter. The one
 * spelling of "is this keydown Enter?" (see the docblock above).
 */
export function isCommitEnter(e: ImeProbe & { key: string }): boolean {
  return e.key === "Enter" && !isImeComposing(e);
}

/**
 * An Escape the USER pressed to cancel — not the IME's composition-cancel
 * Escape. Repeat stays the caller's question (a cancel answers the first press;
 * see `useMenuDismiss`).
 */
export function isCancelEscape(e: ImeProbe & { key: string }): boolean {
  return e.key === "Escape" && !isImeComposing(e);
}

/** A fresh, non-IME press — the only kind that may ACTIVATE something. */
export function isDeliberateKeyPress(e: ImeProbe & { repeat: boolean }): boolean {
  return !e.repeat && !isImeComposing(e);
}

/**
 * The macOS Cocoa text-system Ctrl bindings that EDIT rather than move:
 * Ctrl+H (delete back), Ctrl+D (delete forward), Ctrl+K (kill to line end),
 * Ctrl+O (open line), Ctrl+T (transpose). Ctrl+A/E/F/B/N/P only move the caret.
 */
const MAC_CTRL_EDIT_KEYS = new Set(["h", "d", "k", "o", "t"]);

type EditProbe = ImeProbe &
  Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">;

/**
 * Would this keydown EDIT the document if it reached the editor? Decided by
 * effect (task 1189):
 *
 *   - **Backspace / Delete, with ANY modifier** — Option/Ctrl deletes a word,
 *     Cmd deletes to the line start.
 *   - **Enter, unless Meta/Ctrl is held** — Shift/Alt+Enter still break the
 *     line; Mod+Enter is an app command.
 *   - **A printable character, unless Meta or plain Ctrl is held** — Shift types
 *     a capital, Mac Option types "å"/"™", and AltGr arrives as Ctrl+Alt and
 *     types "@"/"€"/"{" on European layouts.
 *   - **On macOS, Ctrl+H/D/K/O/T** — the Cocoa text-editing bindings.
 *
 * Everything else — Cmd/Ctrl+Z, +C/X/V, +A, arrows, Tab, Escape — is a
 * command or navigation and is NOT an edit by this predicate. An IME-composing
 * key is the IME's, never ours (task 994): answered false.
 */
export function editsDocument(e: EditProbe, mac: boolean = isMac()): boolean {
  if (isImeComposing(e)) return false;
  const key = typeof e.key === "string" ? e.key : "";
  if (key === "Backspace" || key === "Delete") return true;
  if (key === "Enter") return !e.metaKey && !e.ctrlKey;
  if (
    mac &&
    e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    MAC_CTRL_EDIT_KEYS.has(key.toLowerCase())
  ) {
    return true;
  }
  if (key.length !== 1) return false;
  if (e.metaKey) return false;
  // Plain Ctrl is a command (Ctrl+Z/V on Windows/Linux); Ctrl+Alt is AltGr.
  if (e.ctrlKey && !e.altKey) return false;
  return true;
}

/** Two events name the same physical key (code when known, else the key, case-folded). */
function sameKey(a: { key: string; code: string }, e: Pick<KeyLike, "key" | "code">): boolean {
  if (a.code && e.code) return a.code === e.code;
  return a.key.toLowerCase() === (e.key ?? "").toLowerCase();
}

let disarmRepeatSwallow: (() => void) | null = null;

/**
 * Called by a surface that just ACTIVATED on a keydown and may now close. Until
 * that key is released, its auto-repeat keydowns are eaten at window capture —
 * so a held Enter/Backspace that ran a menu row does not go on to type into (or
 * delete from) the editor the closing menu uncovers.
 *
 * One-shot and self-disarming: the matching keyup, any FRESH keydown (a new
 * press ends the old key's repeat on every OS), or window blur. Re-arming
 * replaces any previous arm. A listener added during the current keydown's
 * dispatch is not invoked for that same event, so the activating press itself
 * is untouched.
 */
export function swallowRepeatsUntilKeyup(e: Pick<KeyLike, "key" | "code">): void {
  if (typeof window === "undefined") return;
  disarmRepeatSwallow?.();
  const held = { key: e.key ?? "", code: e.code ?? "" };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!ev.repeat) {
      disarm();
      return;
    }
    if (!sameKey(held, ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    if (sameKey(held, ev)) disarm();
  };
  const disarm = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", disarm);
    if (disarmRepeatSwallow === disarm) disarmRepeatSwallow = null;
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", disarm);
  disarmRepeatSwallow = disarm;
}

/** Test seam: drop any armed swallow. */
export function __resetRepeatSwallowForTests(): void {
  disarmRepeatSwallow?.();
}
