"use client";

import { useMemo, memo, useState, useRef, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { getBus, type DocStructure } from "@/lib/tiptap/doc-structure";
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
import { BadgeOrphaned, CARD_THEMES } from "@/components/panel-primitives";
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

interface OmniViewPanelProps {
  side: "left" | "right";
  items: OmniItem[];
  editor: Editor | null;
  enabledCategories: Set<OmniCategory>;
  /** When true, suppresses all card rendering regardless of enabled
   *  categories. Driven by the per-side dashed-square button in the
   *  presentation-tools pod. */
  hideAllCards?: boolean;
  onBackgroundClick?: () => void;
  /** Fired when focus moves into any `[data-omni-entry]` card body. The
   *  host uses this to promote a transient selection to sticky once the
   *  user starts working inside the card. */
  onCardFocus?: () => void;
  // Pin-driven per-card positioning replaces the old global `cardsOffset`
  // and `cardsSilent` props. See `@/components/editor-layout/omni-pin-store`.
}

/** Resolve the owning panel (filter category) from an OmniItem id. Item ids are
 *  the canonical `float:card:<kind>:<id>` grammar (AF). Parse the kind, then map
 *  kind → owning panel via the registry — which collapses the polymorphic kinds
 *  (revision-comment/-suggestion → revisions, the cutter pair → cutter) for
 *  free. Replaces the old first-colon slice, which yielded `"float"` → null →
 *  every card always visible regardless of the category toggles. */
function categoryOf(id: string): OmniCategory | null {
  const parsed = parseAnyKey(id);
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
        data-hint="Filter"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
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
 * The unanchored-card bin. Holds every card with no live text anchor —
 * `free` (no link at all) + `orphaned` (link target gone) together (R7).
 * Default-COLLAPSED to a compact count pill (Gabriel-ratified); clicking
 * expands it into a bounded, self-scrolling list that grows DOWNWARD.
 *
 * Rendered `position: absolute; top:0` inside the cascade pod so it takes
 * zero flow space — the key structural fix for the overwrite bug (the old
 * flow <div> displaced podRect.top, desyncing every anchored card). It
 * carries NO `data-omni-entry-wrapper`, so the cascade ResizeObserver in
 * `useInTextPositions` never observes it and its expand/collapse never
 * bumps `measureVersion` (keystroke/measure sanctity). Its z-index sits
 * above the cards so the pill overlays any card anchored to the very
 * first paragraph rather than hiding under it.
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
    <div
      style={{ position: "absolute", top: 0, left: 8, right: 8, zIndex: 20 }}
      data-omni-unanchored-bin=""
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] font-medium text-ink-muted bg-surface border border-edge-subtle shadow-sm hover-on-light"
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
        <span className="ml-auto text-ink-muted" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
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

function OmniViewPanel({
  side,
  items,
  editor,
  enabledCategories,
  hideAllCards,
  onBackgroundClick,
  onCardFocus,
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
      const cat = categoryOf(item.id);
      return cat == null || enabledCategories.has(cat);
    });
  }, [items, enabledCategories, hideAllCards]);

  const { anchored, free, orphaned } = useMemo(() => {
    const anchored: Array<OmniItem & { pos: number }> = [];
    const free: OmniItem[] = [];
    const orphaned: OmniItem[] = [];
    for (const item of visibleItems) {
      if (item.pos == null) {
        // Builders that resolve paragraph UUIDs return pos:null while the
        // editor is still mounting. Don't flash those into the unanchored
        // bucket — drop until the editor is live, at which point pos:null
        // genuinely means "no anchor / orphaned paragraph".
        if (!editor) continue;
        // Split the unanchored items into the two bin sections by the
        // builder-declared anchorState. (`anchored` here is an extra guard:
        // an anchored item should never carry pos:null, but if a builder
        // ever regresses, treat it as orphaned rather than dropping it.)
        if (item.anchorState === "free") free.push(item);
        else orphaned.push(item);
      } else {
        anchored.push({ ...item, pos: item.pos });
      }
    }
    anchored.sort((a, b) => a.pos - b.pos);
    return { anchored, free, orphaned };
  }, [visibleItems, editor]);

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

  // Live-position resolver for `useInTextPositions`. The entity-anchored omni
  // kinds (footnote / citation / example) carry a captured `pos` that only
  // refreshes on structural change post keystroke-sanctity refactor; resolve
  // their live pos from the DocStructureObserver snapshot (re-mapped every
  // transaction) keyed to the SAME `cardPopKey(kind,id)` (= `float:card:<kind>:<id>`)
  // string the omni item id uses — which is what `useInTextPositions` passes here.
  // Paragraph-anchored kinds (note/todo/…) fall through to the captured pos —
  // their primary visualization is the marginalia gutter, which is already
  // sourced live from layout observers. The lookup map is rebuilt only when
  // the snapshot identity changes (once per measure pass), not per item — so
  // plain typing (no structural change) re-derives nothing here.
  const livePosCacheRef = useRef<{ s: DocStructure | null; map: Map<string, number> }>({
    s: null,
    map: new Map(),
  });
  const resolvePos = useCallback(
    (id: string): number | undefined => {
      const s = getBus(editor)?.structure ?? null;
      if (!s) return undefined;
      if (livePosCacheRef.current.s !== s) {
        const map = new Map<string, number>();
        for (const f of s.footnotes) map.set(cardPopKey("footnote", f.id), f.pos);
        for (const c of s.citations) map.set(cardPopKey("citation", c.id), c.pos);
        for (const e of s.examples) {
          map.set(cardPopKey("example", e.id), e.pos);
          if (e.uuid) map.set(cardPopKey("example", e.uuid), e.pos);
        }
        livePosCacheRef.current = { s, map };
      }
      return livePosCacheRef.current.map.get(id);
    },
    [editor],
  );

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
      onMouseDown={(e) => {
        if (!onBackgroundClick) return;
        const target = e.target as HTMLElement;
        if (!target.closest("[data-omni-entry]")) {
          onBackgroundClick();
        }
      }}
    >
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

          The unanchored bin renders as the FIRST child here, but
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
        <OmniUnanchoredBin free={free} orphaned={orphaned} />
        {anchored.map((item) => {
          const isPinned = pinRequest?.cardId === item.id;
          const top = positions.get(item.id);
          if (top === undefined) return null;
          return (
            <div
              key={item.id}
              data-omni-entry-wrapper={item.id}
              className="absolute left-2 right-2"
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
