"use client";

import { useMemo, memo, useState, useRef, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  OMNI_PANELS,
  PANEL_REGISTRY,
  getPanelByCardKind,
} from "@/panels/panel-registry";
import type { CardKind, OmniItem, PanelKind } from "@/panels/_shared/types";
import { OmniProvider } from "@/components/editor-layout/contexts/omni";

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
 * Card ids follow `${cardKindPrefix}:${id}` (e.g. `note:abc`,
 * `cutter-comment:xyz`). Filter categories are PanelKinds: one row per
 * omni-eligible panel. The cutter panel is polymorphic (two card kinds)
 * but appears as a single "Cutter" filter row.
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
  qu: "quotations",
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
  /** Vertical offset (in px) applied to the anchored-cards group as a
   *  whole — set by main-text marker clicks so the clicked card visually
   *  aligns with the click without scrolling the document. The cards'
   *  natural overlap-resolved positions are unchanged; only their visual
   *  position shifts via a transform on the cards container. */
  cardsOffset?: number;
  /** When true, the cards transform updates without the 150ms ease.
   *  Used for jump-to so the card stays perfectly still while the document
   *  scrolls underneath; the marker-click path leaves it false. */
  cardsSilent?: boolean;
}

/** Reverse map from card-key prefix → owning PanelKind, built from the
 *  registry. Key prefixes don't always match card kinds — e.g. revisions'
 *  comment cards use prefix "revision" while their CardKind is "comment".
 *  Polymorphic kinds (cutter-comment, cutter-suggestion) collapse to
 *  the single cutter panel via `getPanelByCardKind`'s POLYMORPHIC map. */
const PREFIX_TO_PANEL: Record<string, PanelKind> = (() => {
  const out: Record<string, PanelKind> = {};
  for (const entry of Object.values(PANEL_REGISTRY)) {
    if (entry.card) out[entry.card.keyPrefix] = entry.kind;
  }
  // Polymorphic kinds: resolve to their owning panel via the registry's
  // POLYMORPHIC_CARD_PANEL table. Notes panel hosts both `note` and
  // `highlight`; Cutter hosts the two cutter kinds; Revisions surfaces
  // `revision-suggestion` for completeness.
  for (const kind of [
    "cutter-comment",
    "cutter-suggestion",
    "revision-suggestion",
    "note",
    "highlight",
  ] as const) {
    const panel = getPanelByCardKind(kind);
    if (panel) out[kind] = panel.kind;
  }
  return out;
})();

/** Resolve the owning panel (filter category) from an OmniItem id.
 *  Item ids are `${keyPrefix}:${id}` — e.g. `note:abc`, `revision:xyz`,
 *  `cutter-comment:abc`. */
function categoryOf(id: string): OmniCategory | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const prefix = id.slice(0, colon);
  const panelKind = PREFIX_TO_PANEL[prefix];
  if (!panelKind) return null;
  const entry = PANEL_REGISTRY[panelKind];
  if (!entry?.omniEligible) return null;
  return panelKind;
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
        title="Filter items"
        data-helper="Filter"
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

function OmniViewPanel({
  side,
  items,
  editor,
  enabledCategories,
  hideAllCards,
  onBackgroundClick,
  cardsOffset,
  cardsSilent,
}: OmniViewPanelProps) {
  const visibleItems = useMemo(() => {
    if (hideAllCards) return [];
    return items.filter((item) => {
      const cat = categoryOf(item.id);
      return cat == null || enabledCategories.has(cat);
    });
  }, [items, enabledCategories, hideAllCards]);

  const { anchored, unanchored } = useMemo(() => {
    const anchored: Array<OmniItem & { pos: number }> = [];
    const unanchored: OmniItem[] = [];
    for (const item of visibleItems) {
      if (item.pos == null) {
        // Builders that resolve paragraph UUIDs return pos:null while the
        // editor is still mounting. Don't flash those into the unanchored
        // bucket — drop until the editor is live, at which point pos:null
        // genuinely means "no anchor / orphaned paragraph".
        if (!editor) continue;
        unanchored.push(item);
      } else {
        anchored.push({ ...item, pos: item.pos });
      }
    }
    anchored.sort((a, b) => a.pos - b.pos);
    return { anchored, unanchored };
  }, [visibleItems, editor]);

  const inTextItems = useMemo(
    () => anchored.map((i) => ({ id: i.id, pos: i.pos })),
    [anchored],
  );

  const { positions, editorContentHeight, panelScrollRef } =
    useInTextPositions(editor, inTextItems, true, "data-omni-entry-wrapper");

  return (
    <OmniProvider value={{ side }}>
    <div
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
      {unanchored.length > 0 && (
        <div className="px-2 pt-4 pb-2 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted px-1 pb-1">
            Unanchored
          </div>
          {unanchored.map((item) => (
            <div key={item.id}>{item.content}</div>
          ))}
        </div>
      )}
      {/* Anchored region: cards absolute-positioned at Y values relative
          to this container, matching their paragraph anchors. The min-height
          matches the editor content height so the panel column extends
          alongside the document. The hook computes Y via
          `coords.top - thisRect.top`, scroll-invariant under unified row scroll.
          The inner wrapper carries `cardsOffset` as a translateY so a click
          in the main text can pull the relevant card to the click without
          scrolling the document. */}
      <div
        ref={panelScrollRef}
        className="relative"
        style={{ minHeight: editorContentHeight || undefined }}
      >
        <div
          style={{
            position: 'relative',
            // Transition listed BEFORE transform so React processes the
            // (un)set of transition first when a jump-to flips silent on:
            // by the time the transform changes, transition is already
            // undefined and the change is instant — no 150ms slide.
            transition: cardsOffset && !cardsSilent ? 'transform 0.15s ease' : undefined,
            transform: cardsOffset ? `translateY(${cardsOffset}px)` : undefined,
          }}
        >
          {anchored.map((item) => {
            const top = positions.get(item.id);
            if (top === undefined) return null;
            return (
              <div
                key={item.id}
                data-omni-entry-wrapper={item.id}
                className="absolute left-2 right-2"
                style={{ top }}
              >
                {item.content}
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
