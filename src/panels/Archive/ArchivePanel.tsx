"use client";

import { dockedKeyboardJump, type DockedJumpGate } from "@/links/card-anchor-rows";
import { memo, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CreationHint } from "@/panels/_shared/CreationHint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { ArchiveCard } from "./ArchiveCard";

interface ArchivePanelProps {
  snippets: ArchivedSnippet[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onJumpToCard?: (card: ArchivedSnippet, sourceEl?: HTMLElement | null) => void;
  /** Task 699: the ONE Jump gate (`cardJumpGate` over the pane's shared
   *  anchor pass). Required so no docked panel can fall back to gating Jump on
   *  "the card stores a link". */
  jumpGate: DockedJumpGate;
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
  jumpGate,
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
}: ArchivePanelProps) {
  // Keyboard activation (task 964): the shell selects; this jumps through the
  // card's own gate, the twin of its Jump button.
  const keyboardJump = useMemo(
    () => dockedKeyboardJump(jumpGate, onJumpToCard),
    [jumpGate, onJumpToCard],
  );

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
      onActivateItem={keyboardJump}
      emptyState={
        <div className={PANEL.empty}>
          No archived text yet.
          <CreationHint action="archive" />
        </div>
      }
      renderCard={(s, { selected }) => {
        // Task 699: ONE gate answers the Jump door — the same verdict the
        // float and the margin read (task 966: the card does not re-gate).
        const gate = jumpGate(s);
        return (
        <ArchiveCard
          snippet={s}
          selected={selected}
          onSelect={onSelect}
          onEdit={onEdit}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onJump={onJumpToCard ? gate.withJump((sourceEl?: HTMLElement | null) => onJumpToCard(s, sourceEl)) : undefined}
          onEditorFocus={onEditorFocus}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
        );
      }}
    />
  );
}

export default memo(ArchivePanel);
