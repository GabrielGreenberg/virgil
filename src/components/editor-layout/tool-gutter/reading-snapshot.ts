/**
 * The reading lists' ONE positions snapshot (task 1570).
 *
 * A position means something only against the doc it was read from. The lists
 * used to take headings from one read, footnote / citation / example positions
 * from the pane's own reads (each refreshed on its own revision counter), and
 * resolve all of them against the LIVE doc — so typing above a footnote filed it
 * under the previous section, and deleting text above a late citation handed the
 * bibliography's "Cited in" line a position past the end of the doc.
 *
 * Here every position the lists use comes from ONE `readDocStructure(state)`
 * read, paired with the `state.doc` it describes. The pane's rows keep their
 * identity and content; their `pos` is re-read from the snapshot by id, and a
 * row the snapshot does not hold (already gone from the doc) is dropped. The
 * caller re-reads at structural pace only — never per keystroke — which is
 * enough: plain typing shifts positions but cannot reorder a row against a
 * heading, so the snapshot's section filing stays right until the next
 * structural change, and its doc is self-consistent until then.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import { readDocStructure } from "@/lib/tiptap/doc-structure";
import { topSections, type GutterCitation, type GutterSectionHead } from "./gutter-lists";

export interface ReadingSnapshot {
  /** The doc every position below was read from. */
  doc: PMNode;
  sections: GutterSectionHead[];
  footnotes: FootnoteInfo[];
  examples: ExampleInfo[];
  citations: GutterCitation[];
}

type SnapshotState = Parameters<typeof readDocStructure>[0] & { doc: PMNode };

/** Re-read `items`' positions from `posOf` by id; drop what it lacks. */
function rebase<T extends { pos: number }>(
  items: readonly T[],
  idOf: (t: T) => string,
  posOf: ReadonlyMap<string, number>,
): T[] {
  const out: T[] = [];
  for (const t of items) {
    const pos = posOf.get(idOf(t));
    if (pos == null) continue;
    out.push(pos === t.pos ? t : { ...t, pos });
  }
  return out;
}

export function readReadingSnapshot(
  state: SnapshotState,
  rows: {
    footnotes: readonly FootnoteInfo[];
    examples: readonly ExampleInfo[];
    citations: readonly GutterCitation[];
  },
): ReadingSnapshot {
  const structure = readDocStructure(state);
  const doc = state.doc;
  const fnPos = new Map(structure.footnotes.map((f) => [f.id, f.pos]));
  const exPos = new Map<string, number>();
  for (const e of structure.examples) if (e.uuid) exPos.set(e.uuid, e.pos);
  const citePos = new Map(structure.citations.map((c) => [c.id, c.pos]));
  return {
    doc,
    sections: topSections(structure.headings, (pos) => doc.nodeAt(pos)?.textContent ?? ""),
    footnotes: rebase(rows.footnotes, (f) => f.footnoteId, fnPos),
    examples: rebase(rows.examples, (e) => e.exampleId, exPos),
    citations: rebase(rows.citations, (c) => c.citationId, citePos),
  };
}
