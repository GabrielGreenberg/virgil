"use client";

import { useMemo, memo, useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { PANEL, PanelHeader } from "./panel-primitives";
import ViewToggle from "./ViewToggle";
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
 * In list mode the cards are shown in document order (anchored first,
 * sorted by `pos`; unanchored grouped at the bottom).
 *
 * In in-text mode the cards are absolutely positioned so each one
 * lines up with its corresponding location in the editor.
 */

/** Known item category prefixes. */
export type OmniCategory = "fn" | "ci" | "qu";

const CATEGORY_LABELS: Record<OmniCategory, string> = {
  fn: "Footnotes",
  ci: "Citations",
  qu: "Quotations",
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
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  /** Editor instance — required for in-text view positioning. */
  editor: Editor | null;
}

/** Extract the category prefix from an OmniItem id (e.g. "fn" from "fn:3"). */
function categoryOf(id: string): OmniCategory | null {
  const colon = id.indexOf(":");
  if (colon === -1) return null;
  const prefix = id.slice(0, colon);
  return prefix in CATEGORY_LABELS ? (prefix as OmniCategory) : null;
}

/* ── Filter menu (three-dot) ────────────────────────────────────────── */

const ALL_CATEGORIES: OmniCategory[] = ["fn", "ci", "qu"];

function FilterMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<OmniCategory>;
  onToggle: (cat: OmniCategory) => void;
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
          {ALL_CATEGORIES.map((cat) => {
            const checked = !hidden.has(cat);
            return (
              <button
                key={cat}
                onMouseDown={(e) => { e.preventDefault(); onToggle(cat); }}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 transition-colors flex items-center justify-between gap-3"
              >
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className="text-[var(--accent)]">{checked ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────────────────── */

function OmniViewPanel({
  side,
  items,
  viewMode,
  onViewModeChange,
  editor,
}: OmniViewPanelProps) {
  // Derive which categories exist in the current item list
  const categories = useMemo(() => {
    const seen = new Set<OmniCategory>();
    for (const item of items) {
      const cat = categoryOf(item.id);
      if (cat) seen.add(cat);
    }
    // Stable order: fn, ci, qu
    return (["fn", "ci", "qu"] as OmniCategory[]).filter((c) => seen.has(c));
  }, [items]);

  // Hidden categories (persisted per-component instance via state)
  const [hidden, setHidden] = useState<Set<OmniCategory>>(new Set());

  const toggleCategory = useCallback((cat: OmniCategory) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Filter items by visible categories
  const visibleItems = useMemo(() => {
    if (hidden.size === 0) return items;
    return items.filter((item) => {
      const cat = categoryOf(item.id);
      return cat == null || !hidden.has(cat);
    });
  }, [items, hidden]);

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
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
    "data-omni-entry",
  );

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Omni-view">
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
        <FilterMenu hidden={hidden} onToggle={toggleCategory} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={
          viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list
        }
      >
        {visibleItems.length === 0 && (
          <div className={PANEL.empty}>
            {hidden.size > 0
              ? "All item types are hidden."
              : side === "left"
                ? "No footnotes, citations, or quotations yet."
                : "No notes, revisions, or archived snippets yet."}
          </div>
        )}

        {viewMode === "in-text" ? (
          <>
            {/* Anchored cards positioned over an editor-height container
                so each card aligns with its source location. Cards are
                rendered with pre-applied absolute positioning via the
                wrapper props set by EditorLayout. */}
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
            {unanchored.length > 0 && (
              <div className="px-2 pt-2 pb-2 space-y-2 border-t border-[var(--border)]">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1">
                  Unanchored
                </div>
                {unanchored.map((item) => (
                  <div key={item.id}>{item.content}</div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {anchored.map((item) => (
              <div key={item.id}>{item.content}</div>
            ))}
            {unanchored.length > 0 && (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-1 pt-1">
                  Unanchored
                </div>
                {unanchored.map((item) => (
                  <div key={item.id}>{item.content}</div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(OmniViewPanel);
