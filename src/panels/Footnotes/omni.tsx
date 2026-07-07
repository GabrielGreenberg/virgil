"use client";

import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote, FootnoteRef } from "@/lib/types";
import { popKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
  UnanchoredFootnoteCard,
} from "./FootnoteCard";

interface BuildArgs {
  footnotes: FootnoteInfo[];
  orphanedFootnotes: OrphanedFootnote[];
  /** Task 077: atomless footnote refs (archive-born `FootnoteRef`, no `\footnote`
   *  atom). The docked panel renders these as `UnanchoredFootnoteCard`; Omni must
   *  surface the ACTIVE (non-archived) ones too, else an unarchived unanchored
   *  footnote vanishes on the Active→Omni switch. Archived refs are filtered out
   *  in the loop below (parity with the docked Archives view + the omni-host
   *  `active()` filter). Optional — omitted by the contract-test harness for the
   *  anchored/orphan cases. */
  unanchoredFootnotes?: FootnoteRef[];
  onEditUnanchored?: (id: string, json: JSONContent) => void;
  onDeleteUnanchored?: (id: string) => void;
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
  /** BUG #55: per-footnote AI-request flags + toggle (optional; omitted by the
   *  contract test harness). */
  footnoteAiRequests?: Record<string, boolean>;
  onSetFootnoteAiRequest?: (id: string, value: boolean) => void;
}

export function buildFootnoteOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const fn of a.footnotes) {
    const isSelected = a.selectedFootnoteId === fn.footnoteId;
    const id = popKey("footnotes", fn.footnoteId);
    items.push({
      id,
      pos: fn.pos,
      // A live footnote always resolves to its in-text marker pos.
      anchorState: "anchored",
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
          aiRequest={!!a.footnoteAiRequests?.[fn.footnoteId]}
          onSetAiRequest={
            a.onSetFootnoteAiRequest
              ? (value) => a.onSetFootnoteAiRequest!(fn.footnoteId, value)
              : undefined
          }
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
      // Orphaned footnotes carry a \footnote{} that lost its callout —
      // they intend to anchor but have no resolvable in-text marker.
      anchorState: "orphaned",
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

  // Task 077: atomless footnote refs (archive-born `FootnoteRef`) — the third
  // card kind the docked panel renders (`UnanchoredFootnoteCard`). An unarchive
  // clears `archived` but leaves `unanchored` (the `\footnote` atom is NOT
  // re-inserted), manufacturing an ACTIVE unanchored ref that renders in the
  // docked Active view. Surface those here so switching to Omni doesn't drop the
  // card on the floor. Archived refs are excluded (parity with the docked
  // Archives view + the omni-host `active()` filter) — filtered in the builder so
  // the contract test can exercise the archived-excluded case directly.
  for (const ref of a.unanchoredFootnotes ?? []) {
    if (ref.archived) continue;
    const isSelected = a.selectedFootnoteId === ref.id;
    const id = popKey("footnotes", ref.id);
    items.push({
      id,
      pos: null,
      // anchorState "orphaned" (not "free"): behavior-consistent with the current
      // pinned contract — the sibling Citations unanchored ref surfaces as
      // "orphaned" today (A5 test). Task 056, if adopted, flips citation AND
      // footnote unanchored refs to "free" in one `resolveAnchorState(pos, {
      // unanchored })` pass — do NOT pre-empt that decision here.
      anchorState: "orphaned",
      content: (
        <UnanchoredFootnoteCard
          key={id}
          footnote={ref}
          isSelected={isSelected}
          onSelect={() => a.setSelectedFootnoteId(ref.id)}
          onEdit={(json) => a.onEditUnanchored?.(ref.id, json)}
          onDelete={() => a.onDeleteUnanchored?.(ref.id)}
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
