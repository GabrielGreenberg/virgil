"use client";

/**
 * The card an open reading-list row turns into — the kind's OWN card, with the
 * same handlers the old docked panels gave it (FootnotesHost, ExamplesHost,
 * BibliographyPanel), so opening a row in the gutter is the old panel's card,
 * in place. EditorPane supplies the stores; this file only routes a
 * `GutterCardRef` to the right card.
 */

import { useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, FootnoteRef, OrphanedFootnote } from "@/lib/types";
import type { SaveBibEntry } from "@/hooks/useCitations";
import type { RequestBibReview } from "@/hooks/useBibReview";
import BibEntryCard from "@/components/BibEntryCard";
import { LibraryStatusRow } from "@/components/library/library-entry-status";
import { useLibraryItems } from "@/hooks/useLibrary";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
  UnanchoredFootnoteCard,
} from "@/panels/Footnotes/FootnoteCard";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import type { GutterCardRef } from "./gutter-lists";

export interface GutterCardBodyProps {
  card: GutterCardRef;
  footnotes: readonly FootnoteInfo[];
  orphanedFootnotes: readonly OrphanedFootnote[];
  unanchoredFootnotes: readonly FootnoteRef[];
  examples: readonly ExampleInfo[];
  bibEntries: readonly BibEntry[];
  citedKeys: ReadonlySet<string>;
  onEditFootnote: (id: string, json: JSONContent) => void;
  onEditFootnoteTitle: (id: string, title: string) => void;
  onDeleteFootnote: (id: string) => void;
  onDeleteUnanchoredFootnote?: (id: string) => void;
  onEditOrphan: (id: string, content: unknown) => void;
  onEditOrphanTitle: (id: string, title: string) => void;
  onDeleteOrphan: (id: string) => void;
  footnoteAiRequests?: Record<string, boolean>;
  onSetFootnoteAiRequest?: (id: string, value: boolean) => void;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  requestBibReview: RequestBibReview;
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  getBibReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  getBibReviewNotes?: (bibKey: string, type: "fields" | "notes") => string | undefined;
  saveBibEntry: SaveBibEntry;
  /** ↗ on a bibliography card: the entry's first citation. */
  onJumpToBibKey: (key: string, sourceEl: HTMLElement | null) => void;
}

export function GutterCardBody(p: GutterCardBodyProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
  const sel = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  const { items: libraryItems } = useLibraryItems();
  const libItem = useMemo(
    () => (p.card.kind === "bib" ? libraryItems.find((i) => i.citekey === (p.card as { key: string }).key) : undefined),
    [libraryItems, p.card],
  );
  const c = p.card;

  switch (c.kind) {
    case "footnote": {
      const fn = p.footnotes.find((f) => f.footnoteId === c.id);
      if (!fn) return null;
      return (
        <FootnoteCard
          footnote={fn}
          isSelected
          onSelect={() => sel.setSelectedFootnoteId(fn.footnoteId)}
          onJump={(el) => editorRef.current?.scrollToFootnote(fn.footnoteId, el)}
          onEdit={(json) => p.onEditFootnote(fn.footnoteId, json)}
          onDelete={() => p.onDeleteFootnote(fn.footnoteId)}
          onEditTitle={(title) => p.onEditFootnoteTitle(fn.footnoteId, title)}
          onEditorFocus={setOverrideEditor}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
          aiRequest={!!p.footnoteAiRequests?.[fn.footnoteId]}
          onSetAiRequest={
            p.onSetFootnoteAiRequest ? (v) => p.onSetFootnoteAiRequest!(fn.footnoteId, v) : undefined
          }
        />
      );
    }
    case "orphan": {
      const o = p.orphanedFootnotes.find((x) => x.footnoteId === c.id);
      if (!o) return null;
      return (
        <OrphanedFootnoteCard
          orphan={o}
          isSelected
          onSelect={() => sel.setSelectedFootnoteId(o.footnoteId)}
          onEdit={(json) => p.onEditOrphan(o.footnoteId, json)}
          onDelete={() => p.onDeleteOrphan(o.footnoteId)}
          onEditTitle={(title) => p.onEditOrphanTitle(o.footnoteId, title)}
          onEditorFocus={setOverrideEditor}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
      );
    }
    case "footnote-ref": {
      const r = p.unanchoredFootnotes.find((x) => x.id === c.id);
      if (!r) return null;
      return (
        <UnanchoredFootnoteCard
          footnote={r}
          isSelected
          onSelect={() => sel.setSelectedFootnoteId(r.id)}
          onEdit={(json) => p.onEditFootnote(r.id, json)}
          onEditTitle={(title) => p.onEditFootnoteTitle(r.id, title)}
          onDelete={() => p.onDeleteUnanchoredFootnote?.(r.id)}
          onEditorFocus={setOverrideEditor}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={onCitationCreated}
        />
      );
    }
    case "example": {
      const ex = p.examples.find((e) => e.exampleId === c.id);
      if (!ex) return null;
      return (
        <ExampleCard
          example={ex}
          isSelected
          onSelect={() => sel.setSelectedExampleId(ex.exampleId)}
          onJump={(el) => editorRef.current?.scrollToExample(ex.exampleId, el)}
        />
      );
    }
    case "bib": {
      const entry = p.bibEntries.find((e) => e.key === c.key);
      if (!entry) return null;
      const cited = p.citedKeys.has(entry.key);
      return (
        <BibEntryCard
          section={c.section}
          entry={entry}
          // Open = expanded: a bibliography card shows its body while selected.
          isSelected
          onClick={() => sel.setSelectedBibKey(entry.key)}
          onSelect={() => sel.setSelectedBibKey(entry.key)}
          onJump={cited ? (el) => p.onJumpToBibKey(entry.key, el) : undefined}
          getAnnotation={p.getAnnotation}
          setAnnotation={p.setAnnotation}
          onRequestReview={p.requestBibReview}
          onCancelReview={p.cancelBibReview}
          getReviewStatus={p.getBibReviewStatus}
          getReviewNotes={p.getBibReviewNotes}
          onSaveBibEntry={p.saveBibEntry}
          bibEntries={p.bibEntries as BibEntry[]}
          isCited={cited}
          headerMeta={
            <LibraryStatusRow
              indexTier={libItem?.indexTier}
              bibState={libItem?.bibState}
              citekey={entry.key}
              inLibrary={!!libItem}
            />
          }
        />
      );
    }
  }
}
