"use client";

import { useMemo, memo, useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  useLivePosResolver,
  buildParagraphAnchorMap,
} from "@/hooks/useLivePosResolver";
import {
  cardPopKey,
  OMNI_PANELS,
  getPanelByCardKind,
} from "@/panels/panel-registry";
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
import {
  omniPinStore,
  usePinRequest,
  type PinSide,
} from "@/components/editor-layout/omni-pin-store";
import { INTERACTIVE_CONTROL_SELECTOR } from "@/lib/drag-blocklist";

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

/** Category keys are PanelKinds. The omni filter menu shows one row per
 *  omni-eligible panel. */
export type OmniCategory = PanelKind;

const OMNI_CATEGORIES = OMNI_PANELS.map((p) => p.kind);

const CATEGORY_LABELS: Partial<Record<PanelKind, string>> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.kind, p.label]),
);

/** Identity map kept for back-compat with callers that still import it.
 *  PanelKind is now the category key, so the "panel→category" mapping is
 *  trivially the panel's own kind. */
export const PANEL_TO_CATEGORY: Record<string, OmniCategory> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.kind, p.kind]),
);

/** Default enabled categories per side, derived from registry. */
export const DEFAULT_OMNI_CATEGORIES: Record<"left" | "right", OmniCategory[]> = {
  left: OMNI_PANELS.filter((p) => p.omniSide === "left").map((p) => p.kind),
  right: OMNI_PANELS.filter((p) => p.omniSide === "right").map((p) => p.kind),
};

/** Maps legacy omni filter values (2-char prefixes from the very first
 *  build, then full CardKind strings from a later build) to the current
 *  PanelKind taxonomy. Run on first load to migrate persisted localStorage
 *  state. */
const LEGACY_PREFIX_TO_PANEL: Record<string, PanelKind> = {
  // Earliest build — 2-char prefixes
  fn: "footnotes",
  ci: "citations",
  nt: "notes",
  ar: "archive",
  td: "todo",
};

/** Translate a possibly-legacy omni filter list to current PanelKinds.
 *  Drops any entries that don't resolve to a known omni-eligible panel.
 *  Idempotent: passing already-current PanelKind values returns them
 *  unchanged. */
export function migrateOmniCategories(list: unknown): OmniCategory[] {
  if (!Array.isArray(list)) return [];
  const out: OmniCategory[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    let panel: PanelKind | null = null;
    // Already a PanelKind?
    if (OMNI_CATEGORIES.includes(raw as PanelKind)) {
      panel = raw as PanelKind;
    } else if (raw in LEGACY_PREFIX_TO_PANEL) {
      panel = LEGACY_PREFIX_TO_PANEL[raw];
    } else {
      // Try as a CardKind from the previous taxonomy
      const owner = getPanelByCardKind(raw as CardKind);
      if (owner && owner.omniEligible) panel = owner.kind;
    }
    if (panel && !out.includes(panel)) out.push(panel);
  }
  return out;
}

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
 */
export function OmniFilterMenu({
  side,
  enabled,
  onToggle,
  onSelectDefault,
  categorySides,
  defaultCategories,
}: {
  side: "left" | "right";
  enabled: Set<OmniCategory>;
  onToggle: (cat: OmniCategory) => void;
  onSelectDefault: () => void;
  categorySides: Record<OmniCategory, "left" | "right">;
  defaultCategories: OmniCategory[];
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const top = r.bottom + 4;
      setPos(side === "left"
        ? { top, left: r.left }
        : { top, right: window.innerWidth - r.right });
    }
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, side]);

  // Each strip's filter menu lists only the panels currently placed on
  // that strip's side. When the user drags a panel between strips, the
  // `categorySides` map updates (via prefs.placements) and the panel's
  // row jumps to the destination menu automatically.
  const localCats = OMNI_CATEGORIES.filter((c) => categorySides[c] === side);

  const isDefault = useMemo(() => {
    if (enabled.size !== defaultCategories.length) return false;
    return defaultCategories.every((c) => enabled.has(c));
  }, [enabled, defaultCategories]);

  const renderRow = (cat: OmniCategory) => (
    <button
      key={cat}
      onMouseDown={(e) => { e.preventDefault(); onToggle(cat); }}
      className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
    >
      <span>{CATEGORY_LABELS[cat] ?? cat}</span>
      <span className="text-[var(--accent)]">{enabled.has(cat) ? "✓" : ""}</span>
    </button>
  );

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1.5 rounded text-[var(--muted)] hover:text-ink-body hover-on-light flex items-center justify-center"
        aria-label="Filter"
        data-hint="Filter"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1 z-[9999] min-w-[160px]"
          style={pos}
        >
          <button
            onMouseDown={(e) => { e.preventDefault(); onSelectDefault(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>Default view</span>
            <span className="text-[var(--accent)]">{isDefault ? "✓" : ""}</span>
          </button>
          {localCats.length > 0 && (
            <>
              <div className="my-1 border-t border-edge-subtle" />
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                Display
              </div>
              {localCats.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
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
      aria-label={dir === "up" ? "Previous change" : "Next change"}
      data-hint={
        dir === "up" ? "Jump to the previous change" : "Jump to the next change"
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong transition-colors disabled:opacity-30 disabled:pointer-events-none"
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
  // fires `virgil-card-jumped`), the pin store gains an entry with the
  // pod-relative Y the publisher computed at click time. We pass it
  // through to useInTextPositions, which bakes it into the cascade —
  // cards AFTER the pinned card pack below it; cards BEFORE pack above
  // it. Result: the whole deck reflows around the pin without overlap.
  const pinRequest = usePinRequest(side as PinSide);
  const pinned = useMemo(
    () => (pinRequest
      ? { id: pinRequest.cardId, pinTop: pinRequest.pinTop }
      : null),
    [pinRequest],
  );

  // `resolvePos` + `paragraphAnchors` are defined above (before the binning
  // memo, which now also consumes the live pos). `useInTextPositions` calls
  // `resolvePos(id) ?? item.pos` at measure time, so paragraph-anchored cards
  // track their anchor live on every reflow instead of riding the stale baked
  // pos — the core of the "cards stack at the top while typing" fix.
  const { positions, editorContentHeight, panelScrollRef } =
    useInTextPositions(editor, inTextItems, true, "data-omni-entry-wrapper", pinned, resolvePos);

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
              data-omni-nested-child={isNested ? "" : undefined}
              className={`absolute left-2 right-2${isNested ? " pl-4" : ""}`}
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
                // Skip clicks on interactive controls that don't change
                // layout (header buttons, dropdowns, trash, drag handles).
                // Mirrors the lift blocker at panel-primitives.tsx:1552.
                const target = e.target as HTMLElement;
                if (target.closest(INTERACTIVE_CONTROL_SELECTOR)) {
                  return;
                }
                const wrapper = e.currentTarget;
                const pod = wrapper.parentElement;
                if (!pod) return;
                const pinTop =
                  wrapper.getBoundingClientRect().top -
                  pod.getBoundingClientRect().top;
                omniPinStore.requestPin(side as PinSide, item.id, pinTop);
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

/** Derive each omni-eligible panel's current strip side from
 *  `useViewPrefs.placements`. Categories not present in placements
 *  (shouldn't happen for omni-eligible panels, but defensive) fall back
 *  to their registry `omniSide`. */
export function deriveCategorySides(
  placements: Array<{ id: string; side: "left" | "right" }>,
): Record<OmniCategory, "left" | "right"> {
  const result = {} as Record<OmniCategory, "left" | "right">;
  const omniIds = new Set<string>(OMNI_CATEGORIES);
  for (const p of placements) {
    if (omniIds.has(p.id)) {
      result[p.id as OmniCategory] = p.side;
    }
  }
  for (const p of OMNI_PANELS) {
    if (!(p.kind in result)) {
      result[p.kind] = p.omniSide ?? "left";
    }
  }
  return result;
}
