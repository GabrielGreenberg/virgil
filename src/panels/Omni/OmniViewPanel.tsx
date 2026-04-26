"use client";

import { useMemo, memo, useState, useRef, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  OMNI_PANELS,
  PANEL_REGISTRY,
} from "@/panels/panel-registry";
import type { CardKind, OmniItem } from "@/panels/_shared/types";

/**
 * The Omni-view threads pods from several other panels into a single
 * unified list. On the left side it merges footnotes, citations and
 * quotations; on the right side it merges notes, archive snippets, and
 * todos.
 *
 * Each item is a `content` ReactNode that should render EXACTLY the
 * same card its native panel renders. The caller (EditorLayout) builds
 * these by calling each panel's `build<Kind>OmniItems` helper.
 *
 * Card ids follow the registry's `popKey(kind, id)` shape — e.g.
 * `note:abc`, `footnote:def`. Categories ARE card kinds; this is the
 * canonical taxonomy.
 */

export type { OmniItem };

/** Category keys are CardKinds. The omni filter menu shows one row per
 *  omni-eligible panel's card kind. */
export type OmniCategory = CardKind;

const OMNI_CATEGORIES = OMNI_PANELS.map((p) => p.card!.kind as CardKind);

const CATEGORY_LABELS: Partial<Record<CardKind, string>> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.card!.kind, p.label]),
);

/** Maps strip panel ids to omni category keys. Used by the filter menu
 *  to group categories under the side they live on. */
export const PANEL_TO_CATEGORY: Record<string, OmniCategory> = Object.fromEntries(
  OMNI_PANELS.map((p) => [p.kind, p.card!.kind]),
);

/** Default enabled categories per side, derived from registry. */
export const DEFAULT_OMNI_CATEGORIES: Record<"left" | "right", OmniCategory[]> = {
  left: OMNI_PANELS.filter((p) => p.omniSide === "left").map((p) => p.card!.kind),
  right: OMNI_PANELS.filter((p) => p.omniSide === "right").map((p) => p.card!.kind),
};

/** Map from old 2-char prefix to new full-prefix card kind. Run on first
 *  load to migrate persisted localStorage state. */
const LEGACY_OMNI_PREFIX_MAP: Record<string, CardKind> = {
  fn: "footnote",
  ci: "citation",
  qu: "quotation",
  nt: "note",
  ar: "archive",
  td: "todo",
};

/** Translate a possibly-legacy omni filter list to current card kinds.
 *  Drops any entries that don't map to a known kind. Idempotent: passing
 *  already-current values returns them unchanged. */
export function migrateOmniCategories(list: unknown): OmniCategory[] {
  if (!Array.isArray(list)) return [];
  const out: OmniCategory[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const mapped = LEGACY_OMNI_PREFIX_MAP[item] ?? item;
    if (OMNI_CATEGORIES.includes(mapped as CardKind)) {
      out.push(mapped as CardKind);
    }
  }
  return out;
}

interface OmniViewPanelProps {
  side: "left" | "right";
  items: OmniItem[];
  editor: Editor | null;
  enabledCategories: Set<OmniCategory>;
  onBackgroundClick?: () => void;
}

/** Extract the category prefix from an OmniItem id (e.g. "note" from "note:abc"). */
function categoryOf(id: string): OmniCategory | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const prefix = id.slice(0, colon);
  return OMNI_CATEGORIES.includes(prefix as CardKind)
    ? (prefix as CardKind)
    : null;
}

/**
 * Filter menu for the omni-view. Lives at the bottom of each L/R strip.
 * The kebab is rotated horizontal so it reads as "menu" rather than the
 * vertical kebabs used by per-card overflows. Dropdown opens upward and
 * outward (away from the strip) so it doesn't get clipped.
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
  const [pos, setPos] = useState<{ bottom: number; left?: number; right?: number }>({ bottom: 0 });

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const bottom = window.innerHeight - r.top + 4;
      setPos(side === "left"
        ? { bottom, left: r.left }
        : { bottom, right: window.innerWidth - r.right });
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

  const leftCats = OMNI_CATEGORIES.filter((c) => categorySides[c] === "left");
  const rightCats = OMNI_CATEGORIES.filter((c) => categorySides[c] === "right");

  const isDefault = useMemo(() => {
    if (enabled.size !== defaultCategories.length) return false;
    return defaultCategories.every((c) => enabled.has(c));
  }, [enabled, defaultCategories]);

  const renderRow = (cat: OmniCategory) => (
    <button
      key={cat}
      onMouseDown={(e) => { e.preventDefault(); onToggle(cat); }}
      className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light transition-colors flex items-center justify-between gap-3"
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
        className="p-1.5 rounded text-[var(--muted)] hover:text-ink-body hover-on-light transition-colors flex items-center justify-center"
        title="Filter items"
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
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light transition-colors flex items-center justify-between gap-3"
          >
            <span>Default view</span>
            <span className="text-[var(--accent)]">{isDefault ? "✓" : ""}</span>
          </button>
          <div className="my-1 border-t border-stone-100" />
          {leftCats.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                Left-side tools
              </div>
              {leftCats.map(renderRow)}
            </>
          )}
          {rightCats.length > 0 && (
            <>
              {leftCats.length > 0 && <div className="my-1 border-t border-stone-100" />}
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                Right-side tools
              </div>
              {rightCats.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OmniViewPanel({
  side: _side,
  items,
  editor,
  enabledCategories,
  onBackgroundClick,
}: OmniViewPanelProps) {
  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      const cat = categoryOf(item.id);
      return cat == null || enabledCategories.has(cat);
    });
  }, [items, enabledCategories]);

  const { anchored, unanchored } = useMemo(() => {
    const anchored: Array<OmniItem & { pos: number }> = [];
    const unanchored: OmniItem[] = [];
    for (const item of visibleItems) {
      if (item.pos == null) unanchored.push(item);
      else anchored.push({ ...item, pos: item.pos });
    }
    anchored.sort((a, b) => a.pos - b.pos);
    return { anchored, unanchored };
  }, [visibleItems]);

  const inTextItems = useMemo(
    () => anchored.map((i) => ({ id: i.id, pos: i.pos })),
    [anchored],
  );

  const unanchoredRef = useRef<HTMLDivElement>(null);
  const topOffsetRef = useRef(0);
  useEffect(() => {
    if (unanchored.length === 0) {
      topOffsetRef.current = 0;
      return;
    }
    const el = unanchoredRef.current;
    if (!el) { topOffsetRef.current = 0; return; }
    const measure = () => { topOffsetRef.current = el.offsetHeight; };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [unanchored.length]);

  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    true,
    "data-omni-entry",
    topOffsetRef,
  );

  return (
    <div className="relative w-full h-full">
      <div
        ref={panelScrollRef}
        className="w-full h-full overflow-y-auto hide-scrollbar"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
        }}
        onMouseDown={(e) => {
          if (!onBackgroundClick) return;
          const target = e.target as HTMLElement;
          if (!target.closest("[data-omni-entry]")) {
            onBackgroundClick();
          }
        }}
      >
        {visibleItems.length === 0 && (
          <div className="text-center text-ink-muted text-xs px-3 py-6">
            {enabledCategories.size === 0
              ? "No item types selected — use the filter menu at the bottom of the strip."
              : "No items to show yet."}
          </div>
        )}
        {unanchored.length > 0 && (
          <div ref={unanchoredRef} className="px-2 pt-2 pb-2 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted px-1">
              Unanchored
            </div>
            {unanchored.map((item) => (
              <div key={item.id}>{item.content}</div>
            ))}
          </div>
        )}
        <div
          className="relative"
          style={{ height: editorScrollHeight || "100%" }}
        >
          {anchored.map((item) => {
            const top = positions.get(item.id);
            if (top === undefined) return null;
            return (
              <div
                key={item.id}
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
  );
}

export default memo(OmniViewPanel);

/** Update preferences in `useViewPrefs.placements` to derive each
 *  category's strip side. Used by EditorLayout to pass `categorySides`. */
export function deriveCategorySides(
  placements: Array<{ id: string; side: "left" | "right" }>,
): Record<OmniCategory, "left" | "right"> {
  const result = {} as Record<OmniCategory, "left" | "right">;
  for (const p of placements) {
    const cat = PANEL_TO_CATEGORY[p.id];
    if (cat) result[cat] = p.side;
  }
  for (const p of OMNI_PANELS) {
    const cat = p.card!.kind as CardKind;
    if (!(cat in result)) {
      result[cat] = p.omniSide ?? "left";
    }
  }
  return result;
}
