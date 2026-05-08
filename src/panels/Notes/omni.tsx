"use client";

import type { JSONContent } from "@tiptap/react";
import type { UserNote } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { NoteCard } from "./NoteCard";
import { getLinkedParagraphIds } from "@/links/links";

interface BuildArgs {
  notes: UserNote[];
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  jumpToCard: (card: UserNote, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  updateNote: (id: string, content: JSONContent) => void;
  updateNoteTitle: (id: string, title: string) => void;
  setNoteAiRequest: (id: string, value: boolean) => void;
  deleteNote: (id: string) => void;
  setOverrideEditor: (editor: any) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

export function buildNoteOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const note of a.notes) {
    const pids = getLinkedParagraphIds(note);
    const isSelected = a.selectedNoteId === note.id;
    const baseId = popKey("notes", note.id);

    if (pids.length === 0) {
      items.push({
        id: baseId,
        pos: null,
        content: (
          <NoteCard
            key={baseId}
            note={note}
            selected={isSelected}
            onUpdate={a.updateNote}
            onUpdateTitle={a.updateNoteTitle}
            onSetAiRequest={a.setNoteAiRequest}
            onDelete={a.deleteNote}
            onSelect={a.setSelectedNoteId}
            onEditorFocus={a.setOverrideEditor}
            getCitationDisplayText={a.getCitationDisplayText}
            onCitationCreated={a.onCitationCreated}
            extraDataAttrs={{ "data-omni-entry": baseId }}
          />
        ),
      });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({
          id: omniId,
          pos,
          content: (
            <NoteCard
              key={omniId}
              note={note}
              selected={isSelected}
              onUpdate={a.updateNote}
              onUpdateTitle={a.updateNoteTitle}
              onSetAiRequest={a.setNoteAiRequest}
              onDelete={a.deleteNote}
              onSelect={a.setSelectedNoteId}
              onJump={(sourceEl) => a.jumpToCard(note, sourceEl)}
              onEditorFocus={a.setOverrideEditor}
              getCitationDisplayText={a.getCitationDisplayText}
              onCitationCreated={a.onCitationCreated}
              extraDataAttrs={{ "data-omni-entry": omniId }}
            />
          ),
        });
      }
    }
  }

  return items;
}
