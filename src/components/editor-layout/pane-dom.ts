/**
 * THE resolver for a per-PANE DOM marker under multi-pane keep-alive.
 *
 * Virgil mounts up to FOUR `EditorPane`s at once — `DOC_KEEP_ALIVE_CAPACITY = 3`
 * authored docs (one visible, the rest hidden by `KeepAliveSlot`, whose own
 * docblock calls the `display:none` CSS invariant load-bearing) plus the Library
 * Reader's pane inside `PaperOuterView` / `LibraryOuterView`. Every one of them
 * renders its own tool strip, its own `PanelColumn`, its own stack frame, its
 * own band anchors and its own rendered paper page, so
 * `[data-panel-column-side]`, `[data-flex-col]`, `[data-stack-frame]`,
 * `[data-dock-slot]`, `[data-strip-side]` and `[data-editor-page]` are per-PANE
 * markers whose selector carries NO pane discriminator: `left-0` exists once per
 * mounted pane that has a band docked on the left, and `[data-editor-page]`
 * exists once per mounted pane, full stop.
 *
 * A bare `document.querySelector` therefore answers with the FIRST match in
 * DOM ORDER — and the doc keep-alive block renders BEFORE the paper/library
 * block in `EditorLayout`, so whenever the user is on the Library pane the first
 * match is a HIDDEN doc pane whose every rect reads zero (task 438).
 *
 * This is the task-329 law ("Per-doc services under multi-pane keep-alive": a
 * value that is per-DOCUMENT is resolved through ONE ladder, never "whichever
 * was written last") arriving in the DOM instead of in a module variable. The
 * rung is the same one `pickActiveByEditor` names, read through the ONE
 * predicate both share — `isPaneElementVisible`
 * ([src/lib/keep-alive/pane-visibility.ts](../../lib/keep-alive/pane-visibility.ts)).
 *
 * ## The two miss policies are DIFFERENT CLAIMS, so the argument is required
 *
 * A defaulted policy would be a decision nobody made, and the two callers want
 * opposite fail-safes:
 *
 *  - `"fail-open"` — a MEASUREMENT reader (`measureOmniGap`, `computeColumnSpawnRect`,
 *    `findRowScroll`). Measuring the wrong column is the pre-438 status quo;
 *    answering `null` turns a working feature off. So when no match is visible,
 *    hand back the first match at all. (A reader may still decline to MEASURE
 *    an unrendered match — `measureOmniGap` answers `undefined`, "not
 *    measured", rather than a zero-rect reading; task 1034.)
 *  - `"fail-closed"` — an ANCHOR the caller acts THROUGH rather than measures
 *    (`FloatingPanel`'s dock-slot anchor; print isolation's paper page). An
 *    invisible anchor is strictly WORSE than the caller's own fallback: the
 *    docked panel is "open" in prefs, its strip icon lights `aria-pressed`, and
 *    nothing appears anywhere; print's is worse still, since the tagging walk
 *    it seeds writes `!important` display rules that UN-HIDE the hidden pane it
 *    anchored on and HIDE the visible one (task 597). Answer `null` and let the
 *    caller take its own fallback.
 *
 * ## Ownership first: a caller that has its pane resolves INSIDE it (task 1393)
 *
 * "At most one visible pane at a time" is FALSE: the Library renders its left
 * and right panels side by side, each can host a live Reader `EditorPane`, and
 * both pass the visibility rung — so a first-visible-match answered the RIGHT
 * Reader's docked band, strip drag, open-time fit check and dock sweep with the
 * LEFT Reader's DOM. Visibility cannot tell two visible panes apart; only
 * OWNERSHIP can. So the ladder is:
 *
 *  1. **scope** — the caller names its own pane root (`PaneScope`). Exact, and
 *     AUTHORITATIVE: a miss inside the caller's own pane is a miss (its column
 *     is not rendered), never a licence to answer with a neighbour's. Every
 *     caller that HAS a pane must pass it:
 *       - React callers under an `EditorPane` (`FloatingPanel`, `IconStrip`'s
 *         `useStripHandlers`) read `usePaneRoot()` — the pane's id rides
 *         `PaneRootContext` and the root is looked up BY ID, never through a
 *         ref, because `FloatingPanel` renders as an EARLIER SIBLING of the
 *         pane root and its layout effect runs before the root's ref attaches.
 *       - gesture callers holding an element (a strip button) take
 *         `paneRootOf(el)`.
 *  2. **focused** — no scope in hand (the event-bus publishers: card clicks,
 *     link jumps, `openPanel`'s spawn rect): prefer a match inside the pane that
 *     holds `document.activeElement` — the user's click just focused it. The
 *     same first rung `pickActiveByEditor` takes.
 *  3. **visible** — then the first visible match (`isPaneElementVisible`).
 *  4. the caller's stated miss policy.
 *
 * The root is `[data-pane-root]`, stamped once per `EditorPane` on its
 * `.editor-pane-root` (which encloses both rails, both columns, every dock
 * slot and the paper page). `[data-virgil-row-scroll]` is the pane's ANCESTOR,
 * so a scoped row lookup is `scope.closest(…)`, not `querySelector`.
 *
 * ## A pane's TERRITORY: its root plus the portals it owns (task 1458)
 *
 * A pane renders some of its own DOM OUTSIDE its root: a `FloatingPanel` (a
 * popped card, a floated panel) is portalled to `document.body`. Such a portal
 * stamps `[data-pane-owner]` with its pane's id, and ownership reads it in both
 * directions — `paneRootOf(el)` from inside a float answers the owning pane, and
 * a scoped lookup searches the root AND every portal that pane owns. Without
 * that, scoping a card lookup would silently stop finding a popped card.
 * Inside the territory the visible rung still applies (a popped float and a
 * native list can mount the same card); a miss inside it is still a miss.
 *
 * ## Per-CARD lookups take the same scope (task 1458)
 *
 * The per-card lookups (`findOmniEntry`, `openForCard`, `placeSelectedCard`,
 * `jumpToLink`'s card end, `usePlacement`) ask the GENERIC `resolvePaneMarker`
 * with their own selector — no named door per card attribute. Card ids are
 * unique only per DOCUMENT, so two visible Readers can mount the same one, and
 * every one of these callers has its owner in hand: the clicked pane's
 * `PaneClickHost.getPaneRoot`, or `paneRootOf(editor.view.dom)`. The census's
 * ownership block makes them pass it.
 *
 * What they DO share is the visibility rung. Since task 873 the per-document id
 * lookups that used to take the first match off `document` — `findOmniEntry`,
 * `openForCard`'s presence check and scroll targets, `jumpToLink`'s card end —
 * ask the GENERIC `resolvePaneMarker` with their own selector and policy. That
 * reuses the rung without minting a named door per card attribute: the ids are
 * 4-hex and unique only per document, so two open docs can mount the same one.
 *
 * CI: `pane-dom-census.test.ts` — no production file in either silo may resolve
 * one of these markers off `document` outside this file. A relative
 * `closest(…)` / `root.querySelector(…)` from an element already inside the
 * pane needs no ladder and stays legal. Its OWNERSHIP block pins the scoped
 * callers: each member of task 1393 must pass a scope, and a scope-less call
 * to a pane-marker door must sit on its named ladder-only allowlist.
 */

import { createContext, useCallback, useContext } from "react";
import type { Side } from "@/hooks/useViewPrefs";
import { isPaneElementVisible } from "@/lib/keep-alive/pane-visibility";

/** The attribute each `EditorPane` stamps on its root, valued with its id. */
export const PANE_ROOT_ATTR = "data-pane-root";

/** A pane root, or nothing in hand. `null`/`undefined` take the ladder. */
export type PaneScope = HTMLElement | null | undefined;

/** The owning `EditorPane`'s id (React `useId`), provided by the pane. `null`
 *  outside any pane (an app-level float host) — such callers take the ladder. */
export const PaneRootContext = createContext<string | null>(null);

/** The attribute a pane-owned PORTAL (rendered outside the root, e.g. a
 *  `FloatingPanel`) stamps, valued with its pane's id — see the header's
 *  "territory" section. */
export const PANE_OWNER_ATTR = "data-pane-owner";

/** The root element of the pane with `id`, looked up by id at call time. */
export function paneRootById(id: string | null | undefined): HTMLElement | null {
  if (!id || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[${PANE_ROOT_ATTR}="${id.replace(/["\\]/g, "\\$&")}"]`,
  );
}

/** The pane that OWNS `el`: its nearest `[data-pane-root]` ancestor, or — for
 *  an element inside a pane-owned portal — the root that portal names. */
export function paneRootOf(el: Element | null | undefined): HTMLElement | null {
  if (!el) return null;
  const root = el.closest(`[${PANE_ROOT_ATTR}]`) as HTMLElement | null;
  if (root) return root;
  return paneRootById(el.closest(`[${PANE_OWNER_ATTR}]`)?.getAttribute(PANE_OWNER_ATTR));
}

/** Every match for `selector` in the pane's TERRITORY — its root first, then
 *  the portals it owns (header, "territory"). */
function territoryMatches(scope: HTMLElement, selector: string): HTMLElement[] {
  const out = Array.from(scope.querySelectorAll<HTMLElement>(selector));
  const id = scope.getAttribute(PANE_ROOT_ATTR);
  if (!id) return out;
  const portals = document.querySelectorAll<HTMLElement>(
    `[${PANE_OWNER_ATTR}="${id.replace(/["\\]/g, "\\$&")}"]`,
  );
  for (const portal of portals) {
    if (portal.matches(selector)) out.push(portal);
    out.push(...portal.querySelectorAll<HTMLElement>(selector));
  }
  return out;
}

/** For a React caller under an `EditorPane`: a stable getter for its own pane
 *  root. A GETTER, resolved at call time, because the caller may run before
 *  the root exists (see the header's ownership section). */
export function usePaneRoot(): () => HTMLElement | null {
  const id = useContext(PaneRootContext);
  return useCallback(() => paneRootById(id), [id]);
}

/** The pane holding keyboard focus — the ladder's second rung. */
function focusedPaneRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return paneRootOf(document.activeElement);
}

/** What to answer when the selector matches only HIDDEN panes. See the header —
 *  the two are different claims, which is why no call site may omit it. */
export type PaneMarkerMiss = "fail-open" | "fail-closed";

/** The ONE resolver — the header's ladder: scope (authoritative), focused
 *  pane, first visible match, then the stated miss policy. */
export function resolvePaneMarker(
  selector: string,
  onNoneVisible: PaneMarkerMiss,
  scope?: PaneScope,
): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (scope) {
    // Authoritative: the visible match in the caller's own territory, else its
    // first match at all — never a neighbour's.
    const own = territoryMatches(scope, selector);
    return own.find(isPaneElementVisible) ?? own[0] ?? null;
  }
  const focusedRoot = focusedPaneRoot();
  const focused = focusedRoot
    ? territoryMatches(focusedRoot, selector).find(isPaneElementVisible)
    : undefined;
  if (focused) return focused;
  const all = document.querySelectorAll<HTMLElement>(selector);
  for (const el of all) if (isPaneElementVisible(el)) return el;
  return onNoneVisible === "fail-open" ? (all[0] ?? null) : null;
}

/**
 * Every VISIBLE match, for a sweep. Fail-open as a SET: if the filter leaves
 * nothing, hand back everything — the pre-438 behaviour, and the direction that
 * cannot turn a gesture off.
 */
export function resolvePaneMarkers(
  selector: string,
  scope?: PaneScope,
): HTMLElement[] {
  if (typeof document === "undefined") return [];
  if (scope) return territoryMatches(scope, selector);
  const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const visible = all.filter(isPaneElementVisible);
  return visible.length > 0 ? visible : all;
}

/** The panel column on `side` in the visible pane (fail-open: a measurement). */
export function paneColumn(side: Side, scope?: PaneScope): HTMLElement | null {
  return resolvePaneMarker(
    `[data-panel-column-side="${side}"]`,
    "fail-open",
    scope,
  );
}

/** Every panel column in the visible pane, both sides — the dock sweep's
 *  membership. A hidden column reports `left = right = 0`, whose snap corner
 *  `(0, frame.top)` is nearer the viewport's top-left than any real
 *  column's, so it would win the proximity test outright. */
export function paneColumns(scope?: PaneScope): HTMLElement[] {
  return resolvePaneMarkers("[data-panel-column-side]", scope);
}

/** The band anchor for `slotKey` (`"<side>-<index>"`) in the visible pane.
 *  FAIL-CLOSED — see the header. */
export function paneDockSlot(slotKey: string, scope?: PaneScope): HTMLElement | null {
  return resolvePaneMarker(`[data-dock-slot="${slotKey}"]`, "fail-closed", scope);
}

/**
 * The tool strip on `side` in the visible pane (`[data-strip-side]`, stamped
 * once per `EditorPane`). Fail-open: a measurement. The strip-icon drag reads
 * it twice — once to position the drop indicator, once to compute the drop
 * index from the strip's own `[data-panel-id]` buttons — so a hidden pane's
 * strip means an indicator placed from a zero rect and an index counted off
 * the wrong pane's icons.
 */
export function paneStrip(side: Side, scope?: PaneScope): HTMLElement | null {
  return resolvePaneMarker(`[data-strip-side="${side}"]`, "fail-open", scope);
}

/**
 * The rendered paper page (`[data-editor-page]`, stamped once per `EditorPane`
 * on its `.paper-render` wrapper) in the visible pane — the element print
 * isolation walks up from.
 *
 * FAIL-CLOSED, and the argument is the one `paneDockSlot` makes rather than the
 * measurement one. `applyPrintAttrs` does not MEASURE this element; it uses it
 * as an ANCHOR to tag an ancestor chain, marking every off-chain sibling
 * `data-print-hide` and every ancestor `data-print-ancestor`. Both print rules
 * carry `!important`, and `[data-print-ancestor]` sets `display: block` —
 * which is exactly the declaration `KeepAliveSlot` relies on to hide a warm
 * pane. So anchoring on a hidden pane does not merely print the wrong thing:
 * it UN-HIDES the warm pane and HIDES the one the user is looking at (task
 * 597, reproducible from the Library Reader, where every doc pane is hidden
 * and every doc pane renders first).
 *
 * A fail-open answer would therefore hand back precisely the element that
 * causes that inversion. Answering `null` instead means no tagging at all —
 * the caller's own `if (editorPage)` guard already degrades to "print the
 * plain document with no page isolation", which is the same posture the
 * browser's own File → Print door takes (see `print.ts`'s second-door note).
 */
export function panePrintPage(): HTMLElement | null {
  return resolvePaneMarker("[data-editor-page]", "fail-closed");
}
