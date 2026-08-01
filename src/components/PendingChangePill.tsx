"use client";

/**
 * The Keep / Dismiss pill for an applied pending AI change — the ONLY in-context
 * commit affordance now that the gutter marker's hover chips were removed
 * (margin-declutter pass). It's a quiet, EPHEMERAL control that materializes in
 * the LEFT MARGIN, level with the blue change, whenever that change is HOVERED
 * (text mark / margin marker / panel card — the three-surface cardStore halo) or
 * FOCUSED (caret inside the blue range). Same shared `keepSuggestion` /
 * `dismissSuggestion` orchestration the card surface uses.
 *
 * ── Placement (left margin) ───────────────────────────────────────────────────
 * The pill is a `position:fixed` portal. Each event that could move/hide it runs
 * a SINGLE RAF-coalesced `computePlacement`: resolve the target card's blue range
 * via `findLinkedAnchorRange(doc, anchorId)` (the mark carries the anchorId the
 * card's `appliedChange` stamped), one `coordsAtPos(range.from)` for the vertical
 * line, then RIGHT-anchor the pill into the left margin (right edge one
 * margin-width inboard of the editor DOM's left edge) and vertically center it on
 * the line. It sits ABOVE any left-margin markers (z-order) — accepted overlap.
 * A `placementsEqual` bail short-circuits `setPlacement` when nothing moved, so a
 * re-tick that lands the same coords causes no React re-render.
 *
 * ── How it binds to the hovered/focused pending card ──────────────────────────
 * The target is resolved from TWO inputs, hover taking precedence:
 *   1. cardStore hover/selection — a `revision-suggestion` / `cutter-suggestion`
 *      ref present in `index` (the applied-pending set EditorPane threads).
 *   2. caret focus — the editor selection head sits inside a blue `linkedAnchor`
 *      range; resolve which applied card owns that range by anchorId.
 * Whichever resolves first (hover, then selection, then caret) is the target.
 *
 * ── Keystroke sanctity ───────────────────────────────────────────────────────
 * MOUNT-ON-DEMAND, like SlashCommandPopup: EditorPane renders this ONLY when at
 * least one applied pending change exists (`index.size > 0`); flag-OFF / no
 * applied card → it isn't mounted, zero cost. While mounted it mirrors
 * SelectionActionsMenu (already on the keystroke-sanctity allow-list): the
 * single `editor.on("selectionUpdate"|"update"|"focus"|"blur")` subscription
 * schedules ONE RAF that does ONE `coordsAtPos` + a placement-equality bail —
 * O(1) per transaction, no doc walk on the keystroke path. The cardStore hover
 * read is a `useSyncExternalStore` subscription that fires only on a real
 * hover/selection change (never on a keystroke). Typing N plain characters
 * therefore leaves `__virgilBusStats().emitCount` flat (the range walk only runs
 * inside the RAF, and only when the target's anchorId is set — and the target
 * doesn't change on a structurally-null keystroke).
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import {
  useStoreHover,
  useStoreSelection,
  type CardStore,
  type AnchoredCardRef,
} from "@/links/_shared/anchored-card-store";
import {
  useEditorViewportCache,
  type EditorViewportCache,
} from "@/hooks/useEditorViewportCache";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import {
  opticalCenterY,
  resolveInlineContextElement,
} from "@/lib/text-metrics";
import { RESTING_MARGIN_TRIGGER_Z } from "@/floats/float-policy";
import {
  recordScrollPlacement,
  SCROLL_PORTAL_PENDING_PILL,
} from "@/lib/scroll-reposition-probe";
/** A check (Keep) / cross (Dismiss) glyph for the pill's commit icons — mirrors
 *  the applied-card body's commit icons. */
function PillGlyph({ kind }: { kind: "check" | "cross" }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === "check" ? (
        <polyline points="20 6 9 17 4 12" />
      ) : (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
    </svg>
  );
}

const VIEWPORT_MARGIN = 8;
/** How far LEFT of the paragraph's text-column edge the pill's right edge sits,
 *  so it clears the paragraph grab handle (the grab bar sits ~21px left of the
 *  text) and seats in the margin just OUTSIDE the grab bar, vertically level
 *  with the change (it may temporarily overlap other margin markers). */
const GRAB_BAR_CLEARANCE = 28;

/** The applied-pending target the pill currently acts on: the resolved card ref
 *  plus the splice's anchorId (resolves the blue range) and the two commit
 *  closures EditorPane built — Keep (finalize suggested) and Dismiss
 *  (restore-original + archive, never delete). SAME `pending-change-actions`
 *  sequence the gutter + card surface use. The pill is commit-only: the
 *  non-committing Original/Suggested preview toggle lives on the expanded card. */
export interface PendingChangeTarget {
  anchorId: string;
  onKeep: () => void;
  onDismiss: () => void;
}

/** `kind:id` → target. EditorPane derives this from the applied suggestion
 *  cards; its `size` also gates whether EditorPane mounts the pill at all. The
 *  doc-order sort over these keys (the bulk-bar navigator, task 023) lives in the
 *  React-free `@/links/pending-change-nav` so it stays unit-testable. */
export type PendingChangeIndex = Map<string, PendingChangeTarget>;

interface Placement {
  visible: boolean;
  /** CSS `right` (viewport px) — the pill is right-anchored into the left margin. */
  right: number;
  top: number;
  /** The `kind:id` the placement was computed for — the close/re-open identity.
   *  Null when nothing is targeted. */
  targetKey: string | null;
}

const INVISIBLE: Placement = { visible: false, right: 0, top: 0, targetKey: null };

function refKey(ref: AnchoredCardRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Collect the `linkedAnchor` anchorIds at the editor selection head — the
 *  caret-focus candidates. O(1): reads only the marks at/around the head, never
 *  walks the doc. The caller matches these against the applied-pending `index`,
 *  so a non-pending anchor's id simply won't resolve a target (no `kind` check
 *  needed here — the index IS the pending-set membership). */
function anchorIdsAtCaret(editor: Editor): string[] {
  const { selection } = editor.state;
  const $head = selection.$head;
  // A caret resting inside a marked run carries the mark via `$head.marks()`; at
  // the exact run boundary the mark sits on the node before/after instead.
  const before = $head.nodeBefore?.marks ?? [];
  const after = $head.nodeAfter?.marks ?? [];
  const ids: string[] = [];
  for (const m of [...$head.marks(), ...before, ...after]) {
    if (m.type.name === "linkedAnchor" && typeof m.attrs.anchorId === "string") {
      ids.push(m.attrs.anchorId);
    }
  }
  return ids;
}

/**
 * Resolve the active target `kind:id` from the three inputs, hover first. The
 * hover/selection refs are read from the cardStore; the caret anchorId is read
 * from the editor. Only refs/anchors that resolve to an applied-pending entry in
 * `index` count (so a hovered NON-pending card never summons the pill).
 *
 * Exported for unit testing — it is the load-bearing binding between the
 * cardStore hover/selection + caret focus and the applied-pending index (the
 * part live preview can't drive because the placement is RAF-gated).
 */
export function resolveTargetKey(
  hover: AnchoredCardRef | null,
  selected: AnchoredCardRef | null,
  caretAnchorIds: string[],
  index: PendingChangeIndex,
): string | null {
  for (const ref of [hover, selected]) {
    if (!ref) continue;
    // Exact `kind:id` match first.
    const key = refKey(ref);
    if (index.has(key)) return key;
    // Fall back to matching the card ID alone (kind-agnostic): the in-text blue
    // mark stamps the `linkedAnchor.linkCard` namespace from the shared
    // pending-change `LinkedAnchorKind`, which maps to `revision-suggestion` for
    // BOTH families — so a hovered CUTTER applied change arrives with the
    // "revision-suggestion" kind even though its index key is
    // `cutter-suggestion:<id>`. The card ID is unique across the applied set, so
    // an id-only match resolves the right target without depending on the
    // (currently family-flattened) mark kind.
    const idSuffix = `:${ref.id}`;
    for (const k of index.keys()) {
      if (k.endsWith(idSuffix)) return k;
    }
  }
  // Caret focus: find the index entry whose target anchorId matches a mark at
  // the caret. (index is small — only applied cards — so this is O(applied).)
  if (caretAnchorIds.length > 0) {
    for (const [key, t] of index) {
      if (caretAnchorIds.includes(t.anchorId)) return key;
    }
  }
  return null;
}

/** The viewport left edge of the block (paragraph) DOM element containing `pos`
 *  — the text-column edge for that block, which the paragraph grab handle sits
 *  just to the left of. Walks up from the text node to the direct block child
 *  of the editor content root. Returns null if the DOM can't be resolved. */
/** The top-level block NodeView element containing `pos` — the same element
 *  `editor.view.nodeDOM(blockPos)` returns, resolved by walking up from the
 *  text node to the direct child of the ProseMirror DOM. Feeds BOTH the pill's
 *  horizontal seat (its left edge) and its vertical seat (the optical
 *  cap-band-center font target). Null on any failure. */
function resolveParagraphBlockEl(editor: Editor, pos: number): HTMLElement | null {
  try {
    const domAt = editor.view.domAtPos(pos);
    let el: Node | null = domAt.node;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const pmDom = editor.view.dom;
    let block = el as HTMLElement | null;
    while (block && block.parentElement && block.parentElement !== pmDom) {
      block = block.parentElement;
    }
    return block instanceof HTMLElement ? block : null;
  } catch {
    return null;
  }
}

/**
 * The pill's VERTICAL seat: the OPTICAL cap-band center of the change's first
 * line, composing the shared `opticalCenterY` primitive (via
 * `text-metrics.ts`) — the SAME vertical anchor the grab handle
 * (`TextObjectGrabHandle` `opticalCenterY(baseTop, frame.target)`) and the
 * marginalia marker (`useMarginaliaRegistry` `opticalCenterY(...)`) seat on, so
 * the three align on a shared row BY CONSTRUCTION rather than by coincidence of
 * the current font's metrics. `lineTop`/`lineBottom` are the `coordsAtPos` line
 * box for `range.from`; `lineTop` is exactly the line-box top the primitive
 * expects (the coordinate space the grab handle passes as `baseTop`).
 *
 * Falls back to the line-box geometric center only when the block target can't
 * be resolved (no DOM) — matching the primitive's own metrics-unavailable
 * degrade.
 */
export function pillVerticalSeat(
  lineTop: number,
  lineBottom: number,
  target: HTMLElement | null,
): number {
  return target ? opticalCenterY(lineTop, target) : (lineTop + lineBottom) / 2;
}

/** One `coordsAtPos` over the target's blue range, mirroring
 *  SelectionActionsMenu's cached-metric placement. Hidden when the editor is
 *  collapsed (keep-alive), the range is gone, or the range is scrolled out of
 *  the editor's viewport. */
function computePlacement(
  editor: Editor,
  cache: EditorViewportCache,
  targetKey: string | null,
  index: PendingChangeIndex,
): Placement {
  if (!targetKey) return INVISIBLE;
  const target = index.get(targetKey);
  if (!target) return INVISIBLE;
  // Keep-alive: a hidden (display:none) editor measures 0×0 — bail BEFORE
  // coordsAtPos so the pill never jitters and a hidden pane does no measure.
  if (!cache.editorEl || cache.editorEl.offsetHeight === 0) return INVISIBLE;

  const range = findLinkedAnchorRange(editor.state.doc, target.anchorId);
  if (!range) return INVISIBLE;

  let coords: { left: number; top: number; bottom: number };
  try {
    coords = editor.view.coordsAtPos(range.from);
  } catch {
    return INVISIBLE;
  }

  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;
  // Off-screen (scrolled out of the editor's viewport band) → hide.
  if (coords.bottom < scrollTop || coords.top > scrollBottom) {
    return { visible: false, right: 0, top: 0, targetKey };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Seat the pill in the LEFT MARGIN, just OUTSIDE the paragraph grab bar: take
  // the change paragraph's block-left edge (the text column edge for that block,
  // which the grab handle sits ~21px left of) and put the pill's right edge
  // `GRAB_BAR_CLEARANCE` further left — clear of the grab bar. Vertically center
  // on the change's first line. It may overlap other margin markers (accepted;
  // the pill z-order lifts it above them).
  const blockEl = resolveParagraphBlockEl(editor, range.from);
  const textLeft = blockEl?.getBoundingClientRect().left ?? coords.left;
  const rightEdge = textLeft - GRAB_BAR_CLEARANCE; // viewport x of the pill's right edge
  let right = vw - rightEdge; // CSS `right`
  if (right < VIEWPORT_MARGIN) right = VIEWPORT_MARGIN;
  if (right > vw - VIEWPORT_MARGIN) right = vw - VIEWPORT_MARGIN;

  // Optical cap-band center of the change's first line (the shared vertical SSOT),
  // so the pill aligns with the grab handle + marginalia marker on the same row.
  const fontTarget = blockEl ? resolveInlineContextElement(blockEl) : null;
  let top = pillVerticalSeat(coords.top, coords.bottom, fontTarget);
  top = Math.max(top, scrollTop + VIEWPORT_MARGIN, VIEWPORT_MARGIN);
  if (top > vh - VIEWPORT_MARGIN) top = vh - VIEWPORT_MARGIN;

  return { visible: true, right, top, targetKey };
}

function placementsEqual(a: Placement, b: Placement): boolean {
  return (
    a.visible === b.visible &&
    a.right === b.right &&
    a.top === b.top &&
    a.targetKey === b.targetKey
  );
}

/**
 * The floating pill. Mounted by EditorPane ONLY while an applied pending change
 * exists. `index` is the applied-pending target set; `store` is THIS doc's
 * cardStore (so the hover read is per-doc and never bleeds across keep-alive
 * panes).
 */
export function PendingChangePill({
  editorRef,
  store,
  index,
}: {
  editorRef: RefObject<Editor | null>;
  store: CardStore;
  index: PendingChangeIndex;
}) {
  const hover = useStoreHover(store);
  const selected = useStoreSelection(store);
  const [placement, setPlacement] = useState<Placement>(INVISIBLE);
  // Keep the latest target resolvers reachable from the mount-once RAF effect
  // without re-subscribing the editor listener on every hover/selection change.
  /* eslint-disable react-hooks/refs -- This RAF-coalesced placement portal
     latches the latest hover/selection/index and reads the viewport-cache /
     editor refs DURING RENDER by design, so the mount-once RAF effect can see
     live values without re-subscribing the editor listener on every
     hover/selection change. Same established pattern as SelectionActionsMenu
     (the cloned component) and the float-body refs convention. */
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const indexRef = useRef(index);
  indexRef.current = index;

  const { cacheRef, version: cacheVersion } = useEditorViewportCache(
    editorRef.current,
  );
  /* eslint-enable react-hooks/refs */

  // The RAF-coalesced placement compute. Held in a ref so BOTH effects below
  // share ONE scheduler: the long-lived subscription effect (editor events +
  // scroll/resize) and the short trigger effect (hover/selection/index change).
  // `run` reads the latest hover/selected/index/cache off refs, so the scheduler
  // identity never has to change when those change — it stays mounted while the
  // trigger effect just pokes it. The `placementsEqual` bail keeps a
  // structurally-null keystroke from re-rendering the portal.
  const scheduleRef = useRef<() => void>(() => {});
  useEffect(() => {
    let rafId = 0;
    const run = () => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) {
        setPlacement((prev) => (placementsEqual(prev, INVISIBLE) ? prev : INVISIBLE));
        return;
      }
      const caretAnchorIds = ed.isFocused ? anchorIdsAtCaret(ed) : [];
      const targetKey = resolveTargetKey(
        hoverRef.current,
        selectedRef.current,
        caretAnchorIds,
        indexRef.current,
      );
      const next = computePlacement(ed, cacheRef.current, targetKey, indexRef.current);
      // Scroll-anchor stability probe (task 042): one record per coalesced frame.
      recordScrollPlacement(SCROLL_PORTAL_PENDING_PILL, next.top);
      setPlacement((prev) => (placementsEqual(prev, next) ? prev : next));
    };
    const update = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        run();
      });
    };
    scheduleRef.current = update;

    let readyRaf = 0;
    let subscribed: Editor | null = null;
    const subscribe = (ed: Editor) => {
      subscribed = ed;
      ed.on("selectionUpdate", update);
      ed.on("update", update);
      ed.on("focus", update);
      ed.on("blur", update);
    };
    const unsubscribe = () => {
      if (!subscribed) return;
      subscribed.off("selectionUpdate", update);
      subscribed.off("update", update);
      subscribed.off("focus", update);
      subscribed.off("blur", update);
      subscribed = null;
    };
    const waitForEditor = () => {
      const ed = editorRef.current;
      if (ed) {
        subscribe(ed);
        run();
        return;
      }
      readyRaf = requestAnimationFrame(waitForEditor);
    };
    waitForEditor();
    const scrollParent = findEditorScrollFor(editorRef.current?.view.dom ?? null);
    scrollParent?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (readyRaf) cancelAnimationFrame(readyRaf);
      unsubscribe();
      scrollParent?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // `cacheVersion` re-runs when the viewport cache changes (sidebar toggle).
  }, [editorRef, cacheRef, cacheVersion]);

  // Re-run placement when the hovered/selected card or the applied index
  // changes — these are cardStore/React changes, NOT editor events, so they
  // wouldn't otherwise schedule a compute. Pokes the shared RAF scheduler
  // (already O(1) + placement-bail), so this is not per-keystroke work: hover
  // changes only on a real mouse move, selection on a click, index on an
  // apply/keep/revert. (The refs above already carry the latest values into
  // `run`; this just triggers it.)
  useEffect(() => {
    scheduleRef.current();
  }, [hover, selected, index]);

  if (!placement.visible || placement.targetKey === null) return null;
  if (typeof document === "undefined") return null;
  const target = index.get(placement.targetKey);
  if (!target) return null;

  return createPortal(
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-md border border-sky-200 bg-surface px-1.5 py-1 shadow-lg"
      style={{
        position: "fixed",
        right: placement.right,
        top: placement.top,
        // Vertically center the pill on the change's first line (it's seated in
        // the left margin, level with the prose).
        transform: "translateY(-50%)",
        zIndex: RESTING_MARGIN_TRIGGER_Z,
        whiteSpace: "nowrap",
      }}
      role="group"
      aria-label="Pending change actions"
      data-pending-change-pill={placement.targetKey}
      // Prevent a mousedown on the pill from blurring the editor / clearing the
      // selection before the click registers (mirrors the margin bolt).
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Check — keep (finalize the suggested text). */}
      <button
        type="button"
        aria-label="Keep change"
        title="Keep"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          target.onKeep();
        }}
        className="inline-flex items-center justify-center h-6 w-6 rounded-md text-emerald-600 hover:bg-emerald-50 transition-colors"
      >
        <PillGlyph kind="check" />
      </button>
      {/* Cross — dismiss (restore original + archive; never deletes). */}
      <button
        type="button"
        aria-label="Dismiss change"
        title="Dismiss (restores original, archives the card)"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          target.onDismiss();
        }}
        className="inline-flex items-center justify-center h-6 w-6 rounded-md text-ink-subtle hover:bg-danger-soft hover:text-danger transition-colors"
      >
        <PillGlyph kind="cross" />
      </button>
    </div>,
    document.body,
  );
}
