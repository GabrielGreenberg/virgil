"use client";

import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { FootnoteCard, OrphanedFootnoteCard } from "./FootnoteCard";

interface BuildArgs {
  footnotes: FootnoteInfo[];
  orphanedFootnotes: OrphanedFootnote[];
  selectedFootnoteId: string | null;
  setSelectedFootnoteId: (id: string | null) => void;
  scrollToFootnote: (id: string, sourceEl?: HTMLElement | null) => void;
  onEditFootnote: (id: string, json: JSONContent) => void;
  onDeleteFootnote: (id: string) => void;
  onEditFootnoteTitle: (id: string, title: string) => void;
  onEditOrphan: (id: string, json: JSONContent) => void;
  onDeleteOrphan: (id: string) => void;
  onEditOrphanTitle: (id: string, title: string) => void;
  setOverrideEditor: (editor: any) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

export function buildFootnoteOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const fn of a.footnotes) {
    const isSelected = a.selectedFootnoteId === fn.footnoteId;
    const id = popKey("footnotes", fn.footnoteId);
    items.push({
      id,
      pos: fn.pos,
      content: (
        <FootnoteCard
          key={id}
          footnote={fn}
          isSelected={isSelected}
          onSelect={() => a.setSelectedFootnoteId(fn.footnoteId)}
          onJump={(sourceEl) => a.scrollToFootnote(fn.footnoteId, sourceEl)}
          onEdit={(json) => a.onEditFootnote(fn.footnoteId, json)}
          onDelete={() => a.onDeleteFootnote(fn.footnoteId)}
          onEditTitle={(title) => a.onEditFootnoteTitle(fn.footnoteId, title)}
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": id }}
        />
      ),
    });
  }

  for (const orphan of a.orphanedFootnotes) {
    const isSelected = a.selectedFootnoteId === orphan.footnoteId;
    const id = popKey("footnotes", orphan.footnoteId);
    items.push({
      id,
      pos: null,
      content: (
        <OrphanedFootnoteCard
          key={id}
          orphan={orphan}
          isSelected={isSelected}
          onSelect={() => a.setSelectedFootnoteId(orphan.footnoteId)}
          onEdit={(json) => a.onEditOrphan(orphan.footnoteId, json)}
          onDelete={() => a.onDeleteOrphan(orphan.footnoteId)}
          onEditTitle={(title) => a.onEditOrphanTitle(orphan.footnoteId, title)}
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": id }}
        />
      ),
    });
  }

  return items;
}
