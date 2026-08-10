/**
 * Module store for the inline-atom drag ghost — the data the
 * `<InlineAtomGhost>` overlay renders while an Atom is being dragged in
 * the prose.
 *
 * The `InlineAtomGrab` ProseMirror plugin is NOT a React component, so it
 * can't drive a React overlay directly (the way `TextObjectGrabHandle`
 * drives `<LiftedTextOverlay>` for the block lift). Instead it writes this
 * module store and a small React subscriber reads it via
 * `useSyncExternalStore` — the same producer/subscriber split the drop-mode
 * controller ↔ `Indicator` already use. The store idiom mirrors
 * `@/links/_shared/anchored-card-store`.
 *
 * The ghost holds a sanitized `cloneNode` of the grabbed atom as a live
 * `HTMLElement` (NOT an HTML string): inline-math renders KaTeX into the
 * DOM, and an `outerHTML` round-trip re-parsed via `dangerouslySetInnerHTML`
 * mangles the embedded MathML subtree — so we append the node, exactly as
 * `LiftedTextOverlay` does (and for the same reason).
 *
 * Keystroke-sanctity: gesture-only. The setters are called from the grab
 * plugin's mousedown/mousemove handlers, never per keystroke or per
 * transaction.
 */

import { useSyncExternalStore } from "react";
// The strip list must mirror what the atom PRODUCERS emit, so it spells the
// attribute names from the same module they do (task 202).
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  DATA_LINK_KIND,
} from "@/links/link-dom-contract";

export interface InlineAtomGhostState {
  /** Sanitized, detached clone of the grabbed atom's NodeView DOM. */
  el: HTMLElement;
  /** Grab point as an offset from the atom rect's top-left (viewport px),
   *  so the cursor pins to exactly where the user pressed on the glyph. */
  grabOffsetX: number;
  grabOffsetY: number;
  /** Live cursor in viewport px; updated every mousemove during the drag. */
  cursorX: number;
  cursorY: number;
}

let _state: InlineAtomGhostState | null = null;
const _listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(): void {
  for (const fn of _listeners) fn();
}

/** Attributes that drive live chrome (hover/selected/anchor tints) or carry
 *  identity — stripped so the ghost is a clean visual snapshot. Mirrors the
 *  clone sanitize in `TextObjectGrabHandle`/`LiftedTextOverlay`; the
 *  `data-link-*` / id attrs are atom-specific and defensive (the ghost is
 *  `pointer-events:none`, so its clone never satisfies a hit-test anyway).
 *
 *  Half constant, half literal, on purpose. The first three are the parser-facing
 *  link DOM CONTRACT and come from its one speller. The rest — including
 *  `data-link-highlight`, which despite the prefix is transient view state
 *  written by `useLinkHighlight` and read only by CSS — are private view attrs
 *  with no cross-repo consumer, so they are not contract members and the
 *  contract module deliberately does not declare them. If one of them ever gains
 *  a second producer, single-source it where it is produced, not here. */
const STRIP_ATTRS = [
  DATA_LINK_ID,
  DATA_LINK_KIND,
  DATA_LINK_CARD,
  "data-link-highlight",
  "data-tint-color",
  "data-card-hovered",
  "data-card-selected",
  "data-footnote-id",
  "data-citation-id",
];

function sanitizeClone(src: HTMLElement): HTMLElement {
  const c = src.cloneNode(true) as HTMLElement;
  // Keep `contenteditable="false"` (the atom NodeViews set it; the editor's
  // `[contenteditable="false"]` white-space shield keys on it) — strip only
  // editable-making values, same as the block lift.
  const stripIfEditable = (el: Element) => {
    const v = el.getAttribute("contenteditable");
    if (v !== null && v !== "false") el.removeAttribute("contenteditable");
  };
  stripIfEditable(c);
  c.querySelectorAll("[contenteditable]").forEach(stripIfEditable);
  c.removeAttribute("id");
  c.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  for (const attr of STRIP_ATTRS) {
    if (c.hasAttribute(attr)) c.removeAttribute(attr);
    c.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  }
  c.style.pointerEvents = "none";
  return c;
}

/** Begin the ghost: clone + sanitize the grabbed atom, pin the grab offset,
 *  seed the cursor. Called once at the `InlineAtomGrab` threshold-cross. */
export function setGhost(opts: {
  el: HTMLElement;
  grabOffsetX: number;
  grabOffsetY: number;
  cursorX: number;
  cursorY: number;
}): void {
  _state = {
    el: sanitizeClone(opts.el),
    grabOffsetX: opts.grabOffsetX,
    grabOffsetY: opts.grabOffsetY,
    cursorX: opts.cursorX,
    cursorY: opts.cursorY,
  };
  emit();
}

/** Track the cursor — a NEW state object but the SAME clone reference, so the
 *  subscriber's append-effect (keyed on `el`) never re-runs; only the
 *  wrapper's `top`/`left` change. */
export function updateGhostCursor(cursorX: number, cursorY: number): void {
  if (!_state) return;
  _state = { ..._state, cursorX, cursorY };
  emit();
}

/** End the ghost (gesture commit / cancel / cleanup). Idempotent. */
export function clearGhost(): void {
  if (!_state) return;
  _state = null;
  emit();
}

// `getSnapshot` returns the stored state reference directly — stable between
// emits (setters replace the whole object), which `useSyncExternalStore`
// requires to avoid an infinite render loop.
const getSnapshot = (): InlineAtomGhostState | null => _state;
const getServerSnapshot = (): InlineAtomGhostState | null => null;

/** Subscribe a React component to the ghost. */
export function useInlineAtomGhost(): InlineAtomGhostState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
