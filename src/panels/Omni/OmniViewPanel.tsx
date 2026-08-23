"use client";

import { useMemo, memo, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  useLivePosResolver,
  buildParagraphAnchorMap,
} from "@/hooks/useLivePosResolver";
import { cardPopKey, getPanelByCardKind } from "@/panels/panel-registry";
import {
  CATEGORY_LABELS,
  OMNI_CATEGORIES,
  omniCategoriesOnSide,
  appliedPendingSide,
  type OmniCategory,
} from "./omni-categories";
import type { CardKind, OmniItem, PanelKind } from "@/panels/_shared/types";
import { parseAnyKey } from "@/floats/float-key";
import { OmniProvider } from "@/components/editor-layout/contexts/omni";
import {
  CardDisplayProvider,
  OMNI_COMPRESSED_LINES,
} from "@/components/editor-layout/contexts/card-display";
import {
  BadgeOrphaned,
  CARD_THEMES,
  PrevNextCounter,
  ItemMenu,
  MenuDelete,
  MenuArchive,
} from "@/components/panel-primitives";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";
import { MenuSeparator, MenuSectionLabel } from "@/components/menu/MenuChrome";
import {
  usePinRequest,
  type PinSide,
} from "@/components/editor-layout/omni-pin-store";
import { holdOmniCard } from "@/components/editor-layout/omni-card-placement";
import { useLayoutGestureActive } from "@/lib/pane-resize";
import { cardShellWithin, pressFromInteractiveControl } from "@/lib/drag-blocklist";
import { iconHint } from "@/components/Hint";

/**
 * The Omni-view threads pods from several other panels into a single
 * unified list. Each side's omni view shows cards for the panels
 * currently placed on that side (by default — users can toggle which
 * panels appear via the filter menu).
 *
 * Each item is a `content` ReactNode that should render EXACTLY the
 * same card its native panel renders. The caller (EditorLayout) builds
 * these by calling each panel's `build<Kind>OmniItems` helper.
 *
 * Card ids follow the canonical `float:card:<kind>:<id>` grammar built
 * by `cardPopKey(kind, id)` (e.g. `float:card:note:abc`,
 * `float:card:cutter-comment:xyz`). Filter categories are PanelKinds: one
 * row per omni-eligible panel. The cutter panel is polymorphic (two card
 * kinds) but appears as a single "Cutter" filter row.
 */

export type { OmniItem };

/**
 * How long after this pod mounts the slide stays disarmed (ms).
 *
 * Long enough to cover the ASSEMBLY — the burst of corrections every card takes
 * in the first moments after first paint (the initial convergence passes, a web
 * font swap, NodeView mounts). Animating those reads as a fly-in, the deck
 * assembling itself in front of the user, which is the opposite of what the
 * transition is for. Deliberately a wall-clock window rather than a settle
 * signal: the corrections come from independent sources and only a timer covers
 * all of them without a fourth piece of state to thread.
 *
 * RECALIBRATED BY TASK 370, in what it MEANS rather than in its value. It used
 * to be justified as "comfortably past `useInTextPositions`' bounded settle loop
 * (~500ms of rAF re-measures)" — a loop that no longer exists. Its replacement
 * converges on the consumer's own fixed point under a 6s budget, so a correction
 * can now legitimately land seconds in, and this window can no longer claim to
 * outlast the settle. It does not need to: a LATE correction is exactly the case
 * that SHOULD glide (task 328's `.omni-entry-slide`) rather than teleport — the
 * user is looking at a settled deck and one card moving is a change they should
 * be able to follow. What must not animate is the assembly, which is what this
 * window still covers. So the two constants are no longer coupled, and the
 * residual is inverted: a correction later than this animates once, deliberately.
 */
const SLIDE_ARM_MS = 700;

/** True once this pod's first-paint corrections are past. See above. */
function useSlideArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), SLIDE_ARM_MS);
    return () => window.clearTimeout(t);
  }, []);
  return armed;
}

/** The category vocabulary lives in the `omni-categories` leaf so `useViewPrefs`
 *  and the Reader can read it without this component's graph (task 381).
 *  Re-exported here for the many consumers that already import from this file. */
export {
  PANEL_TO_CATEGORY,
  OMNI_CATEGORIES,
  migrateOmniCategories,
  deriveCategorySides,
  omniCategoriesForSide,
  omniCategoriesOnSide,
  appliedPendingSide,
  hiddenFromLegacySides,
  type OmniCategory,
} from "./omni-categories";

/**
 * The applied-pending bulk affordance threaded EditorPane → OmniHost →
 * OmniViewPanel and rendered by `OmniBulkPendingHeader` as a NAVIGATOR (task
 * 023): a prev/next cursor over the applied changes in doc order, plus a ⋮ kebab
 * holding Keep-all / Dismiss-all. `count` is the total (also gates whether the
 * header renders); `current` is the nav cursor (null before the first step, so
 * `PrevNextCounter` shows the idle total); `onPrev`/`onNext` step + scroll +
 * light each change; `onKeepAll`/`onDismissAll` drain BOTH families through the
 * shared `pending-change-actions` sequence. The SSOT for this shape — imported
 * by OmniHost and EditorPane so the four hops never drift. */
export interface OmniBulkPendingChanges {
  count: number;
  /** The nav cursor's current 0-based index, or null before the first step. */
  current: number | null;
  onPrev: () => void;
  onNext: () => void;
  onKeepAll: () => void;
  onDismissAll: () => void;
}

interface OmniViewPanelProps {
  side: "left" | "right";
  items: OmniItem[];
  editor: Editor | null;
  enabledCategories: Set<OmniCategory>;
  /** When true, suppresses all card rendering regardless of enabled
   *  categories. Driven by the per-side dashed-square button in the
   *  presentation-tools pod. */
  hideAllCards?: boolean;
  /** When true, omni cards rest in a recessed/dimmed surface and brighten
   *  to full on hover (the inverse of the default bright-rest / dim-hover).
   *  Stamps `data-omni-dim="true"` on the cascade root; the inversion is
   *  pure CSS (globals.css, `[data-omni-dim]`). Driven by the `omniDimResting`
   *  view-pref. Selected cards are exempt. */
  dimResting?: boolean;
  onBackgroundClick?: () => void;
  /** Fired when focus moves into any `[data-omni-entry]` card body. The
   *  host uses this to promote a transient selection to sticky once the
   *  user starts working inside the card. */
  onCardFocus?: () => void;
  /** Reports the count of currently-VISIBLE cards (after the enabled-category
   *  + hideAll filter) so the column wrapper can keep itself open when the
   *  omni-view alone is showing cards (no docked band). Fires only when the
   *  count actually changes — `visibleItems` is structurally memoized, so a
   *  plain keystroke never recomputes it and this never fires off the
   *  keystroke path (keystroke sanctity). */
  onVisibleCardsChange?: (count: number) => void;
  /** Phase 3 / task 023 — the applied-pending NAVIGATOR affordance. When present
   *  (count > 0), a small header renders at the top of the cascade with prev/next
   *  arrows + a counter + a ⋮ kebab (Keep-all / Dismiss-all). The host (OmniHost)
   *  only passes this on the side that hosts the applied cards, so it appears
   *  once. Every handler routes through click paths — no per-keystroke work. */
  bulkPendingChanges?: OmniBulkPendingChanges;
  // Pin-driven per-card positioning replaces the old global `cardsOffset`
  // and `cardsSilent` props. See `@/components/editor-layout/omni-pin-store`.
}

/** Resolve the owning panel (filter category) from an OmniItem. Item ids are
 *  the canonical `float:card:<kind>:<id>` grammar (AF). Parse the kind, then map
 *  kind → owning panel via the registry — which collapses the polymorphic kinds
 *  (revision-comment/-suggestion → revisions, the cutter pair → cutter) for
 *  free. Replaces the old first-colon slice, which yielded `"float"` → null →
 *  every card always visible regardless of the category toggles.
 *
 *  NESTED children (an item carrying `parentCardId` — e.g. a footnote-nested
 *  cite): the child's filter category is its PARENT's, not its own. A nested
 *  cite shows/hides with its footnote card (it follows the footnote's column +
 *  filter row) and is thereby suppressed from the flat Citations filter — so it
 *  appears exactly once, under its footnote. Falls back to the child's own
 *  category if the parent key can't be parsed (defensive). */
function categoryOf(item: { id: string; parentCardId?: string }): OmniCategory | null {
  const key = item.parentCardId ?? item.id;
  const parsed = parseAnyKey(key);
  if (!parsed || parsed.domain !== "card") return null;
  const entry = getPanelByCardKind(parsed.kind as CardKind);
  if (!entry?.omniEligible) return null;
  return entry.kind;
}

/**
 * Filter menu for the omni-view. Lives at the bottom of each L/R strip.
 * The kebab is rotated horizontal so it reads as "menu" rather than the
 * vertical kebabs used by per-card overflows. Dropdown opens downward
 * from the button and outward (away from the strip) — matches the
 * convention of the docked MenuBar's overflow menu.
 *
 * "Default view" resets the side's enabled categories to its registry
 * defaults — i.e. the categories whose native panels live on this side.
 *
 * Folded onto `<AnchoredMenu>` (task 143). This menu is where the cost of the
 * stalled migration was actually user-visible: its trigger is pinned to the
 * BOTTOM of the strip (`mt-auto`), and the hand-rolled placement set
 * `top = rect.bottom + 4` unconditionally — no flip-up, no clamp, no
 * `max-height`. On a short viewport with a full strip the whole "Display"
 * cluster therefore rendered below the fold with nothing to scroll. The
 * primitive measures the rendered menu, flips it above when it doesn't fit,
 * and scrolls it when it fits neither way.
 *
 * The rows are the shared `<MenuToggleRow>` — so they gain
 * `role="menuitemcheckbox"` + `aria-checked` + arrow-nav, and the ✓ column
 * stops being a width-jittering conditional. Closing stays explicit (this menu
 * mounts no close-on-inside-click wrapper): the category rows toggle and the
 * menu stays open — several in one visit, as before — while "Default view" is a
 * one-shot and closes itself. `keepMenuOpen` is the row's own fence keeping the
 * activating click off the strip beneath it.
 */
export function OmniFilterMenu({
  side,
  enabled,
  onToggle,
  onSelectDefault,
  categorySides,
}: {
  side: "left" | "right";
  enabled: Set<OmniCategory>;
  onToggle: (cat: OmniCategory) => void;
  onSelectDefault: () => void;
  categorySides: Record<OmniCategory, "left" | "right">;
}) {
  // Each strip's filter menu lists only the panels currently placed on
  // that strip's side. When the user drags a panel between strips, the
  // `categorySides` map updates (via prefs.placements) and the panel's
  // row jumps to the destination menu automatically — and since task 381 the
  // CARDS move with it, because the column is derived from the same map.
  const localCats = useMemo(
    () => omniCategoriesOnSide(categorySides, side),
    [categorySides, side],
  );

  // "Default view" = every category this side owns is visible. There is no
  // separate default LIST any more: side membership is derived, so the only
  // thing "reset" restores is visibility (task 381). A `defaultCategories`
  // prop would be a second, driftable answer to a question `categorySides`
  // already settles.
  const isDefault = useMemo(
    () => localCats.every((c) => enabled.has(c)),
    [enabled, localCats],
  );

  return (
    <AnchoredMenu
      ariaLabel="Filter"
      // The menu opens OUTWARD, away from its strip: a left-strip trigger
      // drops rightward (align:start), a right-strip trigger leftward
      // (align:end) — the same per-side anchoring the hand-rolled version
      // expressed as a `left`-vs-`right` style branch, now stated as a
      // placement the primitive can also FLIP when the space below runs out.
      align={side === "left" ? "start" : "end"}
      triggerHint="Filter"
      triggerClassName="p-1.5 rounded text-[var(--muted)] hover:text-ink-body hover-on-light flex items-center justify-center"
      menuClassName="min-w-[160px]"
      trigger={() => (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      )}
    >
      {({ close }) => (
        <>
          <MenuToggleRow
            id="omni-default-view"
            label="Default view"
            checked={isDefault}
            onToggle={() => {
              onSelectDefault();
              close();
            }}
          />
          {localCats.length > 0 && (
            <>
              <MenuSeparator />
              <MenuSectionLabel>Display</MenuSectionLabel>
              {localCats.map((cat) => (
                <MenuToggleRow
                  key={cat}
                  id={`omni-cat-${cat}`}
                  label={CATEGORY_LABELS[cat] ?? cat}
                  checked={enabled.has(cat)}
                  keepMenuOpen
                  onToggle={() => onToggle(cat)}
                />
              ))}
            </>
          )}
        </>
      )}
    </AnchoredMenu>
  );
}

/**
 * The single `position: absolute` wrapper that hosts BOTH omni bins (the
 * unanchored bin and the outside-focus bin) as a flex COLUMN. This is the one
 * element that carries the zero-flow guard: `position:absolute` → the whole
 * bin subtree takes no flow space, so it never displaces the cascade pod's
 * top the way the old flow <div> did (A5's structural fix), and it carries NO
 * `data-omni-entry-wrapper`, so the cascade ResizeObserver in
 * `useInTextPositions` never measures it (keystroke/measure sanctity).
 *
 * Laying the bins out in normal flow inside this column is the task-127 fix:
 * the outside-focus bin sits directly BELOW the unanchored bin whether the
 * latter is collapsed or expanded, so expanding the unanchored bin can no
 * longer paint its opaque list over the outside-focus pill or swallow its
 * clicks. It replaces the former hand-measured `top:30`/z-index-19-vs-20
 * stacking of two independent absolute siblings. `zIndex:20` keeps the pills
 * above any card anchored to the very first paragraph.
 */
export function OmniBinStack({ children }: { children: ReactNode }) {
  return (
    <div
      data-omni-bin-stack=""
      className="flex flex-col gap-1"
      style={{ position: "absolute", top: 4, left: 8, right: 8, zIndex: 20 }}
    >
      {children}
    </div>
  );
}

/**
 * The unanchored-card bin. Holds every card with no live text anchor —
 * `free` (no link at all) + `orphaned` (link target gone) together (R7).
 * Default-COLLAPSED to a compact count pill (Gabriel-ratified); clicking
 * expands it into a bounded, self-scrolling list that grows DOWNWARD.
 *
 * Rendered as a NORMAL-FLOW block inside the shared `OmniBinStack` wrapper
 * (`data-omni-bin-stack`), which is the single `position: absolute` element
 * that takes zero flow space — the key structural fix for the overwrite bug
 * (the old flow <div> displaced podRect.top, desyncing every anchored card).
 * Living in flow inside that wrapper means the sibling outside-focus bin
 * naturally sits BELOW this one whether this bin is collapsed or expanded
 * (task 127 — no hand-measured offset, no z-index fight, no expanded-state
 * overlap). It carries NO `data-omni-entry-wrapper`, so the cascade
 * ResizeObserver in `useInTextPositions` never observes it and its
 * expand/collapse never bumps `measureVersion` (keystroke/measure sanctity).
 * The wrapper's z-index sits above the cards so the pill overlays any card
 * anchored to the very first paragraph rather than hiding under it.
 */
export function OmniUnanchoredBin({
  free,
  orphaned,
}: {
  free: OmniItem[];
  orphaned: OmniItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const count = free.length + orphaned.length;
  if (count === 0) return null;

  return (
    <div data-omni-unanchored-bin="">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="omni-bin-pill w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] font-medium"
        data-hint={expanded ? "Collapse unanchored cards" : "Show unanchored cards"}
        aria-label={expanded ? "Collapse unanchored cards" : "Show unanchored cards"}
        aria-expanded={expanded}
      >
        <span aria-hidden="true">
          <BadgeOrphaned theme={CARD_THEMES.error} />
        </span>
        <span>
          {count} unanchored
        </span>
        <span className="ml-auto" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div
          className="mt-1 space-y-2 overflow-y-auto rounded bg-surface/95 backdrop-blur-sm border border-edge-subtle p-2"
          style={{ maxHeight: "var(--dock-slot-frame-h, 80vh)" }}
        >
          {orphaned.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <span className="pt-1 shrink-0" data-omni-bin-orphan-marker="">
                <BadgeOrphaned theme={CARD_THEMES.error} />
              </span>
              <div className="min-w-0 flex-1">{item.content}</div>
            </div>
          ))}
          {free.map((item) => (
            <div key={item.id}>{item.content}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The "outside focus" bin. When focus view is active, cards anchored OUTSIDE
 * the focused band have a hidden in-text anchor, so they can't cascade inline.
 * Rather than drop them (silent data loss — the user's note just vanishes),
 * they collect here in a collapsed count pill, expandable to a bounded list.
 * The cards render only when expanded, so no live editors mount by default.
 *
 * Like the unanchored bin, this renders as a NORMAL-FLOW block inside the
 * shared `OmniBinStack` wrapper. Because the wrapper lays its children out in
 * a flex column, this bin sits directly below the unanchored bin whether that
 * bin is collapsed or expanded — no hand-measured `topPx`, no z-index fight
 * (task 127, replacing the former static `top:30` that the expanded
 * unanchored list painted over).
 */
export function OmniOutsideFocusBin({
  items,
}: {
  items: OmniItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const count = items.length;
  if (count === 0) return null;

  return (
    <div data-omni-outside-focus-bin="">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="omni-bin-pill w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] font-medium"
        data-hint={
          expanded
            ? "Collapse cards outside the focus band"
            : "These cards are anchored outside your focus band. Switch off focus or extend the band to see them inline."
        }
        aria-label={expanded ? "Collapse cards outside focus" : "Show cards outside focus"}
        aria-expanded={expanded}
      >
        <span aria-hidden="true" className="text-[11px] leading-none">◎</span>
        <span>{count} outside focus</span>
        <span className="ml-auto" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div
          className="mt-1 space-y-2 overflow-y-auto rounded bg-surface/95 backdrop-blur-sm border border-edge-subtle p-2"
          style={{ maxHeight: "var(--dock-slot-frame-h, 80vh)" }}
        >
          {items.map((item) => (
            <div key={item.id}>{item.content}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One prev/next chevron for the bulk-pending navigator. Up = step to the
 *  earlier change (▲, doc order), down = the later one (▼). Fires on click (a
 *  nav gesture — never per keystroke). Disabled when there's nothing to step. */
function NavArrow({
  dir,
  onClick,
  disabled,
}: {
  dir: "up" | "down";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...iconHint({
        label: dir === "up" ? "Previous change" : "Next change",
        hint:
          dir === "up"
            ? "Jump to the previous change"
            : "Jump to the next change",
      })}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong transition-colors disabled:opacity-30 disabled:pointer-events-none focus-ring"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {dir === "up" ? (
          <polyline points="6 15 12 9 18 15" />
        ) : (
          <polyline points="6 9 12 15 18 9" />
        )}
      </svg>
    </button>
  );
}

/**
 * Phase 3 / task 023 — the applied-pending NAVIGATOR header. A small sticky
 * strip at the top of the cascade laid out left→right as
 * `[▲ prev] [counter "i of N"] [▼ next] ……(spacer)…… [⋮]`, where the ⋮ kebab
 * holds Keep-all / Dismiss-all. `position:sticky; top:0` pins it to the top of
 * the omni column's scroll viewport so it stays reachable as the user scrolls
 * the document (the applied blue ranges can be anywhere in the doc). It's a flow
 * sibling ABOVE the `position:relative` cascade pod (`panelScrollRef`), not
 * inside it, so it cannot desync the absolute-positioned cascade — the cards
 * pack below it.
 *
 * ── Reuse (no bespoke machinery) ──────────────────────────────────────────────
 * `PrevNextCounter` renders the "i of N" / idle-total counter; the ⋮ is
 * `ItemMenu` (align="right", so no auto-injected text-size row) holding a
 * `MenuArchive`-styled "Keep all" + a `MenuDelete`-styled "Dismiss all" (both
 * fire on `onMouseDown`+preventDefault, landing before ItemMenu's click-outside
 * dismissal). The prev/next cursor (`useCycle`) + doc-order sort
 * (`sortAppliedKeysByDocPos`) + scroll/select all live in EditorPane; here
 * they're just wired to the arrows. Dismiss-all PRESERVES (restores original +
 * archives) every card — never hard-deletes.
 */
function OmniBulkPendingHeader({ bulk }: { bulk: OmniBulkPendingChanges }) {
  return (
    <div
      className="sticky top-0 z-30 mx-2 mb-2 flex items-center gap-1.5 rounded-md border border-sky-200 bg-surface px-2 py-1.5 shadow-sm"
      role="group"
      aria-label="Pending change navigator"
      data-omni-bulk-pending={bulk.count}
    >
      <NavArrow dir="up" onClick={bulk.onPrev} disabled={bulk.count === 0} />
      <PrevNextCounter
        current={bulk.current}
        total={bulk.count}
        label="changes"
      />
      <NavArrow dir="down" onClick={bulk.onNext} disabled={bulk.count === 0} />
      <div className="ml-auto">
        <ItemMenu align="right">
          <MenuArchive label="Keep all" onClick={bulk.onKeepAll} />
          <MenuDelete label="Dismiss all" onClick={bulk.onDismissAll} />
        </ItemMenu>
      </div>
    </div>
  );
}

function OmniViewPanel({
  side,
  items,
  editor,
  enabledCategories,
  hideAllCards,
  dimResting,
  onBackgroundClick,
  onCardFocus,
  onVisibleCardsChange,
  bulkPendingChanges,
}: OmniViewPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onCardFocus) return;
    const handler = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-omni-entry]")) onCardFocus();
    };
    root.addEventListener("focusin", handler);
    return () => root.removeEventListener("focusin", handler);
  }, [onCardFocus]);
  const visibleItems = useMemo(() => {
    if (hideAllCards) return [];
    return items.filter((item) => {
      const cat = categoryOf(item);
      return cat == null || enabledCategories.has(cat);
    });
  }, [items, enabledCategories, hideAllCards]);

  // Report the visible-card count up so the column can stay open when the
  // omni-view alone is showing cards (no docked band) — the Reader's narrow-
  // pane collapse rule keys off this. Effect fires only when the count flips
  // (visibleItems is structurally memoized; plain typing never recomputes it),
  // so this is off the keystroke path.
  const visibleCount = visibleItems.length;
  useEffect(() => {
    onVisibleCardsChange?.(visibleCount);
  }, [visibleCount, onVisibleCardsChange]);

  // Live-position resolver (T5 Pillar A). Entity-anchored kinds (footnote /
  // citation / example) resolve their live pos from the DocStructureObserver
  // snapshot via `cardPopKey(kind,id)`; PARAGRAPH-anchored kinds (note / todo /
  // cutter / revision / report / archive, incl. multi-anchor `@N` rows) now
  // ALSO resolve live via their `anchorUuid` → block snapshot pos (the
  // `paragraphAnchors` map). Both the cascade (`useInTextPositions`, at measure
  // time) AND the anchored/orphaned binning below prefer this live pos over the
  // stale baked `item.pos` — closing the gap that made note cards drift up and
  // stack at the top of the gutter while typing (esp. backspace). Snapshot/
  // anchors-identity-cached, so plain typing rebuilds nothing here (keystroke
  // sanctity) — see `useLivePosResolver`.
  const paragraphAnchors = useMemo(
    () => buildParagraphAnchorMap(visibleItems),
    [visibleItems],
  );
  const resolvePos = useLivePosResolver(editor, cardPopKey, paragraphAnchors);

  const { anchored, free, orphaned, outsideFocus } = useMemo(() => {
    const anchored: Array<OmniItem & { pos: number }> = [];
    const free: OmniItem[] = [];
    const orphaned: OmniItem[] = [];
    const outsideFocus: OmniItem[] = [];
    for (const item of visibleItems) {
      // Cards outside the focus band have a hidden in-text anchor → bin them
      // (checked before pos so they never try to cascade at a hidden anchor).
      if (item.outsideFocus) {
        outsideFocus.push(item);
        continue;
      }
      // Prefer the LIVE position (re-mapped every transaction) over the baked
      // `item.pos`, which goes stale as content shifts under plain typing. A
      // paragraph-anchored card whose anchor is still live resolves here; if its
      // anchor is gone the resolver returns undefined and we fall back to the
      // baked pos (so a since-deleted anchor isn't newly orphaned mid-session —
      // the textobject-orphaned sweep owns that strip). This is the bin-side half
      // of the "note cards stack at the top while typing" fix.
      const live = resolvePos(item.id);
      const pos = live ?? item.pos;
      if (pos == null) {
        // No live anchor AND no baked pos → genuinely unanchored. Builders that
        // resolve paragraph UUIDs return pos:null while the editor is still
        // mounting; don't flash those into the unanchored bucket until live.
        if (!editor) continue;
        // Split the unanchored items into the two bin sections by the
        // builder-declared anchorState. (`anchored` here is an extra guard:
        // an anchored item should never carry pos:null, but if a builder
        // ever regresses, treat it as orphaned rather than dropping it.)
        if (item.anchorState === "free") free.push(item);
        else orphaned.push(item);
      } else {
        anchored.push({ ...item, pos });
      }
    }
    anchored.sort((a, b) => a.pos - b.pos);
    return { anchored, free, orphaned, outsideFocus };
  }, [visibleItems, editor, resolvePos]);

  const inTextItems = useMemo(
    () => anchored.map((i) => ({ id: i.id, pos: i.pos })),
    [anchored],
  );

  // Per-card pin: when a marker is clicked in the editor (or a card jump
  // fires `virgil-card-jumped`), the pin store gains an entry holding the
  // OFFSET from that card's anchor-derived natural top that the placement
  // door computed at gesture time (task 362 — the store used to hold an
  // absolute pod Y, which froze a derived answer and decoupled the card
  // from the marker that shares its anchor). We pass it through to
  // useInTextPositions, which does NOT bake it: `resolveCascade` re-derives
  // `naturalTop + offset` on every measure, so the pinned card rides
  // document edits with its anchor. Cards AFTER it pack below; cards BEFORE
  // pack above. Result: the whole deck reflows around the pin without
  // overlap, and the pin cannot go stale.
  const pinRequest = usePinRequest(side as PinSide);
  const pinned = useMemo(
    () => (pinRequest
      ? { id: pinRequest.cardId, offset: pinRequest.offset }
      : null),
    [pinRequest],
  );

  // `resolvePos` + `paragraphAnchors` are defined above (before the binning
  // memo, which now also consumes the live pos). `useInTextPositions` calls
  // `resolvePos(id) ?? item.pos` at measure time, so paragraph-anchored cards
  // track their anchor live on every reflow instead of riding the stale baked
  // pos — the core of the "cards stack at the top while typing" fix.
  const { positions, naturals, editorContentHeight, panelScrollRef } =
    useInTextPositions(editor, inTextItems, true, "data-omni-entry-wrapper", pinned, resolvePos);

  // Motion (task 328): a sanctioned move SLIDES instead of teleporting.
  // Suppressed in the three cases where a transition would be a lie about
  // what happened:
  //  • the arming window — the settle loop, the FOUT corrector and the
  //    NodeView mounts all re-measure in the first moments after this pod
  //    appears, and animating those corrections is a fly-in, not a move;
  //  • while any layout gesture runs (pane drag, OS window resize, content
  //    drag) — those are imperative by law, and the deck settles once on the
  //    gesture's end edge;
  //  • under `prefers-reduced-motion`, handled in globals.css so the opt-in
  //    lives with the rule rather than in a second JS branch.
  // A freshly mounted wrapper never animates either — a CSS transition does
  // not run on an element's FIRST computed value, and a card renders only
  // once `positions` has a top for it.
  const slideArmed = useSlideArmed();
  const gestureActive = useLayoutGestureActive();
  const slide = slideArmed && !gestureActive;

  // Pin lifecycle: a pin is a persistent "deck anchor" cleared only when a
  // new pin replaces it (handled by `omniPinStore.requestPin` itself when
  // the cardId differs). Untying it from selection means collapse-toggling
  // a pinned card no longer snaps it back to its cascaded position — pin
  // stays put. New marker/card-jump interactions still replace cleanly.
  return (
    <OmniProvider value={{ side }}>
    <CardDisplayProvider value={{ compressedLines: OMNI_COMPRESSED_LINES }}>
    <div
      ref={rootRef}
      className="relative w-full"
      // "Dim at rest" mode: gates the omni-only CSS inversion in globals.css
      // (`[data-omni-dim="true"] [data-omni-entry]`). Present-only when on.
      data-omni-dim={dimResting ? "true" : undefined}
      onMouseDown={(e) => {
        if (!onBackgroundClick) return;
        const target = e.target as HTMLElement;
        if (!target.closest("[data-omni-entry]")) {
          onBackgroundClick();
        }
      }}
    >
      {bulkPendingChanges && bulkPendingChanges.count > 0 && (
        <OmniBulkPendingHeader bulk={bulkPendingChanges} />
      )}
      {visibleItems.length === 0 && enabledCategories.size === 0 && (
        <div className="text-center text-ink-muted text-xs px-3 py-6">
          No item types selected — use the filter menu at the bottom of the strip.
        </div>
      )}
      {/* Anchored region: cards absolute-positioned at the pod's top,
          translated to their Y via `transform: translateY(...)`. Using
          `transform` (not `top`) means position changes are composite-
          only — pin clicks don't invalidate layout, so the cascade
          reflow paints in one frame even with many cards.
          The min-height matches the editor content height so the panel
          column extends alongside the document.

          The `OmniBinStack` renders as the FIRST child here, but
          `position: absolute` so it takes ZERO flow space — it does not
          displace this pod's top the way the old flow <div> did (that
          shifted podRect.top while coordsAtPos did not, desyncing every
          anchored card; A5's structural fix). It also deliberately omits
          `data-omni-entry-wrapper`, so the cascade ResizeObserver never
          measures it and its expand/collapse never bumps measureVersion. */}
      <div
        ref={panelScrollRef}
        className="relative"
        style={{ minHeight: editorContentHeight || undefined }}
      >
        <OmniBinStack>
          <OmniUnanchoredBin free={free} orphaned={orphaned} />
          <OmniOutsideFocusBin items={outsideFocus} />
        </OmniBinStack>
        {anchored.map((item) => {
          const isPinned = pinRequest?.cardId === item.id;
          const top = positions.get(item.id);
          if (top === undefined) return null;
          // Nested children (footnote-owned cards, e.g. a footnote-nested
          // cite) read as standalone cascade cards but sit one indent step
          // (16px = `pl-4`) to the right of their footnote card — pixel-
          // matching CitationCard's bib-under-cite `ml-4`. `pl-4` shifts the
          // content right without changing the absolute wrapper's measured
          // width/height, so the cascade math (translateY only) is untouched.
          const isNested = item.parentCardId != null;
          return (
            <div
              key={item.id}
              data-omni-entry-wrapper={item.id}
              // The card's ANCHOR-derived top, published for the one reader
              // that needs it: `omni-card-placement.ts` stores a pin as an
              // OFFSET from this number (task 362), so a pinned card rides
              // document edits with its anchor instead of freezing at a pod
              // coordinate the anchor has since left. Present on every
              // rendered wrapper by construction — this branch runs only
              // when `positions` has a top, which requires a measured
              // natural. Deliberately OMITTED rather than defaulted if it
              // ever isn't: the door fails CLOSED on a missing attribute,
              // and substituting the CASCADED top here would hand it a
              // plausible wrong reference instead.
              data-omni-natural-top={naturals.get(item.id)?.naturalTop}
              data-omni-nested-child={isNested ? "" : undefined}
              className={`absolute left-2 right-2${isNested ? " pl-4" : ""}${
                slide ? " omni-entry-slide" : ""
              }`}
              style={{
                top: 0,
                transform: `translateY(${top}px)`,
                zIndex: isPinned ? 10 : undefined,
              }}
              // Pin-on-touch: any user mousedown on a card publishes a pin
              // at the card's current viewport Y *before* the click triggers
              // selection toggle and the cascade recomputes. The pin keeps
              // the card's top fixed through the collapse/expand height
              // change. Matches the marker-click → pin pattern; the card-
              // body click was the one entry point still missing it.
              // Capture phase so it runs before any descendant onMouseDown
              // (notably PanelCard's lift-threshold watcher).
              onMouseDownCapture={(e) => {
                // Skip presses on interactive controls NESTED INSIDE the card
                // — header buttons, dropdowns, trash, drag handles, and the
                // card's own `contenteditable` prose body. The body is a
                // deliberate member, not a side effect of the shared
                // selector: clicking into live prose changes no height, and
                // a pin published there would be one the user did not ask
                // for, REPLACING whatever pin another card holds (the "a hold
                // that moved a different card" hazard `omni-card-placement`
                // names). The check is asked of the CARD SHELL inside this
                // wrapper, through the shared scoped door: the shell is
                // often `draggable="true"` (cross-editor anchor drags —
                // CitationCard ships it), and an unscoped `closest()` matched
                // that root, so every citation card was dead to pin-on-touch
                // and jumped on collapse/expand (task 423). Scoping to THIS
                // wrapper would not help — the shell is inside it — which is
                // why the shell is resolved first; a wrapper holding no shell
                // (a bare content node) falls back to the wrapper itself.
                const shell = cardShellWithin(e.target, e.currentTarget) ?? e.currentTarget;
                if (pressFromInteractiveControl(e.target, shell)) {
                  return;
                }
                holdOmniCard(e.currentTarget);
              }}
            >
              {item.content}
            </div>
          );
        })}
      </div>
    </div>
    </CardDisplayProvider>
    </OmniProvider>
  );
}

export default memo(OmniViewPanel);
