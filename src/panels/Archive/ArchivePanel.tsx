"use client";

import { memo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
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
  onJumpToCard?: (card: ArchivedSnippet, sourceEl?: HTMLElement | null) => void;
  anchoredIds?: Set<string>;
  editor: Editor | null;
  panelSide: "left" | "right";
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
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
  onCapture,
}: ArchivePanelProps) {
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
      renderCard={(s, { selected }) => (
        <ArchiveCard
          snippet={s}
          selected={selected}
          orphaned={anchoredIds ? !anchoredIds.has(s.id) : undefined}
          onSelect={onSelect}
          onEdit={onEdit}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onJump={onJumpToCard ? (sourceEl) => onJumpToCard(s, sourceEl) : undefined}
          onEditorFocus={onEditorFocus}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
      )}
    />
  );
}

export default memo(ArchivePanel);
