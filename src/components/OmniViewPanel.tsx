"use client";

import { useMemo, memo, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { PANEL, PanelHeader } from "./panel-primitives";
import ViewToggle from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";

/**
 * The OmniView threads pods from several other panels into a single
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

function OmniViewPanel({
  side,
  items,
  viewMode,
  onViewModeChange,
  editor,
}: OmniViewPanelProps) {
  // Split into anchored (have pos) and unanchored, sorting anchored
  // in document order so the list traces the page.
  const { anchored, unanchored } = useMemo(() => {
    const anchored: Array<OmniItem & { pos: number }> = [];
    const unanchored: OmniItem[] = [];
    for (const item of items) {
      if (item.pos == null) unanchored.push(item);
      else anchored.push({ ...item, pos: item.pos });
    }
    anchored.sort((a, b) => a.pos - b.pos);
    return { anchored, unanchored };
  }, [items]);

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
      <PanelHeader title="OmniView" count={items.length}>
        <ViewToggle mode={viewMode} onChange={onViewModeChange} />
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={
          viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list
        }
      >
        {items.length === 0 && (
          <div className={PANEL.empty}>
            {side === "left"
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
