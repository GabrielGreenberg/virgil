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
 *
 * Motion is NOT React state (task 773). The store emits only on EDGES — the
 * ghost lifting and ending — and the cursor rides the shared
 * cursor-following channel (`@/lib/transform-channel`, the same one the
 * block lift's `LiftHost` moves by): a RAF-coalesced, equality-bailed
 * `translate3d` written imperatively to the portal node the component
 * registers through `attachGhostNode`. The pre-773 shape emitted a new state
 * per RAW mousemove, so every event re-rendered the portal and wrote
 * `left`/`top` on a `position:fixed` node — a render plus a layout write per
 * event, during a gesture whose hit-test also reads layout.
 */

import { useSyncExternalStore } from "react";
import { createTransformChannel } from "@/lib/transform-channel";
// The strip list must mirror what the atom PRODUCERS emit, so it spells the
// attribute names from the same module they do (task 202).
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  DATA_LINK_KIND,
} from "@/links/link-dom-contract";
import { CARD_ATOM_DOM_ID_ATTRS } from "@/lib/tiptap/atom-registry";

export interface InlineAtomGhostState {
  /** Sanitized, detached clone of the grabbed atom's NodeView DOM. */
  el: HTMLElement;
  /** Grab point as an offset from the atom rect's top-left (viewport px),
   *  so the cursor pins to exactly where the user pressed on the glyph. */
  grabOffsetX: number;
  grabOffsetY: number;
}

let _state: InlineAtomGhostState | null = null;
const _listeners = new Set<() => void>();

/** Gap between the cursor and the ghost's near edge (px). */
const GHOST_GAP = 14;
/** Above this viewport-y the ghost flips BELOW the cursor so it can't clip
 *  off the top edge. */
const GHOST_FLIP_Y = 60;

/**
 * Where the ghost sits for a live cursor. The node's base box is pinned at the
 * viewport origin (`left:0; top:0`), so the whole placement is ONE transform:
 * the grab offset pins it horizontally near where the atom was grabbed, and the
 * trailing `translateY` displaces it off the cursor so it never covers the
 * insert point (the cursor and the blue inline bar share that spot) — above the
 * cursor by default, below near the viewport top. `translateY`'s `%` resolves
 * against the ghost's own content-sized height, so no measurement is needed.
 */
export function ghostTransform(
  cursorX: number,
  cursorY: number,
  grabOffsetX: number,
): string {
  const displace =
    cursorY < GHOST_FLIP_Y
      ? `translateY(${GHOST_GAP}px)`
      : `translateY(calc(-100% - ${GHOST_GAP}px))`;
  return `translate3d(${cursorX - grabOffsetX}px, ${cursorY}px, 0) ${displace}`;
}

/** The mounted portal node (null until the component commits, and after). */
let _node: HTMLElement | null = null;

const _motion = createTransformChannel({
  targets: () => [_node],
  format: (x, y) => ghostTransform(x, y, _state?.grabOffsetX ?? 0),
});

/**
 * The component's ref: register (or release) the node the channel writes. On
 * mount the live cursor is written SYNCHRONOUSLY — a ref runs in the commit,
 * before paint, so the ghost never paints at the viewport origin, and a
 * frame queued before the portal existed (which applied nothing) is folded
 * into this write rather than left to land later.
 */
export function attachGhostNode(node: HTMLElement | null): void {
  _node = node;
  _motion.reset();
  if (node) _motion.flush();
}

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
  // The Card-bearing atoms' id attrs, READ from `ATOM_REGISTRY` (task 645) —
  // a fifth Card-bearing kind is stripped from the ghost for free instead of
  // silently riding into the clone with a live id.
  ...CARD_ATOM_DOM_ID_ATTRS,
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
 *  seed the cursor. Called once at the `InlineAtomGrab` threshold-cross — an
 *  EDGE, so it emits; the component mounts and `attachGhostNode` places it. */
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
  };
  _motion.cancel();
  _motion.reset();
  _motion.set(opts.cursorX, opts.cursorY);
  emit();
}

/** Track the cursor — per RAW mousemove, so it NEVER emits: it records the
 *  live value on the motion channel, which writes at most once per frame and
 *  not at all at an unchanged cursor. */
export function updateGhostCursor(cursorX: number, cursorY: number): void {
  if (!_state) return;
  _motion.set(cursorX, cursorY);
}

/** End the ghost (gesture commit / cancel / cleanup). Idempotent. Drops any
 *  queued frame first, so no write lands behind the gesture's end. */
export function clearGhost(): void {
  _motion.cancel();
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
