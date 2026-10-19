"use client";

/**
 * SELECTION ALIGNMENT — the ONE door a "show me this card" click enters to put
 * the selected card level with the thing the user clicked (task 1179).
 *
 * A margin marker click (and an in-text anchor click, and the footnote /
 * citation atom clicks) selects a card. The marker already wears the selection
 * halo; this door makes the CARD meet it: its top lands at the clicked
 * viewport Y, in whichever host shows it. Before this module the click path
 * had two unrelated mechanisms — Omni got an anchor-relative pin
 * (`alignOmniCardWithClick`), a docked list got a `block:"nearest"` scroll
 * that did nothing for a visible card — so only Omni could ever align.
 *
 * Two strategies behind one door, chosen by what is MOUNTED (visible pane,
 * fail-closed — a hidden keep-alive pane's card is never the target):
 *
 *  • **Omni** — the card's positioned wrapper is present → the existing pin
 *    door (`requestOmniCardPlacement`) with the `"selection-alignment"`
 *    intent, so the pin is written even for a visible, nearby card.
 *  • **Native list** — the card sits in a panel list with its OWN scroll
 *    (docked or floating) → the LIST slides: one rect read of the card and
 *    one of the scroller, then a scrollTop delta, plus transient spacer
 *    padding where the list cannot otherwise reach the target (a card near
 *    the top or bottom). Pod-relative by construction (scroll-anchor law case
 *    (a)): the card moves with its list by layout; no scroll listener ever
 *    re-solves it.
 *
 * Event-driven and walk-free: the door runs once per selection gesture, in
 * the frame after React commits the selection (so a card's collapsed/expanded
 * tier is measured as painted, never before). It reads no document, calls no
 * `coordsAtPos`, and subscribes to no editor event — the marker's Y is the
 * click's own `clientY`.
 *
 * Release (native list): the slide is a one-shot alignment, like the Omni
 * pin — DOCUMENT scroll does not touch it. It releases, animating its spacer
 * away, when the selection changes (the doc's own store), when the user
 * scrolls the list (wheel / touch drag / scroll keys / scrollbar press — USER intent,
 * never the `scroll` event our own writes raise), when the list re-sorts or
 * filters (its children change), or when the list is hidden (pane switch).
 * The slide is OWNER-KEYED by the doc's card store (multi-pane keep-alive:
 * each pane's doc has its own store, so one pane's selection can neither
 * release nor replace another's slide).
 */

import type { CardStore } from "@/links/_shared/anchored-card-store";
import { mayReposition } from "@/lib/reposition-policy";
import { isLayoutGestureActive } from "@/lib/pane-resize/layout-gesture-bus";
import { isEditableEventTarget } from "@/lib/drag-blocklist";
import { requestOmniCardPlacement } from "./omni-card-placement";
import { omniEntrySelector } from "./event-bridges/open-for-card";
import { findRowScrollFor, findScrollParent } from "./layout-scroll";
import { resolvePaneMarker } from "./pane-dom";

/** Matches `.omni-entry-slide` (globals.css) — one motion for both hosts. */
export const SELECTION_SLIDE_MS = 180;

/** How many frames to look for the card before giving up. A freshly opened
 *  panel needs two to commit its list; a third is slack for a cold mount. */
const MAX_FRAMES = 3;

export interface SelectedCardPlacement {
  /** The omni item id (`cardPopKey`, `@<pid>`-suffixed for a multi-anchor
   *  card's clicked row). */
  omniKey: string;
  /** The native-panel card selector (`cardEntrySelector`). */
  entrySelector: string;
  /** The clicked marker's viewport Y — where the card's top should land. */
  viewportY: number;
  /** The doc's interaction store — the slide's OWNER, and its release
   *  signal (a selection change). */
  store: CardStore;
}

/**
 * Put the selected card level with `viewportY`, in whichever host shows it.
 * Never moves the document.
 */
export function placeSelectedCard(p: SelectedCardPlacement): void {
  if (typeof window === "undefined") return;
  let frame = 0;
  const attempt = () => {
    frame++;
    if (isLayoutGestureActive()) return; // no slide during a layout gesture
    if (placeNow(p)) return;
    if (frame < MAX_FRAMES) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** One placement attempt. Returns whether a host for the card was found
 *  (whether or not anything then had to move). */
function placeNow(p: SelectedCardPlacement): boolean {
  const wrapper = resolvePaneMarker(
    omniEntrySelector(p.omniKey, "data-omni-entry-wrapper"),
    "fail-closed",
  );
  if (wrapper) {
    requestOmniCardPlacement(
      p.omniKey,
      { viewportY: p.viewportY },
      "selection-alignment",
    );
    return true;
  }
  const entry = resolvePaneMarker(p.entrySelector, "fail-closed");
  if (!entry) return false;
  slideListEntry(entry, p.viewportY, p.store);
  return true;
}

/* ── Native-list slide ─────────────────────────────────────────────── */

/** The list's OWN scroller — never the shared row scroll, whose movement
 *  would drag the document. Null when the card scrolls with the row. */
export function listScrollerFor(entry: HTMLElement): HTMLElement | null {
  const own = findScrollParent(entry);
  if (!own || own === findRowScrollFor(entry)) return null;
  return own;
}

/** A list's slide geometry. `offset` is the one number a slide animates:
 *  `padTop − scrollTop` (how far the content's top sits below the list's
 *  natural top). Positive needs a top spacer; negative is a plain scroll,
 *  with a bottom spacer once it passes the natural maximum. */
export interface SlideFrame {
  padTop: number;
  padBottom: number;
  scrollTop: number;
}

/** Resolve `offset` into a frame, given the list's natural maximum scroll
 *  (no spacers). Pure — the arithmetic the tests pin. */
export function frameForOffset(offset: number, naturalMax: number): SlideFrame {
  const padTop = Math.max(0, offset);
  const scrollTop = Math.max(0, -offset);
  const padBottom = Math.max(0, scrollTop - Math.max(0, naturalMax));
  return { padTop, padBottom, scrollTop };
}

/** The offset that puts a card whose top is now at `entryTop` at `targetY`,
 *  given the list's current offset. */
export function offsetForTarget(
  currentOffset: number,
  entryTop: number,
  targetY: number,
): number {
  return currentOffset - (entryTop - targetY);
}

/** Where a released slide settles: no spacer, the content as close to where
 *  it is as the natural list allows. */
export function releasedOffset(offset: number, naturalMax: number): number {
  return Math.min(0, Math.max(-Math.max(0, naturalMax), offset));
}

interface ListSlide {
  scroller: HTMLElement;
  /** The inline padding the scroller had before the slide (restored on
   *  release — usually empty, the CSS class supplies the base). */
  inlinePadTop: string;
  inlinePadBottom: string;
  /** The CSS base padding the spacer is ADDED to. */
  basePadTop: number;
  basePadBottom: number;
  offset: number;
  anim: number | null;
  teardown: () => void;
}

/** Live slides, one per owner (the doc's card store). */
const slides = new WeakMap<CardStore, ListSlide>();
/** And by scroller, so a second store can't stack spacers on one list. */
const byScroller = new WeakMap<HTMLElement, ListSlide>();

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The scroll extent with NO spacer — read once per gesture. */
function naturalMaxOf(s: ListSlide): number {
  const { scroller } = s;
  const pads = Math.max(0, s.offset) + currentPadBottom(s);
  return scroller.scrollHeight - pads - scroller.clientHeight;
}

function currentPadBottom(s: ListSlide): number {
  const v = parseFloat(s.scroller.style.paddingBottom);
  return Number.isFinite(v) ? Math.max(0, v - s.basePadBottom) : 0;
}

function writeFrame(s: ListSlide, f: SlideFrame): void {
  const { scroller } = s;
  scroller.style.paddingTop = `${s.basePadTop + f.padTop}px`;
  scroller.style.paddingBottom = `${s.basePadBottom + f.padBottom}px`;
  scroller.scrollTop = f.scrollTop;
}

/** Animate `s.offset` → `to` (ease-out, `SELECTION_SLIDE_MS`), instantly
 *  under reduced motion or a layout gesture. Every frame is computed from the
 *  one `naturalMax` read at the start — nothing re-solves per frame. */
function animateTo(s: ListSlide, to: number, done?: () => void): void {
  if (s.anim !== null) cancelAnimationFrame(s.anim);
  s.anim = null;
  const naturalMax = naturalMaxOf(s);
  const from = s.offset;
  const finish = () => {
    s.offset = to;
    writeFrame(s, frameForOffset(to, naturalMax));
    done?.();
  };
  if (from === to || reducedMotion() || isLayoutGestureActive()) {
    finish();
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SELECTION_SLIDE_MS);
    if (t >= 1) {
      s.anim = null;
      finish();
      return;
    }
    const eased = 1 - (1 - t) ** 3;
    s.offset = from + (to - from) * eased;
    writeFrame(s, frameForOffset(s.offset, naturalMax));
    s.anim = requestAnimationFrame(step);
  };
  s.anim = requestAnimationFrame(step);
}

/** End a slide: animate its spacer away (or drop it at once when the list is
 *  no longer on screen), then restore the scroller's own inline padding. */
function release(s: ListSlide, owner: CardStore | null, animate: boolean): void {
  s.teardown();
  if (owner && slides.get(owner) === s) slides.delete(owner);
  if (byScroller.get(s.scroller) === s) byScroller.delete(s.scroller);
  const restore = () => {
    s.scroller.style.paddingTop = s.inlinePadTop;
    s.scroller.style.paddingBottom = s.inlinePadBottom;
  };
  if (!animate || !s.scroller.isConnected) {
    if (s.anim !== null) cancelAnimationFrame(s.anim);
    s.anim = null;
    const naturalMax = naturalMaxOf(s);
    const settle = releasedOffset(s.offset, naturalMax);
    restore();
    s.scroller.scrollTop = Math.max(0, -settle);
    return;
  }
  const naturalMax = naturalMaxOf(s);
  animateTo(s, releasedOffset(s.offset, naturalMax), restore);
}

/** Keys that scroll a focused list. Any other key — typing inside the
 *  selected card's own editor — is not a scroll and releases nothing. */
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", " "]);

function slideListEntry(entry: HTMLElement, targetY: number, store: CardStore): void {
  const scroller = listScrollerFor(entry);
  if (!scroller) return; // row-scrolled: aligning would move the document
  // One slide per owner and per list: a new selection replaces the old
  // slide, CONTINUING from its spacer rather than snapping it away first.
  const prior = slides.get(store) ?? byScroller.get(scroller) ?? null;
  let carried: { offset: number; base: [number, number]; inline: [string, string] } | null = null;
  if (prior) {
    prior.teardown();
    if (prior.anim !== null) cancelAnimationFrame(prior.anim);
    prior.anim = null;
    slides.delete(store);
    byScroller.delete(prior.scroller);
    if (prior.scroller === scroller) {
      carried = {
        offset: prior.offset,
        base: [prior.basePadTop, prior.basePadBottom],
        inline: [prior.inlinePadTop, prior.inlinePadBottom],
      };
    } else {
      release(prior, null, true);
    }
  }

  // The two reads this gesture costs (task 1179's contract): the card's
  // rect and the scroller's — read before any write.
  const rect = entry.getBoundingClientRect();
  const band = scroller.getBoundingClientRect();
  let basePadTop: number;
  let basePadBottom: number;
  if (carried) {
    [basePadTop, basePadBottom] = carried.base;
  } else {
    const cs = getComputedStyle(scroller);
    basePadTop = parseFloat(cs.paddingTop) || 0;
    basePadBottom = parseFloat(cs.paddingBottom) || 0;
  }
  const currentOffset = carried ? carried.offset : -scroller.scrollTop;
  const verdict = mayReposition({
    current: rect.top,
    target: targetY,
    rect,
    band,
    intent: "selection-alignment",
  });

  const s: ListSlide = {
    scroller,
    inlinePadTop: carried ? carried.inline[0] : scroller.style.paddingTop,
    inlinePadBottom: carried ? carried.inline[1] : scroller.style.paddingBottom,
    basePadTop,
    basePadBottom,
    offset: currentOffset,
    anim: null,
    teardown: () => {},
  };
  if (verdict === "hold") {
    // Already level (jitter): nothing moves. A carried spacer stays as it is
    // and keeps its release triggers.
    if (!carried) return;
  }
  slides.set(store, s);
  byScroller.set(scroller, s);
  s.teardown = armRelease(s, store, entry);
  if (verdict !== "hold") {
    animateTo(s, offsetForTarget(currentOffset, rect.top, targetY));
  }
}

/** Wire the release triggers for a live slide; returns their disposer. */
function armRelease(s: ListSlide, store: CardStore, entry: HTMLElement): () => void {
  const { scroller } = s;
  const selected = store.getSelectedSnapshot();
  const end = () => release(s, store, true);

  // Selection changed (deselect, or another card) — the store notifies on
  // hover too, so compare the selection snapshot's identity: O(1).
  const unsubscribe = store.subscribe(() => {
    if (store.getSelectedSnapshot() !== selected) end();
  });

  // The USER scrolling the list. Our own scrollTop writes raise `scroll`, so
  // the intent events are what is listened for; a scrollbar press targets
  // the scroller itself (a press on a card is a click, not a scroll).
  const onIntent = () => end();
  const onPointerDown = (e: Event) => {
    if (e.target === scroller) end();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key) && !isEditableEventTarget(e.target)) end();
  };
  scroller.addEventListener("wheel", onIntent, { passive: true });
  scroller.addEventListener("touchmove", onIntent, { passive: true });
  scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
  scroller.addEventListener("keydown", onKeyDown);

  // Re-sort / filter: some container between the card and its scroller
  // gains, loses or reorders a child. childList only, one observer over that
  // short ancestor path — never subtree, never characterData, never the
  // editor.
  const mo =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => end())
      : null;
  if (mo) {
    for (let el = entry.parentElement; el; el = el.parentElement) {
      mo.observe(el, { childList: true });
      if (el === scroller) break;
    }
  }

  // The list hidden (keep-alive pane switch, panel closed): a zero-height
  // box. Released WITHOUT animation — nobody can see it.
  let first = true;
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          if (first) {
            first = false;
            return;
          }
          const box = entries[entries.length - 1]?.contentRect;
          if (box && box.height === 0) release(s, store, false);
        })
      : null;
  ro?.observe(scroller);

  return () => {
    unsubscribe();
    scroller.removeEventListener("wheel", onIntent);
    scroller.removeEventListener("touchmove", onIntent);
    scroller.removeEventListener("pointerdown", onPointerDown);
    scroller.removeEventListener("keydown", onKeyDown);
    mo?.disconnect();
    ro?.disconnect();
  };
}
