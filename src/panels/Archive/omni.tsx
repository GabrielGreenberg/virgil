"use client";

import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { ArchiveCard } from "./ArchiveCard";
import { getLinkedTextObjectIds } from "@/links/links";
import { resolveAnchorState } from "@/links/anchor-state";

interface BuildArgs {
  archiveSnippets: ArchivedSnippet[];
  anchoredIds: Set<string> | undefined;
  selectedArchiveId: string | null;
  setSelectedArchiveId: (id: string | null) => void;
  jumpToCard: (card: ArchivedSnippet, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  updateArchiveSnippet: (id: string, content: JSONContent) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  handleDeleteArchive: (id: string) => void;
  setOverrideEditor: (editor: any) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

export function buildArchiveOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const snippet of a.archiveSnippets) {
    const orphaned = a.anchoredIds && !a.anchoredIds.has(snippet.id);
    const isSelected = a.selectedArchiveId === snippet.id;
    const pids = getLinkedTextObjectIds(snippet);
    const baseId = popKey("archive", snippet.id);

    if (orphaned || pids.length === 0) {
      items.push({
        id: baseId,
        pos: null,
        // `orphaned` ⇒ had an anchor that vanished; otherwise it simply
        // carries no link at all — a deliberately-free card. Modelled as the
        // SSOT's `unanchored` intent so the free-vs-orphaned split lives in
        // `resolveAnchorState`, not an inline literal.
        anchorState: resolveAnchorState(null, { unanchored: !orphaned }),
        content: (
          <ArchiveCard
            key={baseId}
            snippet={snippet}
            selected={isSelected}
            orphaned={orphaned}
            onSelect={a.setSelectedArchiveId}
            onEdit={(id, content) => a.updateArchiveSnippet(id, content)}
            onUpdateTitle={a.updateArchiveSnippetTitle}
            onDelete={a.handleDeleteArchive}
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
          anchorUuid: pid,
          // Linked to a paragraph — no free intent: resolved pos ⇒ anchored,
          // lost pos ⇒ orphaned.
          anchorState: resolveAnchorState(pos, null),
          content: (
            <ArchiveCard
              key={omniId}
              snippet={snippet}
              selected={isSelected}
              onSelect={a.setSelectedArchiveId}
              onEdit={(id, content) => a.updateArchiveSnippet(id, content)}
              onUpdateTitle={a.updateArchiveSnippetTitle}
              onDelete={a.handleDeleteArchive}
              onJump={(sourceEl) => a.jumpToCard(snippet, sourceEl)}
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
