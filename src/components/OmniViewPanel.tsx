"use client";

import { useMemo, memo, useState, useRef, useEffect, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useInTextPositions } from "@/hooks/useInTextPositions";

/**
 * The Omni-view threads pods from several other panels into a single
 * unified list. On the left side it merges footnotes, citations and
 * quotations; on the right side it merges the corresponding writing
 * pods (notes, revisions, archive snippets, etc.).
 *
 * Each item is a `content` ReactNode that should render EXACTLY the
 * same card its native panel renders — the caller (EditorLayout)
 * builds these by instantiating the extracted card components
 * (CitationCard, FootnoteCard, QuotationGroupCard, …).
 *
 * Cards are absolutely positioned so each one lines up with its
 * corresponding location in the editor. Unanchored items stack at the
 * top of the column.
 */

/** Known item category prefixes. */
export type OmniCategory = "fn" | "ci" | "qu" | "nt" | "ar" | "td";

const CATEGORY_LABELS: Record<OmniCategory, string> = {
  fn: "Footnotes",
  ci: "Citations",
  qu: "Quotations",
  nt: "Notes",
  ar: "Archive",
  td: "Todo",
};

export interface OmniItem {
  /** Unique within the omni view (typically `${kind}:${id}`). */
  id: string;
  /** Document position in the editor; null for unanchored items. */
  pos: number | null;
  /** Pre-rendered card. Must include the data-omni-entry attr on the
      outermost element so in-text positioning can measure its height. */
  content: ReactNode;
}

interface OmniViewPanelProps {
  side: "left" | "right";
  items: OmniItem[];
  /** Editor instance — required for in-text positioning. */
  editor: Editor | null;
  /** Which categories this side currently shows. */
  enabledCategories: Set<OmniCategory>;
  /** Toggle a category on/off for this side. */
  onToggleCategory: (cat: OmniCategory) => void;
  /** Which strip side each category's native panel lives on. */
  categorySides: Record<OmniCategory, "left" | "right">;
}

/** Extract the category prefix from an OmniItem id (e.g. "fn" from "fn:3"). */
function categoryOf(id: string): OmniCategory | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const prefix = id.slice(0, colon);
  return prefix in CATEGORY_LABELS ? (prefix as OmniCategory) : null;
}

/* ── Filter menu (three-dot) ────────────────────────────────────────── */

const ALL_CATEGORIES: OmniCategory[] = ["fn", "ci", "qu", "nt", "ar", "td"];

/** Maps strip panel ids to omni-view category prefixes. */
export const PANEL_TO_CATEGORY: Record<string, OmniCategory> = {
  footnotes: "fn",
  citations: "ci",
  quotations: "qu",
  notes: "nt",
  archive: "ar",
  todo: "td",
};

/** Default enabled categories when no persisted state exists. */
export const DEFAULT_OMNI_CATEGORIES: Record<"left" | "right", OmniCategory[]> = {
  left: ["fn", "ci", "qu"],
  right: ["nt", "ar", "td"],
};

function FilterMenu({
  enabled,
  onToggle,
  categorySides,
}: {
  enabled: Set<OmniCategory>;
  onToggle: (cat: OmniCategory) => void;
  categorySides: Record<OmniCategory, "left" | "right">;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Group categories by their strip side
  const leftCats = ALL_CATEGORIES.filter((c) => categorySides[c] === "left");
  const rightCats = ALL_CATEGORIES.filter((c) => categorySides[c] === "right");

  const renderRow = (cat: OmniCategory) => (
    <button
      key={cat}
      onMouseDown={(e) => { e.preventDefault(); onToggle(cat); }}
      className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 transition-colors flex items-center justify-between gap-3"
    >
      <span>{CATEGORY_LABELS[cat]}</span>
      <span className="text-[var(--accent)]">{enabled.has(cat) ? "✓" : ""}</span>
    </button>
  );

  return (
    <div className="relative shrink-0 -mr-1">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
        title="Filter items"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed bg-white border border-[var(--border)] rounded-lg shadow-lg py-1 z-[9999] min-w-[160px]"
          style={{ top: pos.top, right: pos.right }}
        >
          {leftCats.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                Left-side tools
              </div>
              {leftCats.map(renderRow)}
            </>
          )}
          {rightCats.length > 0 && (
            <>
              {leftCats.length > 0 && <div className="my-1 border-t border-stone-100" />}
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
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

/* ── Main panel ─────────────────────────────────────────────────────── */

function OmniViewPanel({
  side,
  items,
  editor,
  enabledCategories,
  onToggleCategory,
  categorySides,
}: OmniViewPanelProps) {
  // Filter items by enabled categories
  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      const cat = categoryOf(item.id);
      return cat == null || enabledCategories.has(cat);
    });
  }, [items, enabledCategories]);

  // Split into anchored (have pos) and unanchored, sorting anchored
  // in document order so the list traces the page.
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

  // Feed anchored items to the position hook. The hook measures each
  // rendered card's height via the data-omni-entry attribute (which
  // EditorLayout sets on the card wrapper via `extraDataAttrs`).
  const inTextItems = useMemo(
    () => anchored.map((i) => ({ id: i.id, pos: i.pos })),
    [anchored],
  );

  // Measure unanchored section height so scroll sync can offset past it,
  // letting the panel scroll above the document to show unanchored items.
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
      <div className="absolute top-1 -right-1 z-10">
        <FilterMenu enabled={enabledCategories} onToggle={onToggleCategory} categorySides={categorySides} />
      </div>
      <div
        ref={panelScrollRef}
        className="w-full h-full overflow-y-auto hide-scrollbar"
      >
        {visibleItems.length === 0 && (
          <div className="text-center text-stone-400 text-xs px-3 py-6">
            {enabledCategories.size === 0
              ? "No item types selected — use the filter menu."
              : "No items to show yet."}
          </div>
        )}
        {unanchored.length > 0 && (
          <div ref={unanchoredRef} className="px-2 pt-2 pb-2 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1">
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
