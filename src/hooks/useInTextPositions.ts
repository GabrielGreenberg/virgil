"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { isAnchorableNode } from "@/lib/marginalia";
import { getLinkedTextObjectIds } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { useIsVisible } from "@/lib/keep-alive/visibility-context";
import { getBus } from "@/lib/tiptap/doc-structure";
import { onFontReady } from "@/lib/text-metrics";

/** Viewport gating margin — items within ±NEAR_ZONE_PX of the visible
 *  range still get measured, so scrolling slightly doesn't flash through
 *  default-height placeholders. */
const NEAR_ZONE_PX = 600;

export interface PositionItem {
  id: string;
  pos: number; // ProseMirror document position
}

/**
 * Helper: extract positions for link-anchored items. Uses the first
 * paragraph in each card's `links` array to resolve a doc position.
 *
 * CHIP-B contract: a card whose first pid isn't in the live doc's
 * `uuidToPos` map is skipped — but that skip means "this paragraph isn't a
 * live anchorable node right now" (genuinely off-screen blocks are still in
 * the doc, so they DO resolve a pos and are kept; the cascade resolver then
 * positions them). Deciding that a card's *stored* uuid is dead and needs
 * snapshot/mark recovery is NO LONGER this helper's call — that lives in the
 * anchor-recovery SSOT (`resolveCardAnchor`), which the margin-marker builder
 * (`EditorPane.marginaliaMarkers`) runs upstream so the pids that reach the
 * render layer are already resolved-or-orphan-flagged. Callers that want
 * recovery should feed resolver-resolved pids; this helper does only the
 * live-doc position lookup.
 */
export function getParagraphAnchorPositions(
  editor: Editor | null,
  items?: ReadonlyArray<{ id: string; links?: Link[] }>,
): PositionItem[] {
  if (!editor || !items) return [];
  const uuidToPos = new Map<string, number>();
  editor.state.doc.descendants((node, pos) => {
    if (isAnchorableNode(node.type) && node.attrs?.uuid) {
      uuidToPos.set(node.attrs.uuid as string, pos);
    }
    return true;
  });
  const out: PositionItem[] = [];
  for (const it of items) {
    const pids = getLinkedTextObjectIds(it);
    if (pids.length > 0) {
      const pos = uuidToPos.get(pids[0]);
      if (pos !== undefined) out.push({ id: it.id, pos });
    }
  }
  return out;
}


/**
 * Helper: find approximate document position for a text snippet.
 * Used by RevisionsPanel where comments store selectedText but no pos.
 */
export function findTextPosition(editor: Editor | null, text: string): number {
  if (!editor || !text) return 0;
  const docText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
  const snippet = text.slice(0, 40);
  const idx = docText.indexOf(snippet);
  if (idx < 0) return 0;
  // Convert text offset to doc position
  let pos = 0;
  let textOffset = 0;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos > 0) return false;
    if (node.isText) {
      const len = (node.text || "").length;
      if (textOffset + len > idx) {
        pos = nodePos + (idx - textOffset);
        return false;
      }
      textOffset += len;
    } else if (node.isBlock && textOffset > 0) {
      textOffset += 1;
    }
    return true;
  });
  return pos;
}

const MIN_GAP = 4; // small extra gap between entries beyond their height
const DEFAULT_ENTRY_HEIGHT = 60; // fallback before entries are rendered

/**
 * Settle-loop tuning. The post-mount rAF stabilization loop re-measures
 * after layout settles (web-font swap, KaTeX/expex/figure NodeView mount).
 * It is self-terminating: it stops the FIRST frame the editor's
 * `scrollHeight` is unchanged from the prior frame (`SETTLE_STABLE_FRAMES`
 * = 1 stable observation), or hard-stops after `SETTLE_MAX_FRAMES` frames
 * (~500ms @ 60fps) so a perpetually-animating doc can never spin it
 * forever. It is armed ONCE per mount/enable and never re-armed by a
 * transaction — so it is off the keystroke path entirely.
 */
const SETTLE_MAX_FRAMES = 30;
const SETTLE_STABLE_FRAMES = 1;

/**
 * Degenerate-measure threshold. On a cold/un-laid-out editor `coordsAtPos`
 * reports anchors above the pod top, so the *pre-clamp* natural goes
 * strongly negative; the old `if (naturalTop < 0) naturalTop = 0` clamp
 * baked those into a top-stack. A legitimate all-top-anchored deck sits at
 * pre-clamp natural ≈ 0 (a few px negative at most), NOT well below this,
 * so the sign+magnitude distinguishes the two. Tuned conservative (one card
 * height) so a single near-top card never trips the guard. */
const DEGENERATE_NATURAL_PX = -DEFAULT_ENTRY_HEIGHT; // -60px
/** Min count of strongly-negative items required to call a measure
 *  degenerate. ≥2 distinct anchors landing well above the pod is the
 *  signature of an un-laid-out editor, not a real layout. */
const DEGENERATE_MIN_COUNT = 2;

/** A single item's raw (pre-clamp) measurement. `preClampTop` is the raw
 *  `coords.top - podRect.top` before the ≥0 clamp; the degeneracy guard
 *  reads it to decide whether the whole measure is trustworthy. */
interface RawMeasure {
  preClampTop: number;
  height: number;
  pos: number;
}

/**
 * Pure self-validation: is this freshly-read measure degenerate (taken
 * against an un-laid-out editor) rather than a real layout?
 *
 * A measure is degenerate when ≥`DEGENERATE_MIN_COUNT` items have a
 * pre-clamp natural top at or below `DEGENERATE_NATURAL_PX` (strongly
 * negative) AND their resolved `pos` values are spread across the doc
 * (so it's genuinely "many distinct anchors all reporting above the pod",
 * the un-laid-out signature, not a couple of co-located top cards). A
 * legitimate deck anchored at the very top of the document sits at
 * pre-clamp ≈ 0, never strongly negative, so it does NOT trip this.
 *
 * Caller only ACTS on a degenerate verdict when it already holds a good
 * cached measure to retain — there's no previous-good to keep on the very
 * first paint, so a first-paint degenerate still commits (and the settle
 * loop / font-ready ping corrects it), never leaving a permanently blank
 * column.
 */
export function isDegenerateMeasure(
  raws: ReadonlyArray<RawMeasure>,
): boolean {
  let negCount = 0;
  let minPos = Infinity;
  let maxPos = -Infinity;
  for (const r of raws) {
    if (r.preClampTop <= DEGENERATE_NATURAL_PX) {
      negCount += 1;
      if (r.pos < minPos) minPos = r.pos;
      if (r.pos > maxPos) maxPos = r.pos;
    }
  }
  if (negCount < DEGENERATE_MIN_COUNT) return false;
  // Pos-spread guard: the strongly-negative items must span distinct doc
  // anchors. (Co-located items can't both be legitimately far above the
  // pod once laid out; a spread of anchors all above the pod is the
  // un-laid-out fingerprint.)
  return maxPos > minPos;
}

const DEFAULT_ENTRY = (id: string) => `[data-link-card$=":${id}"]`;

/** Optional pin: force one card's `top` to a fixed pod-relative Y. Cards
 *  AFTER the pinned card in source-anchor-order cascade off the pinned
 *  card's bottom; cards BEFORE cascade upward off the pinned card's top.
 *  Net effect: the deck reflows around the pin without overlap. */
export interface Pinned {
  id: string;
  /** Pod-relative Y (px). Computed at publish time against the pod that
   *  hosts the absolute card wrappers — same coordinate space as the
   *  natural positions this hook returns. */
  pinTop: number;
}

/** Per-item measurement consumed by the pure cascade resolver. */
interface NaturalEntry {
  /** Pod-relative top from `coordsAtPos(pos).top - podRect.top`,
   *  clamped to 0 (negative values appear when an unanchored block sits
   *  above the pod). */
  naturalTop: number;
  /** Measured card height, or `DEFAULT_ENTRY_HEIGHT` if not yet rendered. */
  height: number;
}

/**
 * Pure-JS cascade resolver. Given measured natural positions + heights
 * and the current item list, returns a Map of final pod-relative Y
 * values. If `pinned` is set, the pinned card's position is forced to
 * `pinTop` and the cascade reflows in both directions to avoid overlap.
 *
 * This is the hot path on every pin change. NO DOM reads — operates
 * entirely on numbers measured separately.
 */
function resolveCascade(
  natural: Map<string, NaturalEntry>,
  items: ReadonlyArray<PositionItem>,
  pinned: Pinned | null,
): Map<string, number> {
  if (items.length === 0 || natural.size === 0) return new Map();

  // Build sorted list by natural top (so cascade-after is well-defined).
  // Skip items we haven't measured yet — they're not renderable.
  type Row = { id: string; top: number; height: number };
  const rows: Row[] = [];
  for (const it of items) {
    const nat = natural.get(it.id);
    if (!nat) continue;
    rows.push({ id: it.id, top: nat.naturalTop, height: nat.height });
  }
  rows.sort((a, b) => a.top - b.top);

  // Forward pass: push cards down to avoid overlap with their predecessor.
  // Apply the pin override mid-loop so cards AFTER the pinned one pack
  // below the pinned card's actual top, not below its natural top.
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const minTop = prev.top + prev.height + MIN_GAP;
      if (rows[i].top < minTop) rows[i].top = minTop;
    }
    if (pinned && rows[i].id === pinned.id) {
      rows[i].top = pinned.pinTop;
    }
  }

  // Backward pass: when pinning moved the pinned card UP, cards anchored
  // BEFORE it can now overlap. Pull them upward (in source-anchor order,
  // bottom-up) until they clear. With `transform: translateY` positioning
  // this is essentially free; the deck stays symmetric around the pin
  // instead of overlapping on the upward side.
  if (pinned) {
    for (let i = rows.length - 1; i > 0; i--) {
      const cur = rows[i];
      const prev = rows[i - 1];
      const maxPrevTop = cur.top - prev.height - MIN_GAP;
      if (prev.top > maxPrevTop) prev.top = maxPrevTop;
    }
  }

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.id, r.top);
  return map;
}

/**
 * Computes pod-relative Y positions for panel items so they align with
 * their corresponding paragraphs in the TipTap editor.
 *
 * Architecture: measurement and resolution are split.
 *
 *   1. **Measurement** (DOM-touching, slow): `coordsAtPos` per item and
 *      `getBoundingClientRect` per card. Writes a ref and bumps a
 *      version counter. Runs on editor content change, card-size change
 *      (ResizeObserver), window resize, or items-list change.
 *
 *   2. **Resolution** (pure JS, fast): cascade + optional pin override.
 *      Runs in `useMemo` on every render of the consumer. Pin changes
 *      flow through here in O(N) JS with no layout flush — that's the
 *      whole point: clicking a marker should not measure the DOM.
 *
 * Under the unified row scroll, the panel column and the editor column
 * share the same scroll source. Positions are computed pod-relative
 * (`coords.top - podRect.top`), which is scroll-invariant: both rects
 * shift by the same amount on natural scroll, so the cached map stays
 * correct without recompute.
 *
 * Returns:
 *   - `positions`: Map<id, topPx> in pod-relative coordinates. Render
 *     each card with `transform: translateY(${px}px)` inside a
 *     `position: relative` container of height `editorContentHeight`.
 *   - `editorContentHeight`: the editor view's natural DOM height, used
 *     to size the positioned region so the panel column extends through
 *     the document.
 *   - `panelScrollRef`: ref for the panel pod (the `position: relative`
 *     container hosting absolute children).
 */
export function useInTextPositions(
  editor: Editor | null,
  items: PositionItem[],
  enabledProp: boolean,
  entry: string | ((id: string) => string) = DEFAULT_ENTRY,
  pinned: Pinned | null = null,
  /**
   * Optional live-position resolver. `item.pos` is captured when the item
   * list is (re)built — which, post keystroke-sanctity refactor, happens
   * only on *structural* change, so it goes stale as plain typing shifts
   * later content. `measure()` runs on every reflow (editor ResizeObserver),
   * so resolving the live pos here — from the DocStructureObserver snapshot,
   * which is re-mapped every transaction — keeps cards from drifting on the
   * keystroke that wraps a line. Returns `undefined` to fall back to
   * `item.pos`. See `useStructuralRevisions` + `docs/perf/keystroke-sanctity-findings.md`.
   */
  resolvePos?: (id: string) => number | undefined,
) {
  // Keep-alive: a hidden (display:none) editor measures nothing — coordsAtPos
  // and getBoundingClientRect both return 0, which would cache naturalTop=0 for
  // every card. Folding visibility into `enabled` makes the whole measure path
  // (and its ResizeObserver/window-resize wiring) bail while hidden; the
  // existing `!enabled` early-outs already clear cleanly. Re-show flips it back.
  const isVisible = useIsVisible();
  const enabled = enabledProp && isVisible;
  const [editorContentHeight, setEditorContentHeight] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<Map<string, NaturalEntry>>(new Map());
  const [measureVersion, setMeasureVersion] = useState(0);
  const computeRafRef = useRef(0);
  // Settle loop bookkeeping — armed once per mount/enable, self-terminating.
  const settleRafRef = useRef(0);
  // `onFontReady` registers a module-global callback with NO per-caller
  // unsubscribe; this ref lets the registered ping bail after unmount/disable
  // so a late `document.fonts.ready` never measures a torn-down editor.
  const fontReadyActiveRef = useRef(false);

  const measure = useCallback(() => {
    if (!editor || !enabled || items.length === 0) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      setEditorContentHeight(0);
      return;
    }

    const panelEl = panelScrollRef.current;
    if (!panelEl) return;

    const podRect = panelEl.getBoundingClientRect();
    const editorDom = editor.view.dom as HTMLElement;
    const nextContentHeight = editorDom.scrollHeight;
    setEditorContentHeight((prev) =>
      prev === nextContentHeight ? prev : nextContentHeight,
    );

    // Viewport gate for per-card measurement: items whose paragraph
    // anchor sits far outside the visible scroll range get DEFAULT_ENTRY_HEIGHT
    // instead of a per-card `getBoundingClientRect`. The cascade resolver
    // still positions them so click/scroll-into-view works; we just
    // don't pay the layout-read cost for cards the user can't see.
    const scrollEl = findEditorScrollFor(editorDom);
    let viewTop = -Infinity;
    let viewBottom = Infinity;
    if (scrollEl) {
      const sr = scrollEl.getBoundingClientRect();
      viewTop = sr.top - NEAR_ZONE_PX;
      viewBottom = sr.bottom + NEAR_ZONE_PX;
    }

    const next = new Map<string, NaturalEntry>();
    const raws: RawMeasure[] = [];
    for (const item of items) {
      // Prefer the live snapshot pos (re-mapped every transaction) so cards
      // track their anchor as plain typing shifts content; fall back to the
      // captured pos for kinds the resolver doesn't cover.
      const livePos = resolvePos?.(item.id);
      const pos = Math.min(livePos ?? item.pos, editor.state.doc.content.size);
      let preClampTop: number;
      let coordsTop: number;
      try {
        const coords = editor.view.coordsAtPos(pos);
        coordsTop = coords.top;
        preClampTop = coords.top - podRect.top;
      } catch {
        continue; // skip items with invalid positions
      }

      const inViewport = coordsTop >= viewTop && coordsTop <= viewBottom;
      let height: number = DEFAULT_ENTRY_HEIGHT;
      if (inViewport) {
        const selector =
          typeof entry === "string" ? `[${entry}="${item.id}"]` : entry(item.id);
        const el = panelEl.querySelector(selector) as HTMLElement | null;
        if (el) height = el.getBoundingClientRect().height;
      }

      raws.push({ preClampTop, height, pos });
      // The committed natural retains the historical ≥0 clamp (negative
      // values legitimately appear when an unanchored block sits just above
      // the pod). The degeneracy guard below — which reads the *pre-clamp*
      // values in `raws` — is what protects against baking a top-stack from
      // an un-laid-out editor.
      next.set(item.id, {
        naturalTop: preClampTop < 0 ? 0 : preClampTop,
        height,
      });
    }

    // Self-validation (Part B): if this measure is degenerate — many
    // distinct anchors reporting strongly above the pod, the signature of
    // an editor that hasn't reached final layout — DON'T overwrite the
    // previously-cached good naturals with clamped-to-0 garbage (which the
    // cascade would spread into a top-stack). Retain the last good positions
    // and let the settle loop / font-ready ping re-measure once layout is
    // final. Only enforced when we HAVE a previous-good measure to keep; on
    // the very first paint there's nothing to retain, so we still commit
    // (the settle loop then corrects it) rather than render a blank column.
    if (naturalRef.current.size > 0 && isDegenerateMeasure(raws)) {
      return;
    }

    // Only bump measureVersion if measurements *actually* changed.
    // Otherwise we feed back into the ResizeObserver and re-render loop:
    // setState → commit → RO fires (the new wrapper transforms tickle
    // layout) → schedule → measure → setState → … 60 fps.
    let changed = next.size !== naturalRef.current.size;
    if (!changed) {
      for (const [id, entry] of next) {
        const prev = naturalRef.current.get(id);
        if (!prev || prev.naturalTop !== entry.naturalTop || prev.height !== entry.height) {
          changed = true;
          break;
        }
      }
    }
    naturalRef.current = next;
    if (changed) setMeasureVersion((v) => v + 1);
  }, [editor, items, enabled, entry, resolvePos]);

  // Trigger measurement on editor updates, viewport resize, editor
  // content-height changes, and on the next paint after items change.
  // useLayoutEffect so the first measure runs synchronously after commit;
  // setMeasureVersion schedules a re-render that picks up the new natural
  // data via the useMemo below.
  useLayoutEffect(() => {
    if (!enabled) {
      if (naturalRef.current.size > 0) {
        naturalRef.current = new Map();
        setMeasureVersion((v) => v + 1);
      }
      return;
    }

    measure();

    if (!editor) return;

    const schedule = () => {
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(measure);
    };

    // Part A — settle-aware re-measure. The initial `measure()` above races
    // async layout: web fonts swap (FOUT) and React NodeViews (KaTeX math,
    // expex examples, figures/images) mount and size AFTER first paint,
    // moving every line. `coordsAtPos` read before that returns tops that are
    // too small → cards collapse to the top. None of the existing triggers
    // (structural bus, window resize, editor RO) reliably fire on a cold-load
    // settle, so we add two transient, self-terminating correctors. Neither
    // is an editor update/transaction subscriber, so both stay OFF the
    // keystroke path: they fire once on mount-settle and on font-ready only.

    // A.1 — bounded post-mount stabilization loop. Re-measure each rAF until
    // the editor's laid-out height is stable across consecutive frames, or a
    // hard frame cap elapses (~500ms). Self-terminating: it only reschedules
    // while height is still changing AND under the cap, so a settled doc
    // costs zero further frames and a perpetually-animating one can't spin it
    // forever.
    const editorDomForSettle = editor.view?.dom as HTMLElement | undefined;
    let settleFrames = 0;
    let settleStable = 0;
    let lastSettleHeight = editorDomForSettle?.scrollHeight ?? -1;
    const settleStep = () => {
      if (!enabled) return;
      measure();
      const h = editorDomForSettle?.scrollHeight ?? -1;
      if (h === lastSettleHeight) {
        settleStable += 1;
      } else {
        settleStable = 0;
        lastSettleHeight = h;
      }
      settleFrames += 1;
      if (settleStable >= SETTLE_STABLE_FRAMES || settleFrames >= SETTLE_MAX_FRAMES) {
        return; // settled or capped — stop (no reschedule = self-terminating)
      }
      settleRafRef.current = requestAnimationFrame(settleStep);
    };
    settleRafRef.current = requestAnimationFrame(settleStep);

    // A.2 — FOUT corrector. When web fonts swap in, every line shifts; the
    // metrics module clears its own caches on `document.fonts.ready` and we
    // re-measure so the deck snaps to the corrected coordinates. `onFontReady`
    // has no per-caller unsubscribe, so guard the ping with a mounted ref.
    //
    // `onFontReady` is a one-shot module-global that arms
    // `document.fonts.ready.then(...)` ONCE (see text-metrics.ts ~:221). Any
    // mount that happens AFTER fonts have already resolved registers a callback
    // that NEVER fires. That residual gap is harmless: the A.1 settle loop above
    // runs unconditionally on every run of THIS effect (regardless of font-ready
    // state), so whenever this effect runs it re-measures once layout settles.
    //
    // KEEP-ALIVE RE-SHOW (display:none→show without remount — the L2/L3
    // keep-alive subsystem): this is handled by construction, not by a separate
    // visibility trigger. Visibility is folded into `enabled`
    // (`enabled = enabledProp && isVisible`, see :311), and `enabled` is in BOTH
    // `measure`'s `useCallback` deps and THIS effect's dep array. So a
    // hidden→visible transition flips `enabled` false→true, which re-creates
    // `measure` and RE-RUNS this whole effect — re-arming the A.1 settle loop
    // against the now-laid-out editor. (The font-ready ping re-registers but is
    // INERT on re-show: `onFontReady` is a one-shot module-global that already
    // fired at cold load, so the A.1 settle loop is the SOLE re-show healer —
    // consistent with the one-shot caveat noted above.)
    // While hidden, the `!enabled` branch at the top of this effect cleared
    // `naturalRef` to empty, so the re-show takes the first-paint path (the
    // degeneracy guard is inactive at size 0 ⇒ commit, then the settle loop
    // heals) — exactly the cold-load lifecycle, re-triggered. No `editor.on`
    // subscriber and no IntersectionObserver is involved, so keystroke sanctity
    // is preserved: the trigger is the rare visibility flip, never a transaction.
    // (The degenerate-measure guard does NOT help on re-show — the hidden-state
    // clear emptied `naturalRef`, so size 0 ⇒ no good cache to retain ⇒ the
    // re-show commits first-paint and relies on the settle loop, same as a cold
    // open.) Locked by `useInTextPositions-visibility-remeasure.test.tsx`.
    // (LIVE-FSA OWED: jsdom can't lay out, so the real hidden→show layout settle
    // — fonts/KaTeX/expex reflow correcting the deck — is verified by the unit
    // test's re-fire assertion here and must still be feel-checked in a real
    // browser against the L2 paper↔Library bounce.)
    fontReadyActiveRef.current = true;
    onFontReady(() => {
      if (fontReadyActiveRef.current) schedule();
    });
    // Card positions are anchored to PM coords. Subscribe to the
    // DocStructureObserver: structural changes (block add/remove) are
    // when card mappings might shift. Pure text edits don't move
    // cards; the editor DOM's ResizeObserver below covers any
    // wrap-induced reflow that would shift Y coords.
    const bus = getBus(editor);
    const unsubBlocks = bus
      ? (() => {
          const u1 = bus.onBlocksAdded(schedule);
          const u2 = bus.onBlocksRemoved(schedule);
          return () => {
            u1();
            u2();
          };
        })()
      : null;

    window.addEventListener("resize", schedule);

    let editorObs: ResizeObserver | null = null;
    try {
      const editorDom = editor.view?.dom as HTMLElement | undefined;
      if (editorDom && typeof ResizeObserver !== "undefined") {
        editorObs = new ResizeObserver(schedule);
        editorObs.observe(editorDom);
      }
    } catch {
      // ignore
    }

    return () => {
      cancelAnimationFrame(computeRafRef.current);
      cancelAnimationFrame(settleRafRef.current);
      fontReadyActiveRef.current = false;
      unsubBlocks?.();
      window.removeEventListener("resize", schedule);
      editorObs?.disconnect();
    };
  }, [editor, measure, enabled]);

  // Observe card-size changes (e.g. bibliography pod expanding) so the
  // cascade reflows correctly. Dep on `measureVersion` so we re-observe
  // whenever cards mount/unmount.
  //
  // Important: skip the recompute while the user is actively typing into
  // a card editor inside this panel. Per-keystroke sub-pixel height jitter
  // (different glyph widths) would otherwise tick `setMeasureVersion` and
  // re-position every card every frame — visually the typed card "jumps"
  // as the cascade reflows, which the user perceives as carriage-return
  // behavior in the edit view. The effect is especially visible in focus
  // mode where the cascade has few items and a single card's wobble isn't
  // absorbed by neighbors. When the user blurs the editor, the focusout
  // handler runs a final measure() so positions snap to truth.
  useEffect(() => {
    if (!enabled) return;
    const panelEl = panelScrollRef.current;
    if (!panelEl || typeof ResizeObserver === "undefined") return;
    const isTypingInPanel = () => {
      const active = document.activeElement as HTMLElement | null;
      return !!(
        active &&
        panelEl.contains(active) &&
        active.getAttribute("contenteditable") === "true"
      );
    };
    const onResize = () => {
      if (isTypingInPanel()) return;
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(measure);
    };
    const onFocusOut = () => {
      // Defer one frame so the activeElement transition settles before
      // we re-measure (otherwise activeElement might still be the just-
      // -blurred contenteditable).
      cancelAnimationFrame(computeRafRef.current);
      computeRafRef.current = requestAnimationFrame(measure);
    };
    const obs = new ResizeObserver(onResize);
    const bareAttr = typeof entry === "string" ? entry : "data-link-card";
    panelEl.querySelectorAll(`[${bareAttr}]`).forEach((el) => obs.observe(el));
    panelEl.addEventListener("focusout", onFocusOut);
    return () => {
      obs.disconnect();
      panelEl.removeEventListener("focusout", onFocusOut);
    };
  }, [measureVersion, enabled, entry, measure]);

  // Pure-JS resolution. On a pin change, this is the ONLY thing that
  // re-runs — no DOM reads, no layout flush, no second commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(
    () => resolveCascade(naturalRef.current, items, pinned),
    [measureVersion, items, pinned],
  );

  return { positions, editorContentHeight, panelScrollRef };
}
