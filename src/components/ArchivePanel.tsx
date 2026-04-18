"use client";

import { useMemo, memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions, getParagraphAnchorPositions } from "@/hooks/useInTextPositions";
import { EditableCard, ItemMenu, PANEL, PanelHeader, BadgeLabel, BadgeOrphaned, CardTitleInput, CardTargetIcon, TargetIcon, startTextDrag } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "./PanelThemePicker";
import {
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import { MIME_ARCHIVE_ANCHOR } from "@/lib/marginalia";
import { usePanelCapture, type CapturedContent } from "@/hooks/usePanelCapture";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onScrollToMarker?: (id: string) => void;
  anchoredIds?: Set<string>;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  /** Called with the Tiptap editor when an archive body gains focus (for main toolbar routing). */
  onEditorFocus?: (editor: any) => void;
  /** Called when a paragraph or text selection is dropped onto this panel. */
  onCapture?: (captured: CapturedContent) => void;
}

/* ── Shared helpers ──────────────────────────────────────────────── */

/** Top grab bar: anchor-only drag (no inline text insertion).
 *  NOTE: Do NOT set text/plain here — ProseMirror's default drop handler
 *  would insert it as inline text when the Editor's handleDrop returns false
 *  for anchor drags. */
function startArchiveDrag(
  e: React.DragEvent,
  archiveId: string,
) {
  e.dataTransfer.setData(
    MIME_ARCHIVE_ANCHOR,
    JSON.stringify({ archiveId }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

/* ── ArchiveCard — reusable card for Omni-view ─────────────────── */

export function ArchiveCard({
  snippet,
  selected,
  orphaned,
  onSelect,
  onEdit,
  onUpdateTitle,
  onDelete,
  onScrollToMarker,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
}: {
  snippet: ArchivedSnippet;
  selected: boolean;
  orphaned?: boolean;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onScrollToMarker?: (id: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const isAnchored = !orphaned;
  const theme = useCardTheme("archive");
  const handleEditContent = (json: JSONContent) => {
    onEdit(snippet.id, normalizeRichContent(json));
  };
  return (
    <EditableCard
      id={snippet.id}
      selected={selected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      badge={orphaned
        ? <BadgeOrphaned theme={theme} />
        : <BadgeLabel label="A" theme={theme} />
      }
      headerContent={<CardTitleInput defaultValue={snippet.title} onChange={(t) => onUpdateTitle(snippet.id, t)} theme={theme} />}
      headerTrailing={
        isAnchored && onScrollToMarker
          ? <CardTargetIcon selected={selected} onClick={() => onScrollToMarker(snippet.id)} title="Jump to archive marker" />
          : orphaned
            ? <CardTargetIcon selected={false} disabled onClick={() => {}} />
            : undefined
      }
      onClick={() => onSelect(selected ? null : snippet.id)}
      onDragStart={(e) => startArchiveDrag(e, snippet.id)}
      onTextDragStart={(e) => startTextDrag(e, snippet.content)}
      onDelete={() => onDelete(snippet.id)}
      value={snippet.content}
      variant="footnote"
      placeholder="Text here."
      onChange={handleEditContent}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "archive-entry", value: snippet.id }}
      extraDataAttrs={extraDataAttrs}
      orphaned={orphaned}
    />
  );
}

/* ── ArchivePanel ────────────────────────────────────────────────── */

function ArchivePanel({
  snippets,
  selectedId,
  onSelect,
  onEdit,
  onUpdateTitle,
  onInsert,
  onRestore,
  onDelete,
  onScrollToMarker,
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
    [editor, snippets]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, viewMode === "in-text"
  );
  const { dropProps, isDragOver } = usePanelCapture({
    editor,
    onCapture: onCapture ?? (() => {}),
    enabled: !!onCapture,
  });

  return (
    <div
      {...dropProps}
      data-capture-drop-active={isDragOver ? "true" : undefined}
      className={`w-full bg-transparent flex flex-col overflow-hidden h-full capture-drop-target${isDragOver ? " capture-drop-target--active" : ""}`}
    >
      <PanelHeader title="Archived Text">
        <ItemMenu>
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="archive" label="Archive color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        onClick={() => onSelect(null)}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {snippets.length === 0 && (
          <div className={PANEL.empty}>
            No archived text. Select text and use the menu to archive it.
          </div>
        )}

        {viewMode === "in-text" && snippets.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {snippets.map((s) => {
              const top = positions.get(s.id);
              if (top === undefined) return null;
              const isSelected = selectedId === s.id;
              const preview = richJsonToPlainText(s.content) || "";
              return (
                <div
                  key={s.id}
                  data-archive-entry={s.id}
                  className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${
                    isSelected
                      ? "bg-amber-50 border-l-2 border-l-amber-400 border-b-stone-300"
                      : "border-b-stone-300 hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => onSelect(isSelected ? null : s.id)}
                >
                  {isSelected && onScrollToMarker && (
                    <div className="absolute top-1 right-1">
                      <TargetIcon onClick={() => onScrollToMarker(s.id)} title="Jump to archive marker" />
                    </div>
                  )}
                  <p className="text-xs text-stone-600 leading-snug line-clamp-2 pr-6"
                    style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
                    {preview || <span className="italic text-stone-400">Empty</span>}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          snippets.map((s) => (
            <ArchiveCard
              key={s.id}
              snippet={s}
              selected={selectedId === s.id}
              orphaned={anchoredIds ? !anchoredIds.has(s.id) : undefined}
              onSelect={onSelect}
              onEdit={onEdit}
              onUpdateTitle={onUpdateTitle}
              onDelete={onDelete}
              onScrollToMarker={onScrollToMarker}
              onEditorFocus={onEditorFocus}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default memo(ArchivePanel);
