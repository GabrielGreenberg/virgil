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
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import type { CarriedMarkRecord } from "@/lib/types";
import type { JSONContent } from "@tiptap/react";
import { normalizeRichContent } from "@/lib/footnote-content";
import { serializeBodyOnly, serializeParagraphInline } from "@/lib/latex-serializer";
import { VIRGIL_MARKER_COMMANDS } from "@/lib/latex-markers";
import { NODE_UUID_REGEX, generateShortId } from "@/lib/uuid";
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
 * The CARRIED-MARK record of the same cut (task 1194): every contiguous run of
 * a `linkedAnchor` mark in `anchorIds`, at its position INSIDE the captured
 * content. The content ({@link captureRangeContent}) is this very cut with
 * `DOC_ONLY_MARKS` stripped — a mark strip, never a structural change — so a
 * position here is a position in the stored `content`, and nothing can drift
 * between the two: they are read off one fragment of one document.
 */
export function captureCarriedMarks(
  doc: PMNode,
  from: number,
  to: number,
  anchorIds: ReadonlySet<string>,
): CarriedMarkRecord[] {
  if (anchorIds.size === 0) return [];
  const content = cutRange(doc, from, to);
  if (!content) return [];
  const runs: CarriedMarkRecord[] = [];
  const open = new Map<string, CarriedMarkRecord>();
  content.descendants((node, pos) => {
    if (!node.isInline) return true;
    const end = pos + node.nodeSize;
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const id = mark.attrs.anchorId;
      if (typeof id !== "string" || !anchorIds.has(id)) continue;
      const run = open.get(id);
      if (run && run.to === pos) {
        run.to = end;
        continue;
      }
      const fresh: CarriedMarkRecord = { anchorId: id, attrs: { ...mark.attrs }, from: pos, to: end };
      open.set(id, fresh);
      runs.push(fresh);
    }
    return false;
  });
  // The run's IDENTITY is its words (task 1269), read once the run is whole.
  for (const run of runs) run.text = runText(content, run.from, run.to);
  return runs;
}

/** The ONE reading of a carried run's words — capture and Restore must agree
 *  on it, leaves included (an inline atom reads as one U+FFFC, its size). */
function runText(node: PMNode | Fragment, from: number, to: number): string {
  return node.textBetween(from, to, "\n", "\ufffc");
}

/**
 * Where a carried run lands in (possibly edited) `content` (task 1269). The
 * record's offsets are a capture-time HINT: the archive body is editable
 * (`useArchive.updateSnippet` replaces `content`), so they may now point at
 * other words. The run is placed on its own words — at its offsets when they
 * still read `text`, else at the ONE place in a single textblock that does
 * (an edit elsewhere in the body shifts it; the mark rides along). Nowhere,
 * or more than one place, is `null`: the run is skipped and its card stays
 * dormant — never stamped on different words. A pre-1269 record (no `text`)
 * is trusted at its offsets, bounds-checked.
 */
function locateRun(
  node: PMNode,
  m: CarriedMarkRecord,
): { from: number; to: number } | null {
  const size = node.content.size;
  const fits = m.from >= 0 && m.to <= size && m.to > m.from;
  if (m.text === undefined) return fits ? { from: m.from, to: m.to } : null;
  if (!m.text) return null;
  if (fits && runText(node, m.from, m.to) === m.text) return { from: m.from, to: m.to };
  let hit: { from: number; to: number } | null = null;
  let count = 0;
  node.descendants((block, pos) => {
    if (count > 1) return false;
    if (!block.isTextblock) return true;
    const start = pos + 1;
    const line = runText(block, 0, block.content.size);
    for (let i = line.indexOf(m.text!); i >= 0; i = line.indexOf(m.text!, i + 1)) {
      // A char offset is a position offset only while every inline before it
      // is text or a size-1 leaf — confirm on the node, never assume.
      const from = start + i;
      const to = from + m.text!.length;
      if (to > size || runText(node, from, to) !== m.text) continue;
      if (++count > 1) return false;
      hit = { from, to };
    }
    return false;
  });
  return count === 1 ? hit : null;
}

/**
 * Restore's half (task 1194): the excerpt `content` with its carried
 * `linkedAnchor` runs stamped back on, in the LIVE document's schema — so the
 * marks land in the very transaction that lands the text, wherever it lands.
 * Each run is placed on the WORDS it covered at capture ({@link locateRun},
 * task 1269): an edit to the archive body elsewhere carries the mark along;
 * an edit that changed or duplicated those words skips the run, and its card
 * simply stays dormant. A run is never stamped on different words.
 *
 * The anchorIds go on VERBATIM; a collision with a live mark (doc Undo
 * revived the original, then this snippet is restored too) is answered by
 * the one identity pass that runs after this, {@link freshenReturningIdentities}.
 */
export function withCarriedMarks(
  schema: Schema,
  content: JSONContent,
  marks: readonly CarriedMarkRecord[] | undefined,
): JSONContent {
  const type = schema.marks.linkedAnchor;
  if (!marks?.length || !type) return content;
  let node: PMNode;
  try {
    node = schema.nodeFromJSON(content);
  } catch {
    return content;
  }
  const tr = new Transform(node);
  for (const m of marks) {
    // Located against the UNMARKED content: adding a mark moves no position.
    const at = locateRun(node, m);
    if (!at) continue;
    try {
      tr.addMark(at.from, at.to, type.create({ ...m.attrs, anchorId: m.anchorId }));
    } catch {
      continue;
    }
  }
  return tr.docChanged ? (tr.doc.toJSON() as JSONContent) : content;
}

/** The identities already live in the document a restore lands in. */
export interface LiveIdentities {
  uuids: ReadonlySet<string>;
  anchorIds: ReadonlySet<string>;
}

/** Old → fresh, per identity space — the ONE answer a restore hands every
 *  card it carries (displaced, dormant Mode A, dormant Mode B). */
export interface IdentityRemap {
  uuids: ReadonlyMap<string, string>;
  anchorIds: ReadonlyMap<string, string>;
}

export const NO_IDENTITY_REMAP: IdentityRemap = { uuids: new Map(), anchorIds: new Map() };

export function isEmptyRemap(r: IdentityRemap): boolean {
  return r.uuids.size === 0 && r.anchorIds.size === 0;
}

/**
 * Restore's COLLISION answer (task 1194 → 1269): the excerpt with every
 * identity that is already LIVE replaced by a fresh one, and the old → new
 * maps. Two identity spaces, one pass:
 *
 *  - a block `uuid` — left to itself `BlockUuidBackfill` would re-mint such a
 *    newcomer anyway (keeping the pre-existing block's identity — the right
 *    tie-break for a paste-as-new); the landing does it FIRST so it knows the
 *    new id, and the cards that went dormant on the old one can follow it;
 *  - a `linkedAnchor` `anchorId` (the carried marks, stamped on by
 *    {@link withCarriedMarks} before this runs) — nothing re-mints a
 *    duplicate mark id, so without this a restore after a doc Undo of the
 *    archive left two runs sharing one id and a Mode-B card resolved to
 *    whichever came first. Paste strips the mark for the same reason; Restore
 *    keeps it and freshens it instead. A `linkId` that mirrored the old
 *    anchorId follows it.
 *
 * Both maps go to `reviveRemapped` (via each hook's `returnRemapped`). A
 * content with no collision is returned as-is with empty maps.
 */
export function freshenReturningIdentities(
  content: JSONContent,
  live: LiveIdentities,
): { content: JSONContent; remap: IdentityRemap } {
  const uuids = new Map<string, string>();
  const anchorIds = new Map<string, string>();
  const takenUuids = new Set<string>(live.uuids);
  const takenAnchors = new Set<string>(live.anchorIds);
  const freshAnchor = (old: string): string => {
    let id = anchorIds.get(old);
    if (!id) {
      id = generateShortId(takenAnchors);
      takenAnchors.add(id);
      anchorIds.set(old, id);
    }
    return id;
  };
  const visit = (node: JSONContent): JSONContent => {
    const uuid = (node.attrs as { uuid?: unknown } | undefined)?.uuid;
    let next = node;
    if (typeof uuid === "string" && uuid && live.uuids.has(uuid)) {
      let fresh = uuids.get(uuid);
      if (!fresh) {
        fresh = generateShortId(takenUuids);
        takenUuids.add(fresh);
        uuids.set(uuid, fresh);
      }
      next = { ...node, attrs: { ...node.attrs, uuid: fresh } };
    }
    if (node.marks?.length) {
      let touched = false;
      const marks = node.marks.map((m) => {
        const a = m.type === "linkedAnchor" ? (m.attrs as { anchorId?: unknown } | undefined)?.anchorId : null;
        if (typeof a !== "string" || !a || !live.anchorIds.has(a)) return m;
        touched = true;
        const id = freshAnchor(a);
        const linkId = (m.attrs as { linkId?: unknown }).linkId;
        return { ...m, attrs: { ...m.attrs, anchorId: id, ...(linkId === a ? { linkId: id } : {}) } };
      });
      if (touched) next = { ...next, marks };
    }
    if (node.content?.length) {
      const kids = node.content.map(visit);
      if (kids.some((k, i) => k !== node.content![i])) next = { ...next, content: kids };
    }
    return next;
  };
  const out = visit(content);
  return { content: out, remap: { uuids, anchorIds } };
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
 * The LaTeX dialect of a range as SOURCE — what a WRAP into a raw-TeX block
 * holds (task 848), or `null` when the range has no honest source form.
 *
 * {@link captureRangeLatex} is the APPLY currency: one paragraph, markers
 * kept, because it must be a verbatim substring of the live serialization.
 * This is the other reading of the same cut — "turn this span into its
 * source" (`\tex` over a selection) — so it differs in exactly the two ways
 * that job demands:
 *
 *  - **any number of blocks.** Each cut block serializes through the real
 *    body serializer, joined as the `.tex` joins them (a blank line between
 *    paragraphs), so `see *this*` becomes `see \textit{this}` and a span
 *    across two paragraphs stays two paragraphs of source.
 *  - **no private bytes.** Block identity is not source: every `uuid` is
 *    cleared before serializing, so no ` %!v:xxxx` trailer is written into
 *    the user's TeX. And an inline id marker (`\vlid` / `\vcid` / `\vfid`,
 *    or any other command in the marker vocabulary) means the span carries
 *    card IDENTITY a raw-TeX block cannot hold — the answer is `null`, never
 *    the marker bytes leaking into `code` and never a silent strip. (The WRAP
 *    predicate, `sliceIsFullyCapturedBy(…, "latex")`, refuses those shapes
 *    first; this is the capture's own fail-closed floor beneath it.)
 *
 * Also `null` for an empty range or a node the serializer cannot express
 * (`UnserializableNodeError`, task 357).
 */
export function captureRangeLatexSource(
  doc: PMNode,
  from: number,
  to: number,
): string | null {
  const content = cutRange(doc, from, to);
  if (!content || content.childCount === 0) return null;
  const blocks: JSONContent[] = [];
  content.forEach((block) => {
    blocks.push(withoutBlockUuids(block.toJSON() as JSONContent));
  });
  let source: string;
  try {
    source = serializeBodyOnly({ type: "doc", content: blocks });
  } catch {
    return null;
  }
  if (carriesPrivateMarker(source)) return null;
  return source;
}

/** Every Virgil marker command (derived from the vocabulary SSOT), plus the
 *  block-uuid anchor (`%!v:xxxx`, `NODE_UUID_REGEX`). Longest-first so
 *  `\vlidend` is tried before `\vlid`. */
const PRIVATE_MARKER_REGEX = new RegExp(
  `\\\\(?:${[...VIRGIL_MARKER_COMMANDS]
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b|${NODE_UUID_REGEX.source}`,
);

function carriesPrivateMarker(source: string): boolean {
  return PRIVATE_MARKER_REGEX.test(source);
}

/** A deep copy of `json` with every `uuid` attr cleared — block identity is
 *  bookkeeping, not source. */
function withoutBlockUuids(json: JSONContent): JSONContent {
  const out: JSONContent = { ...json };
  if (json.attrs && json.attrs.uuid != null) {
    out.attrs = { ...json.attrs, uuid: null };
  }
  if (json.content) out.content = json.content.map(withoutBlockUuids);
  return out;
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
