"use client";

import type { JSONContent } from "@tiptap/react";
import type { ArchivedSnippet } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { ArchiveCard } from "./ArchiveCard";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";

interface BuildArgs {
  archiveSnippets: ArchivedSnippet[];
  selectedArchiveId: string | null;
  setSelectedArchiveId: (id: string | null) => void;
  jumpToCard: (card: ArchivedSnippet, sourceEl?: HTMLElement | null) => void;
  resolveCardRows: CardAnchorResolver;
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
    const isSelected = a.selectedArchiveId === snippet.id;
    const baseId = popKey("archive", snippet.id);

    // ONE authority for "where is this clip anchored?" — the same rows the
    // margin marker builder draws from (task 369). This is the REPORTED
    // instance of the class: an archive link is created WITH a
    // `paragraphSnapshot`, so the resolver's snapshot rung is armed for every
    // clip — and the retired `anchoredIds` gate (a bare `pids.some(live)`)
    // could not see it, so a clip the margin RECOVERED was binned into the
    // orphan strip with its marker still painted beside the live paragraph.
    //
    // Free-vs-orphaned still splits on the clip's OWN recorded intent
    // (`unanchored`, set at born-free creation) — not a link-presence proxy
    // (task 104, Defect A) — and stays inside `resolveAnchorState` (SSOT).
    for (const row of buildOmniAnchorRows(snippet, baseId, a.resolveCardRows, {
      unanchored: !!snippet.unanchored,
    })) {
      items.push({
        id: row.omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: (
          <ArchiveCard
            key={row.omniId}
            snippet={snippet}
            selected={isSelected}
            orphaned={row.anchorState === "orphaned"}
            onSelect={a.setSelectedArchiveId}
            onEdit={(id, content) => a.updateArchiveSnippet(id, content)}
            onUpdateTitle={a.updateArchiveSnippetTitle}
            onDelete={a.handleDeleteArchive}
            onJump={
              row.anchored ? (sourceEl) => a.jumpToCard(snippet, sourceEl) : undefined
            }
            onEditorFocus={a.setOverrideEditor}
            getCitationDisplayText={a.getCitationDisplayText}
            onCitationCreated={a.onCitationCreated}
            extraDataAttrs={{ "data-omni-entry": row.omniId }}
          />
        ),
      });
    }
  }

  return items;
}
