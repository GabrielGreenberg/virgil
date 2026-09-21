/**
 * **slice-capture — a range of the live document as card-body JSON.**
 *
 * This is the ONE conversion, in a LEAF, and it OWNS THE CUT: a caller hands
 * it the document and a range, never a `Slice` it built itself — because which
 * slice is taken is the whole of what went wrong (task 563).
 *
 * ## The cut brings the parents along
 *
 * `doc.slice(from, to)` cuts at the SHARED-DEPTH node. For a selection inside
 * one paragraph its top-level children are INLINE; for a selection running
 * from the middle of one bullet item to the middle of the next they are two
 * `listItem`s — open at both ends, with no list around them. The pre-563 walk
 * knew two shapes (wrap inline runs in a paragraph, pass blocks through), so
 * the two items were pushed at DOC level: `{doc: [listItem, listItem]}`, a
 * model the card body's `block+` cannot hold. The vocabulary-only mount check
 * passed it, the delete ran, the archive card mounted it INVALID (it rendered,
 * and the first keystroke threw `contentMatchAt on a node with invalid
 * content`), and a restore handed the fitter two orphan items to WRAP — a
 * phantom list where two items of the user's list used to be; two `exampleItem`s
 * became a fresh numbered example, two `glossCell`s an orphan `\begingl` at top
 * level. Same root, second symptom: a partial selection inside a `codeBlock` or
 * a `latexComment` yielded inline text, which the paragraph wrap turned into
 * PROSE — so `% parked old prose` typeset on restore.
 *
 * "What a system does not model, it CARRIES" (tasks 342/347/349), read at the
 * capture: the slice was discarding the ANCESTORS that gave the selected bytes
 * their meaning. So the cut is `doc.slice(from, to, true)` — `includeParents`,
 * the precedent `useSelectionCounts` records as load-bearing — whose top-level
 * children are always real document blocks, cut: a selection inside one
 * paragraph is `paragraph(text)`; across two items `bulletList(listItem,
 * listItem)`; inside a comment `latexComment(text)`.
 *
 * ## An OPEN node is a fragment of a node that SURVIVES
 *
 * The ancestors the range only partly covers arrive OPEN, and task 320's law
 * applies to a copy exactly as to a move: the surviving node keeps its
 * identity, so the fragment is a FRESH presence. Along each open chain the
 * attrs {@link cutFreshAttrs} names are cleared — `uuid` / `parTitle` /
 * `label`, and whatever a split leaves behind (`itemLabel`, `listOptions`,
 * `shortTitle`). A block the range covers WHOLE keeps its identity: it is
 * leaving the document, and a restore re-establishes it, exactly as before.
 * This also keeps today's single-paragraph bytes — a fresh, attr-less
 * paragraph — while fixing both symptoms above with one rule.
 *
 * ## …and an open node is CLOSED the way ProseMirror closes one
 *
 * A cut can leave an open node's content invalid on its own — an item whose
 * range starts inside a NESTED list begins with a `bulletList`, and an expex
 * item cut across its gloss holds only the gloss where the schema requires a
 * leading paragraph. ProseMirror's fitter would close exactly these on
 * restore, by filling the required leading content (`ContentMatch.fillBefore`,
 * which is what `closeNodeStart` in prosemirror-transform calls); doing it
 * here, on the same schema fact, is what lets the CARD hold the model. The
 * fill is DERIVED from the content expression — an empty paragraph, never a
 * guess — and a shape it cannot close is left as it is for the door's content
 * check to REFUSE.
 *
 * Two callers with very different weights:
 *
 *  - {@link prepareCardBodyCapture} — the DESTRUCTIVE capture door (task 393),
 *    which normalizes and then proves the destination schema can hold the
 *    result. It reaches the resolved card-body schema, and so the whole
 *    extension stack, which is exactly why it cannot live in the import graph
 *    of a module every card surface pulls in.
 *  - `createLinkedAnchor` (task 488) — a DISPLAY capture beside a Mode-B
 *    anchor. Nothing is being deleted, so there is nothing for a mount check to
 *    protect: a passage the render surface cannot represent already falls back
 *    to plain text by `StaticBorrowedText`'s own refusal contract. It wants the
 *    shape conversion and the normalize, and must NOT drag the schema into
 *    `links.ts`.
 *
 * So the leaf publishes the whole small operation (cut + freshen + close +
 * normalize), never its halves — `prepareCardBodyCapture` reads it too, so the
 * payload the destructive door VALIDATES is byte-identical to the one this
 * produces.
 */
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { normalizeRichContent } from "@/lib/footnote-content";
import { serializeParagraphInline } from "@/lib/latex-serializer";
import { cutFreshAttrs } from "@/lib/node-attr-sets";

/** A range of a live document — the capture shape. The leaf takes the cut. */
export interface DocRange {
  doc: PMNode;
  from: number;
  to: number;
}

/** Narrow without importing pm/model at the call site. */
export function isDocRange(v: unknown): v is DocRange {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<DocRange>;
  return (
    typeof r.from === "number" &&
    typeof r.to === "number" &&
    !!r.doc &&
    typeof (r.doc as PMNode).resolve === "function"
  );
}

/**
 * The card-body `doc` JSON for a range of the live document.
 *
 * `to <= from` (an empty or inverted range) captures an EMPTY document, which
 * the destructive door then refuses (a `block+` body holds nothing) and the
 * display capture never asks about (`createLinkedAnchor` returns null first).
 * An inverted range is not swapped: it is a caller's bug, and answering it
 * with a capture would hide one.
 */
export function captureRangeContent(doc: PMNode, from: number, to: number): JSONContent {
  const content = cutRange(doc, from, to);
  return normalizeRichContent({
    type: "doc",
    content: content ? (content.toJSON() as JSONContent[]) : [],
  });
}

/**
 * The THIRD derived form of the same capture (task 696): the span's inline
 * **LaTeX**, or `null` when the span has no single inline form.
 *
 * A captured passage is ONE cut read in three dialects, and each door consumes
 * a different one:
 *
 *  - **plain** (`doc.textBetween`) — the RELOCATION currency, what a Mode-B
 *    anchor is re-found by on reload. Lossy by design and must stay so.
 *  - **rich** ({@link captureRangeContent}) — the DISPLAY form, what the
 *    "Original" surfaces mount so marks and inline atoms survive (task 488).
 *  - **LaTeX** (here) — the APPLY currency. `apply-suggestion.ts` serializes
 *    the anchored paragraph to inline LaTeX and requires the suggestion's
 *    `original_text` to appear in it VERBATIM. A flattened line cannot appear
 *    in a LaTeX serialization of the same span unless the span carried no
 *    markup at all, so seeding `original_text` from the plain form made every
 *    suggestion over an emphasis / citation / footnote / `$x$` land `stale`
 *    on first press — with the paragraph untouched and the card told it had
 *    changed (task 696).
 *
 * Deliberately taken from the RAW cut, BEFORE `normalizeRichContent` strips
 * `linkedAnchor`: the live paragraph's serialization emits `\vlid{id}` /
 * `\vlidend{id}` around any anchor inside the span, so keeping them is what
 * makes the needle a verbatim substring of the haystack. The capture's OWN
 * anchor is not in the cut — `createLinkedAnchor` captures before it marks —
 * and its markers sit OUTSIDE the span, so the needle still matches.
 *
 * `null` (never a guess) when the span is not exactly one paragraph — a
 * multi-block selection, a code block, a comment — or when the serializer
 * refuses a node it cannot express (`UnserializableNodeError`, task 357).
 * `locateSpan` only ever searches a single anchored paragraph, so a span with
 * no inline form has no apply currency, and answering with a lossy one is
 * exactly the defect this door exists to close.
 */
export function captureRangeLatex(doc: PMNode, from: number, to: number): string | null {
  const content = cutRange(doc, from, to);
  if (!content || content.childCount !== 1) return null;
  const only = content.firstChild!;
  if (only.type.name !== "paragraph") return null;
  try {
    return serializeParagraphInline(only.toJSON() as JSONContent);
  } catch {
    return null;
  }
}

/**
 * THE cut, taken once and read by every derived form above. Returns `null`
 * for an empty or inverted range (see {@link captureRangeContent}).
 */
function cutRange(doc: PMNode, from: number, to: number): Fragment | null {
  const lo = Math.max(0, from);
  const hi = Math.min(doc.content.size, to);
  if (hi <= lo) return null;
  const slice = doc.slice(lo, hi, true);
  let content = slice.content;
  if (content.childCount > 0) {
    content = content.replaceChild(
      0,
      closeStart(content.firstChild!, slice.openStart),
    );
    content = content.replaceChild(
      content.childCount - 1,
      closeEnd(content.lastChild!, slice.openEnd),
    );
  }
  return content;
}

/** A copy of `node` with every attr a cut leaves behind cleared to its
 *  default (`null` for all of them today). */
function freshen(node: PMNode): PMNode {
  const names = cutFreshAttrs(node.type.name);
  if (names.length === 0) return node;
  const attrs: Record<string, unknown> = { ...node.attrs };
  let changed = false;
  for (const name of names) {
    if (name in attrs && attrs[name] != null) {
      attrs[name] = null;
      changed = true;
    }
  }
  return changed ? node.type.create(attrs, node.content, node.marks) : node;
}

/**
 * Close an open START chain `depth` levels deep: freshen every open node and
 * fill whatever leading content its type requires before the cut child. A
 * chain the schema cannot close (`fillBefore` answers null) is returned as it
 * is — the door's content check is what refuses it.
 */
function closeStart(node: PMNode, depth: number): PMNode {
  if (depth <= 0 || node.isText || node.isLeaf) return node;
  let content = node.content;
  if (content.childCount > 0) {
    content = content.replaceChild(0, closeStart(content.firstChild!, depth - 1));
  }
  const fill = node.type.contentMatch.fillBefore(content);
  if (fill && fill.size > 0) content = fill.append(content);
  return freshen(node.copy(content));
}

/** The END twin: fill whatever trailing content the type requires after the
 *  cut child (`toEnd`), so a node cut before its required tail closes. */
function closeEnd(node: PMNode, depth: number): PMNode {
  if (depth <= 0 || node.isText || node.isLeaf) return node;
  let content = node.content;
  if (content.childCount > 0) {
    content = content.replaceChild(
      content.childCount - 1,
      closeEnd(content.lastChild!, depth - 1),
    );
  }
  const match = node.type.contentMatch.matchFragment(content);
  const fill = match ? match.fillBefore(Fragment.empty, true) : null;
  if (fill && fill.size > 0) content = content.append(fill);
  return freshen(node.copy(content));
}
