"use client";

import { useMemo, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  getParagraphAnchorPositions,
} from "@/hooks/useInTextPositions";
import {
  ItemMenu,
  PANEL,
  TargetIcon,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { richJsonToPlainText } from "@/lib/footnote-content";
import {
  usePanelCapture,
  type CapturedContent,
} from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { ArchiveCard } from "./ArchiveCard";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onJumpToCard?: (card: ArchivedSnippet) => void;
  anchoredIds?: Set<string>;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  onEditorFocus?: (editor: any) => void;
  onCapture?: (captured: CapturedContent) => void;
}

function ArchivePanel({
  snippets,
  selectedId,
  onSelect,
  onEdit,
  onUpdateTitle,
  onDelete,
  onJumpToCard,
  anchoredIds,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
  onCapture,
}: ArchivePanelProps) {
  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor, snippets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, snippets],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
  );
  const { dropProps, isDragOver } = usePanelCapture({
    editor,
    onCapture: onCapture ?? (() => {}),
    enabled: !!onCapture,
  });

  return (
    <CardListPanel
      kind="archive"
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="archive" label="Archive color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      }
      wrapperClassName={`capture-drop-target${isDragOver ? " capture-drop-target--active" : ""}`}
      wrapperProps={{
        ...dropProps,
        ...(isDragOver ? { "data-capture-drop-active": "true" } : {}),
      }}
      showDropPlaceholder={isDragOver}
      items={snippets}
      getId={(s) => s.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No archived text. Select text and use the menu to archive it.
        </div>
      }
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      renderCard={(s, { selected }) => (
        <ArchiveCard
          snippet={s}
          selected={selected}
          orphaned={anchoredIds ? !anchoredIds.has(s.id) : undefined}
          onSelect={onSelect}
          onEdit={onEdit}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onJump={onJumpToCard ? () => onJumpToCard(s) : undefined}
          onEditorFocus={onEditorFocus}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
      )}
      inTextRenderItem={(s, { selected }) => {
        const preview = richJsonToPlainText(s.content) || "";
        return (
          <div
            data-archive-entry={s.id}
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${
              selected
                ? "bg-amber-50 border-l-2 border-l-amber-400 border-b-edge-hover"
                : "border-b-edge-hover hover-on-light"
            }`}
            onClick={() => onSelect(selected ? null : s.id)}
          >
            {selected && onJumpToCard && (
              <div className="absolute top-1 right-1">
                <TargetIcon
                  onClick={() => onJumpToCard(s)}
                  title="Jump to archive marker"
                />
              </div>
            )}
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {preview || (
                <span className="italic text-ink-muted">Empty</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}

export default memo(ArchivePanel);
