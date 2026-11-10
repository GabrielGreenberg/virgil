/**
 * Dragging a bibliography entry into the text as `\cite{key}` — one drag
 * payload for every surface that offers it (the bib card, the tool gutter's
 * bibliography rows), so the editor's drop path and the citation cards' merge
 * rings read the same thing wherever the drag started.
 */

import type { DragEvent } from "react";
import type { BibEntry } from "@/lib/types";
import { formatMinimalCitation } from "@/lib/bib-parser";
import { MIME_CITATION, MIME_BIB_MERGE } from "@/lib/marginalia";
import { attachClampedDragGhost, buildTextDragGhost } from "@/lib/drag-ghost";

export function startBibEntryDrag(
  e: DragEvent,
  entry: BibEntry,
  bibEntries?: readonly BibEntry[],
): void {
  const cmd = `\\cite{${entry.key}}`;
  const display = bibEntries ? formatMinimalCitation(entry.key, bibEntries as BibEntry[]) : entry.key;
  e.dataTransfer.setData("text/plain", cmd);
  e.dataTransfer.setData(MIME_CITATION, JSON.stringify({ command: cmd, bibKey: entry.key }));
  // Also advertise the card-merge discriminator so a CitationCard's drop ring
  // lights ONLY for a bib-entry drag (which merges), never for another
  // citation card's atom-move drag (MIME_CITATION alone). `dragover` can read
  // `types` but not `getData`, so the distinct type is the only signal the
  // ring can predict the drop from. See MIME_BIB_MERGE in marginalia.ts.
  e.dataTransfer.setData(MIME_BIB_MERGE, JSON.stringify({ bibKey: entry.key }));
  // "copyMove", not "copy": the editor drop surface shows a "move" affordance
  // (Editor.tsx dragover); the card/panel merge targets still take "copy".
  e.dataTransfer.effectAllowed = "copyMove";
  attachClampedDragGhost({
    dragStartEvent: e,
    buildGhost: () =>
      // Citation cream via tokens — one home with CitationCard's ghost.
      buildTextDragGhost(display, {
        maxChars: 80,
        bg: "var(--citation-ghost-bg, #fdf8e1)",
        border: "var(--citation-border-color)",
        ink: "var(--citation-color)",
      }),
    cursorOffsetX: 10,
    cursorOffsetY: 14,
  });
}
