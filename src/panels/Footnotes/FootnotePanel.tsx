"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote, AiRequest } from "@/lib/types";
import ViewToggle from "@/components/ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  TargetIcon,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
  startFootnoteDrag,
} from "./FootnoteCard";

type FootnoteItem =
  | { kind: "anchored"; data: FootnoteInfo }
  | { kind: "orphan"; data: OrphanedFootnote };

interface FootnotePanelProps {
  footnotes: FootnoteInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, newContent: JSONContent) => void;
  onDelete: (id: string) => void;
  onScrollToMarker: (id: string) => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  orphanedFootnotes: OrphanedFootnote[];
  onDeleteOrphan: (id: string) => void;
  onEditOrphan: (id: string, newContent: JSONContent) => void;
  onEditOrphanTitle?: (id: string, title: string) => void;
  onAdd?: () => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onEditTitle?: (id: string, title: string) => void;
  onEditorFocus?: (editor: any) => void;
}

function FootnotePanel({
  footnotes,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onScrollToMarker,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
  orphanedFootnotes,
  onDeleteOrphan,
  onEditOrphan,
  onEditOrphanTitle,
  onAdd,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditTitle,
  onEditorFocus,
}: FootnotePanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "footnote"),
    [aiRequests],
  );
  const inTextItems = useMemo(
    () => footnotes.map((fn) => ({ id: fn.footnoteId, pos: fn.pos })),
    [footnotes],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
  );

  const onActivateFootnote = useCallback(
    (fn: FootnoteInfo) => {
      onSelect(fn.footnoteId);
      onScrollToMarker(fn.footnoteId);
    },
    [onSelect, onScrollToMarker],
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(footnotes, onActivateFootnote);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = footnotes.findIndex((fn) => fn.footnoteId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, footnotes, cycleIdx, setCycleIdx]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (footnotes.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cycleNext();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cyclePrev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [footnotes, cycleNext, cyclePrev],
  );

  const items = useMemo<FootnoteItem[]>(
    () => [
      ...orphanedFootnotes.map(
        (o): FootnoteItem => ({ kind: "orphan", data: o }),
      ),
      ...footnotes.map(
        (f): FootnoteItem => ({ kind: "anchored", data: f }),
      ),
    ],
    [orphanedFootnotes, footnotes],
  );

  const inTextOrphansTrailing =
    viewMode === "in-text" && orphanedFootnotes.length > 0 ? (
      <div
        className="absolute left-0 right-0 px-1 pr-4"
        style={{ top: (editorScrollHeight || 0) + 8 }}
      >
        {orphanedFootnotes.map((orphan) => {
          const preview = richJsonToPlainText(orphan.content);
          return (
            <div
              key={orphan.footnoteId}
              data-link-card={`footnote:${orphan.footnoteId}`}
              draggable
              onDragStart={(e) =>
                startFootnoteDrag(e, orphan.footnoteId, orphan.content, true)
              }
              className="px-1 py-2 border-b border-b-stone-200 cursor-grab active:cursor-grabbing hover:bg-surface-muted transition-colors"
            >
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <rect
                      x="1"
                      y="1"
                      width="14"
                      height="14"
                      rx="3"
                      stroke="#b0b0b0"
                      strokeWidth="1.5"
                      fill="#f5f5f4"
                    />
                    <text
                      x="8"
                      y="11.5"
                      textAnchor="middle"
                      fontSize="9"
                      fontWeight="600"
                      fill="#b0b0b0"
                      fontFamily="var(--font-sans), sans-serif"
                    >
                      fn
                    </text>
                    <line
                      x1="3"
                      y1="13"
                      x2="13"
                      y2="3"
                      stroke="#b0b0b0"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <p
                  className="text-xs text-ink-muted leading-snug line-clamp-2 min-w-0"
                  style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                >
                  {preview}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <CardListPanel
      kind="footnotes"
      onAdd={onAdd}
      onAiRequest={onAddAiRequest}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="footnote" label="Footnote color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      }
      headerExtras={
        <PrevNextCounter
          current={cycleIdx}
          total={footnotes.length}
          label=""
        />
      }
      items={items}
      getId={(it) => it.data.footnoteId}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No footnotes. Select text and use the toolbar to create one.
        </div>
      }
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      inTextTrailing={inTextOrphansTrailing}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(it, { selected }) =>
        it.kind === "anchored" ? (
          <FootnoteCard
            footnote={it.data}
            isSelected={selected}
            onSelect={() =>
              onSelect(selectedId === it.data.footnoteId ? null : it.data.footnoteId)
            }
            onJump={() => onScrollToMarker(it.data.footnoteId)}
            onEdit={(json) => onEdit(it.data.footnoteId, json)}
            onDelete={() => onDelete(it.data.footnoteId)}
            onEditTitle={(title) => onEditTitle?.(it.data.footnoteId, title)}
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        ) : (
          <OrphanedFootnoteCard
            orphan={it.data}
            isSelected={selected}
            onSelect={() =>
              onSelect(selectedId === it.data.footnoteId ? null : it.data.footnoteId)
            }
            onEdit={(json) => onEditOrphan(it.data.footnoteId, json)}
            onDelete={() => onDeleteOrphan(it.data.footnoteId)}
            onEditTitle={(title) => onEditOrphanTitle?.(it.data.footnoteId, title)}
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        )
      }
      inTextRenderItem={(it, { selected: _selected }) => {
        if (it.kind !== "anchored") return null;
        const fn = it.data;
        const preview = richJsonToPlainText(fn.content);
        return (
          <div
            data-link-card={`footnote:${fn.footnoteId}`}
            draggable
            onDragStart={(e) =>
              startFootnoteDrag(e, fn.footnoteId, fn.content, false)
            }
            className={`group px-1 pr-4 py-2 border-b transition-colors cursor-grab active:cursor-grabbing in-text-connector in-text-connector-${panelSide} ${
              selectedId === fn.footnoteId
                ? "bg-danger-soft/60 border-l-2 border-l-red-300 border-b-stone-300"
                : "border-b-stone-300 hover:bg-surface-muted"
            }`}
            onClick={() =>
              onSelect(selectedId === fn.footnoteId ? null : fn.footnoteId)
            }
          >
            <div
              className={`absolute top-1 right-1 transition-opacity ${
                selectedId === fn.footnoteId
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-40 hover:!opacity-100"
              }`}
              draggable={false}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <TargetIcon
                onClick={() => onScrollToMarker(fn.footnoteId)}
                title="Jump to footnote marker"
              />
            </div>
            <div className="flex items-start gap-2">
              <span className="inline-flex items-center shrink-0 mt-0.5">
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold"
                  style={{
                    background: "#fef2f2",
                    color: "#b45757",
                    border: "1.5px solid #b45757",
                  }}
                >
                  {fn.number}
                </span>
              </span>
              <p
                className="text-xs text-ink-body leading-snug line-clamp-2 min-w-0"
                style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
              >
                {preview || (
                  <span className="italic text-ink-muted">Empty</span>
                )}
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}

export default memo(FootnotePanel);
