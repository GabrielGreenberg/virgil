"use client";

import { memo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
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
  panelSide: "left" | "right";
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  onEditorFocus?: (editor: any) => void;
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
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
}: ArchivePanelProps) {
  return (
    <CardListPanel
      kind="archive"
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="archive" label="Archive color" />
          </div>
          <CardViewModeMenuItems kind="archive" />
        </ItemMenu>
      }
      items={snippets}
      getId={(s) => s.id}
      getArchived={(s) => !!s.archived}
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
