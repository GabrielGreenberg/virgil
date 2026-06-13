/**
 * DocStructureObserver — types
 *
 * See `docs/perf/keystroke-sanctity-findings.md` for the full architectural
 * brief. In one line: this module's job is to express "what the document
 * structurally is" and "what changed between two states" as plain data,
 * so every other reactor can subscribe to typed events instead of walking
 * the doc themselves.
 *
 * The `DocStructure` snapshot is the steady-state index. The
 * `StructureDiff` describes the delta produced by a single transaction.
 * Both are read-only from the consumer's perspective.
 */

// ---------------------------------------------------------------------------
// Entry shapes — one per structural-entity kind we track.
// ---------------------------------------------------------------------------

export interface BlockEntry {
  uuid: string;
  /** Position of the node's opening token in the document. */
  pos: number;
  /** Top-level node type name (heading / paragraph / exampleBlock / figureBlock / ...). */
  typeName: string;
}

export interface HeadingEntry {
  uuid: string;
  pos: number;
  level: number;
  /** Plain-text content used by the outline / numbering. */
  text: string;
  /** `\label{…}` attribute on the heading, if any. */
  label: string | null;
  numbered: boolean;
}

export interface FootnoteEntry {
  /** `footnoteId` attribute of the footnote node — the canonical address. */
  id: string;
  pos: number;
  /** `thanks` footnotes are numbered as "A" rather than counted. */
  thanks: boolean;
  /** Current `number` attribute (renumber pass updates this). */
  number: number;
}

export interface CitationEntry {
  /** `citationId` attribute of the citation node — the canonical address. */
  id: string;
  pos: number;
  /** The LaTeX command string, e.g. `\cite{smith2020}`. `keys` are parsed from it. */
  command: string;
  /** Rendered text shown in place, e.g. "Smith 2020". */
  displayText: string;
}

export interface AnchorEntry {
  /** `anchorId` from the linkedAnchor mark. */
  id: string;
  from: number;
  to: number;
  /** "note" | "highlight" | "cut" | "revision" | … (legacy `kind` attr). */
  kind: string;
}

export interface ExampleEntry {
  /** Stable address for the example block — uses its `uuid` if present,
   *  else `tag` or `label`. Always non-empty (else the entry is skipped). */
  id: string;
  uuid: string | null;
  /** Position of the opening exampleBlock node. */
  pos: number;
  /** `tag` attribute (user-typed key, e.g. "myex"). */
  tag: string;
  /** `\label{…}` attribute, if any. */
  label: string;
  /** Current `number` attribute (numberer updates this). */
  number: string | number | null;
}

export interface FigureEntry {
  uuid: string;
  pos: number;
  label: string;
  numbered: boolean;
  /** Current `figureNumber` attribute (numberer updates this). */
  number: number | null;
}

export interface LabelEntry {
  /** The `\label{…}` key (e.g. "sec:intro" or "fig:bar"). */
  id: string;
  /** Owning entity kind — what defined this label. */
  owner: "heading" | "figure" | "example" | "exampleItem";
  /** UUID of the owning block (heading / figureBlock / exampleBlock). */
  ownerUuid: string | null;
  pos: number;
}

// ---------------------------------------------------------------------------
// Steady-state snapshot — the index the observer keeps up to date.
// ---------------------------------------------------------------------------

export interface DocStructure {
  /** Monotonic — bumps on every applied diff. Use as a memoization key. */
  version: number;
  /** Every anchorable block keyed by UUID. */
  blocks: ReadonlyMap<string, BlockEntry>;
  /** Just the heading subset (in document order). */
  headings: readonly HeadingEntry[];
  /** Just the footnote nodes (in document order). */
  footnotes: readonly FootnoteEntry[];
  /** Every top-level citation node (in document order). Citations nested
   *  inside footnote `attrs.content` are NOT included — they're opaque to
   *  step inspection; consumers cover them via `getCitations()` re-walks
   *  triggered by `footnoteOrderChanged`. */
  citations: readonly CitationEntry[];
  /** Every distinct `anchorId` from linkedAnchor marks. Maps id → entry. */
  anchors: ReadonlyMap<string, AnchorEntry>;
  /** Every exampleBlock (in document order). */
  examples: readonly ExampleEntry[];
  /** Every figureBlock (in document order). */
  figures: readonly FigureEntry[];
  /** Every defined `\label{…}` key (heading / figure / example / item). */
  labels: ReadonlyMap<string, LabelEntry>;
}

export const EMPTY_STRUCTURE: DocStructure = {
  version: 0,
  blocks: new Map(),
  headings: [],
  footnotes: [],
  citations: [],
  anchors: new Map(),
  examples: [],
  figures: [],
  labels: new Map(),
};

// ---------------------------------------------------------------------------
// Diff — what changed in one transaction.
// ---------------------------------------------------------------------------

/**
 * Every field is a delta. Empty array / set = nothing in that category
 * changed. `isEmpty(diff)` returns true iff every field is empty —
 * which is the structurally-null-edit fast path.
 *
 * Note: `contentChangedUuids` covers blocks whose text/content changed
 * but whose identity (UUID) didn't. Float-mirror is the only current
 * consumer that needs this. Pure same-block typing produces this and
 * nothing else; if no float anchors to the typed block, all consumers
 * skip and the bus.emit can be elided as a future optimization.
 */
export interface StructureDiff {
  // Block-level identity changes.
  addedBlocks: readonly BlockEntry[];
  removedBlocks: readonly BlockEntry[];

  // Sub-views — independently consumable so subscribers don't have to
  // filter `addedBlocks` themselves.
  addedHeadings: readonly HeadingEntry[];
  removedHeadings: readonly HeadingEntry[];
  /** Same UUID, changed text/level/label/numbered. */
  changedHeadings: readonly HeadingEntry[];

  addedFootnotes: readonly FootnoteEntry[];
  removedFootnotes: readonly FootnoteEntry[];
  /** Same footnoteId, changed pos/thanks/number — e.g. an atom MOVE
   *  (delete+insert in one tx), whose add/remove cancel in reconciliation
   *  but whose NEW position the structure index must still fold in (else
   *  the moved footnote is left at a stale/dropped position and the
   *  renumber walks a corrupt snapshot). Mirrors `changedCitations`. */
  changedFootnotes: readonly FootnoteEntry[];
  /** True iff the document order of footnote IDs changed (renumber needed). */
  footnoteOrderChanged: boolean;

  addedCitations: readonly CitationEntry[];
  removedCitations: readonly CitationEntry[];
  /** Same citationId, changed command/displayText. */
  changedCitations: readonly CitationEntry[];
  /** True iff the document order of citation IDs changed (a pure move
   *  with unchanged attrs produces only this). */
  citationOrderChanged: boolean;

  addedAnchors: readonly AnchorEntry[];
  removedAnchors: readonly AnchorEntry[];

  addedExamples: readonly ExampleEntry[];
  removedExamples: readonly ExampleEntry[];
  /** True iff the nesting or count of exampleItems changed. */
  exampleStructureChanged: boolean;

  addedFigures: readonly FigureEntry[];
  removedFigures: readonly FigureEntry[];
  /** Same UUID, changed label / numbered (figureNumber alone doesn't count). */
  changedFigures: readonly FigureEntry[];

  addedLabels: readonly LabelEntry[];
  removedLabels: readonly LabelEntry[];

  /** Blocks whose interior content changed (text, marks, inline atoms)
   *  but whose UUID stayed the same. Drives float-mirror. */
  contentChangedUuids: ReadonlySet<string>;

  /** exampleBlock UUIDs whose interior content changed this transaction
   *  (text inside an example item, a gloss row, a nested atom) — keyed by
   *  the ENCLOSING exampleBlock's uuid, NOT the nearer anchorable
   *  exampleItem (which `contentChangedUuids` would carry instead, since
   *  exampleItems are also UUID-bearing). Lets the Examples-panel card —
   *  which addresses itself by exampleBlock uuid — re-seed on a content-only
   *  edit to its example made in the MAIN editor, without subscribing to the
   *  per-transaction stream. Derived from the SAME step walk that fills
   *  `contentChangedUuids` (no extra doc walk); content-only, so it never
   *  bumps the bus `emitCount`. */
  exampleContentChangedUuids: ReadonlySet<string>;
}

export const EMPTY_DIFF: StructureDiff = {
  addedBlocks: [],
  removedBlocks: [],
  addedHeadings: [],
  removedHeadings: [],
  changedHeadings: [],
  addedFootnotes: [],
  removedFootnotes: [],
  changedFootnotes: [],
  footnoteOrderChanged: false,
  addedCitations: [],
  removedCitations: [],
  changedCitations: [],
  citationOrderChanged: false,
  addedAnchors: [],
  removedAnchors: [],
  addedExamples: [],
  removedExamples: [],
  exampleStructureChanged: false,
  addedFigures: [],
  removedFigures: [],
  changedFigures: [],
  addedLabels: [],
  removedLabels: [],
  contentChangedUuids: new Set(),
  exampleContentChangedUuids: new Set(),
};

export function isEmptyDiff(diff: StructureDiff): boolean {
  return (
    diff.addedBlocks.length === 0 &&
    diff.removedBlocks.length === 0 &&
    diff.addedHeadings.length === 0 &&
    diff.removedHeadings.length === 0 &&
    diff.changedHeadings.length === 0 &&
    diff.addedFootnotes.length === 0 &&
    diff.removedFootnotes.length === 0 &&
    diff.changedFootnotes.length === 0 &&
    !diff.footnoteOrderChanged &&
    diff.addedCitations.length === 0 &&
    diff.removedCitations.length === 0 &&
    diff.changedCitations.length === 0 &&
    !diff.citationOrderChanged &&
    diff.addedAnchors.length === 0 &&
    diff.removedAnchors.length === 0 &&
    diff.addedExamples.length === 0 &&
    diff.removedExamples.length === 0 &&
    !diff.exampleStructureChanged &&
    diff.addedFigures.length === 0 &&
    diff.removedFigures.length === 0 &&
    diff.changedFigures.length === 0 &&
    diff.addedLabels.length === 0 &&
    diff.removedLabels.length === 0 &&
    diff.contentChangedUuids.size === 0 &&
    diff.exampleContentChangedUuids.size === 0
  );
}
