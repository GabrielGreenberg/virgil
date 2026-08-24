/**
 * THE resolver for a per-PANE DOM marker under multi-pane keep-alive.
 *
 * Virgil mounts up to FOUR `EditorPane`s at once — `DOC_KEEP_ALIVE_CAPACITY = 3`
 * authored docs (one visible, the rest hidden by `KeepAliveSlot`, whose own
 * docblock calls the `display:none` CSS invariant load-bearing) plus the Library
 * Reader's pane inside `PaperOuterView` / `LibraryOuterView`. Every one of them
 * renders its own tool strip, its own `PanelColumn`, its own stack frame and its
 * own band anchors, so `[data-panel-column-side]`, `[data-flex-col]`,
 * `[data-stack-frame]`, `[data-dock-slot]` and `[data-strip-side]` are per-PANE
 * markers whose selector carries NO pane discriminator: `left-0` exists once per
 * mounted pane that has a band docked on the left.
 *
 * A bare `document.querySelector` therefore answers with the FIRST match in
 * DOM ORDER — and the doc keep-alive block renders BEFORE the paper/library
 * block in `EditorLayout`, so whenever the user is on the Library pane the first
 * match is a HIDDEN doc pane whose every rect reads zero (task 438).
 *
 * This is the task-329 law ("Per-doc services under multi-pane keep-alive": a
 * value that is per-DOCUMENT is resolved through ONE ladder, never "whichever
 * was written last") arriving in the DOM instead of in a module variable. The
 * rung is the same one `pickActiveByEditor` names — a hidden pane is exactly
 * what `offsetParent === null` / `offsetHeight === 0` reports, and nothing else
 * in a mounted tree reports it.
 *
 * ## The two miss policies are DIFFERENT CLAIMS, so the argument is required
 *
 * A defaulted policy would be a decision nobody made, and the two callers want
 * opposite fail-safes:
 *
 *  - `"fail-open"` — a MEASUREMENT reader (`measureOmniGap`, `computeColumnSpawnRect`,
 *    `findRowScroll`). Measuring the wrong column is the pre-438 status quo;
 *    answering `null` turns a working feature off. So when no match is visible,
 *    hand back the first match at all.
 *  - `"fail-closed"` — a PORTAL TARGET (`FloatingPanel`'s dock-slot anchor). An
 *    invisible anchor is strictly WORSE than the body-portal fallback the caller
 *    already has: the panel is "open" in prefs, its strip icon lights
 *    `aria-pressed`, and nothing appears anywhere. Answer `null` and let the
 *    caller take its own fallback.
 *
 * ## Stated limit: this scopes by CSS VISIBILITY, not by REACT TREE
 *
 * It is exact for the shipped topology (at most ONE visible pane at a time —
 * the doc panes are keep-alive siblings and the Library pane replaces them).
 * It would NOT be exact for two SIMULTANEOUSLY VISIBLE panes (a future split
 * view): both columns pass the rung and the first still wins. The structurally
 * strongest fix for that is to scope by react tree — have `PanelColumn` publish
 * its root through a per-pane context and have `FloatingPanel` resolve its
 * anchor inside that subtree — which is a wider change (`FloatingPanel` mounts
 * from several places and would need the provider above all of them) and which
 * does not help `paneColumns()` at all, since `readDockGeometry` is called from
 * a gesture with no pane in hand. Take the visibility filter now; the context is
 * the follow-on if a split view ever ships.
 *
 * ## Scope: PANE markers, not CARD markers
 *
 * The per-CARD lookups (`findOmniEntry`, `usePlacement`, the anchor-highlight
 * reconciler) are the same hazard one level down and are deliberately NOT folded
 * in here: `omni-card-placement.ts` already states its own answer (a caller that
 * knows its element passes it; only the two event-driven publishers take a
 * lookup), and widening this door to every `data-*` in the app would be the
 * "broadest blast radius" mistake the central principle warns against.
 *
 * CI: `pane-dom-census.test.ts` — no production file in either silo may resolve
 * one of these markers off `document` outside this file. A relative
 * `closest(…)` / `root.querySelector(…)` from an element already inside the
 * pane needs no ladder and stays legal.
 */

import type { Side } from "@/hooks/useViewPrefs";

/** What to answer when the selector matches only HIDDEN panes. See the header —
 *  the two are different claims, which is why no call site may omit it. */
export type PaneMarkerMiss = "fail-open" | "fail-closed";

/**
 * Is `el` rendered — i.e. does it live in a pane that is NOT the `display:none`
 * half of a keep-alive slot?
 *
 * `offsetParent === null` is the primary signal (the same one
 * `active-editor-probe.ts` and `findRowScroll` already read); `offsetHeight > 0`
 * is the backstop for the one rendered shape that also reports a null
 * offsetParent — a `position: fixed` element. A `display:none` subtree fails
 * BOTH, and nothing else in a mounted tree does.
 */
export function isPaneMarkerVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null || el.offsetHeight > 0;
}

/** The ONE resolver: visible match first, then the stated miss policy. */
export function resolvePaneMarker(
  selector: string,
  onNoneVisible: PaneMarkerMiss,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const all = document.querySelectorAll<HTMLElement>(selector);
  for (const el of all) if (isPaneMarkerVisible(el)) return el;
  return onNoneVisible === "fail-open" ? (all[0] ?? null) : null;
}

/**
 * Every VISIBLE match, for a sweep. Fail-open as a SET: if the filter leaves
 * nothing, hand back everything — the pre-438 behaviour, and the direction that
 * cannot turn a gesture off.
 */
export function resolvePaneMarkers(selector: string): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const visible = all.filter(isPaneMarkerVisible);
  return visible.length > 0 ? visible : all;
}

/** The panel column on `side` in the visible pane (fail-open: a measurement). */
export function paneColumn(side: Side): HTMLElement | null {
  return resolvePaneMarker(
    `[data-panel-column-side="${side}"]`,
    "fail-open",
  );
}

/** Every panel column in the visible pane, both sides — the dock sweep's
 *  membership. A hidden column reports `left = right = 0`, whose snap corner
 *  `(0, TOP_BAR + podGap)` is nearer the viewport's top-left than any real
 *  column's, so it would win the proximity test outright. */
export function paneColumns(): HTMLElement[] {
  return resolvePaneMarkers("[data-panel-column-side]");
}

/** The band anchor for `slotKey` (`"<side>-<index>"`) in the visible pane.
 *  FAIL-CLOSED — see the header. */
export function paneDockSlot(slotKey: string): HTMLElement | null {
  return resolvePaneMarker(`[data-dock-slot="${slotKey}"]`, "fail-closed");
}

/**
 * The panel/margin flex column on either side in the visible pane
 * (`[data-flex-col]`, stamped by BOTH `PanelColumn` and `ZenMargin` on the same
 * element that carries `[data-panel-column-side]`).
 *
 * Fail-open as a SET. The filter is load-bearing here rather than merely tidy:
 * `syncPanelPrefsToRendered` PERSISTS each column's rendered width on every
 * divider drag-start, iterating in keep-alive LRU order so the LAST write per
 * side wins — and a hidden pane's rect is all zeros, so a warm doc pane could
 * write `panelWidths[side] = 0` / `zenMargin = 0` into the user's prefs from a
 * drag they performed in a different pane.
 */
export function paneFlexColumns(): HTMLElement[] {
  return resolvePaneMarkers("[data-flex-col]");
}

/**
 * The tool strip on `side` in the visible pane (`[data-strip-side]`, stamped
 * once per `EditorPane`). Fail-open: a measurement. The strip-icon drag reads
 * it twice — once to position the drop indicator, once to compute the drop
 * index from the strip's own `[data-panel-id]` buttons — so a hidden pane's
 * strip means an indicator placed from a zero rect and an index counted off
 * the wrong pane's icons.
 */
export function paneStrip(side: Side): HTMLElement | null {
  return resolvePaneMarker(`[data-strip-side="${side}"]`, "fail-open");
}
