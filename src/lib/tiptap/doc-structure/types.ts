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
  /** True iff the block carries a non-empty `parTitle` attribute (the Virgil
   *  paragraph title rendered above the block — paragraph / titled lists /
   *  texBlock / exampleBlock all declare it). Part of the section-path
   *  vocabulary: the breadcrumb derives from headings ∪ parTitled blocks, so
   *  a geometry consumer can read the titled set from the snapshot instead of
   *  walking the doc. Derived via `deriveParTitled` (shared by BOTH
   *  extractors, the `deriveExampleIdentity` discipline). */
  parTitled: boolean;
}

/**
 * Shared `parTitled` derivation — used by BOTH entity extractors
 * (`buildInitial` load walk and `inspectNodeAt`/the AttrStep branch of the
 * per-transaction path) so the two can never disagree on what "titled" means.
 * The flag is the BOOLEAN "renders a par-title", not the title text: the
 * NodeViews coerce empty strings to null (`(attrs.parTitle as string) || null`),
 * so non-empty-string is the render condition. Typing INSIDE an existing title
 * changes the string without flipping this boolean — which is what keeps
 * title-editing off the structural wake path.
 */
export function deriveParTitled(attrs: { parTitle?: unknown } | Record<string, unknown>): boolean {
  const t = (attrs as { parTitle?: unknown }).parTitle;
  return typeof t === "string" && t.length > 0;
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
  /** For a citation that lives INSIDE a footnote's `attrs.content` literal
   *  (T3 / C10): the `footnoteId`/`linkId` of the host footnote. `pos` for such
   *  an entry is the HOST footnote's position (the nested cite has no own PM
   *  node — it's a JSONContent literal `descendants()` can't enter), so a
   *  position-keyed jump scrolls to the visible footnote marker. Absent/undefined
   *  for a top-level citation. Populated only by the load-only `buildInitial`
   *  descend pass; the per-transaction `applyDiff` path does NOT touch it.
   *
   *  RETAINED for back-compat: every existing consumer (T3 machinery, the
   *  footnote omni/docked nesting, identity) reads this. It carries the SAME
   *  value as `nestedInContainerId.id` when the container kind is "footnote".
   *  For an EXAMPLE-nested cite this stays undefined (only the generalized
   *  `nestedInContainerId` is set) — example nesting routes exclusively through
   *  the generalized field. */
  nestedInFootnoteId?: string;
  /** Phase 2a — generalized "container owner" for a citation nested inside a
   *  card-bearing block container (footnote body OR example block). The render-
   *  side nesting (`nest-footnote-children.ts`) reads THIS to stamp the cite's
   *  Omni `parentCardId` = the container's omni card id, indent it, and order it
   *  under the parent — covering both kinds with one datum.
   *    - `{ kind: "footnote", id }` — populated alongside `nestedInFootnoteId`
   *      (same id) by the footnote-body literal descend pass.
   *    - `{ kind: "example", id }`  — populated by the exampleBlock descent;
   *      `id` is the enclosing exampleBlock's address (its `ExampleEntry.id` =
   *      the block uuid), so `cardPopKey("example", id)` resolves the example's
   *      omni card. `pos` for an example-nested cite is the cite's OWN PM
   *      position (unlike a footnote-nested cite — example children are real PM
   *      nodes `descendants()` reaches), so a position-keyed jump still lands on
   *      the cite.
   *  Absent for a top-level citation. Populated only by the load-only
   *  `buildInitial` pass; `applyDiff` does NOT touch it. */
  nestedInContainerId?: { kind: "footnote" | "example"; id: string };
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

/**
 * Derive an `exampleBlock`'s stable identity + display fields from its attrs.
 *
 * SHARED by BOTH entity extractors — `buildInitial` (the load-time O(N) walk,
 * `structure-index.ts`) and `inspectNodeAt` (the per-transaction incremental
 * path, `step-inspector.ts`) — so the two can never disagree on WHICH examples
 * are indexed or under WHAT id. They had drifted (task 213): the incremental
 * path pre-coerced `tag`/`label` to `""` before the `??` chain, so `null ?? ""`
 * short-circuited and the `label` fallback was unreachable there.
 *
 * `id` is the first NON-EMPTY of `uuid → tag → label` (empty strings treated as
 * ABSENT — the schema defaults `tag`/`label` to `""`, not `undefined`, so a
 * plain `??` chain would let an empty `tag` block the `label` fallback). This
 * lets a uuid-less, tag-less, **label-only** example index under its label
 * instead of being dropped. An all-empty example yields `id === ""` and is
 * skipped by both callers (`if (id)`). The stored `tag`/`label` stay coerced
 * to `""` for the `ExampleEntry` display fields.
 */
export function deriveExampleIdentity(attrs: {
  uuid?: string | null;
  tag?: string | null;
  label?: string | null;
  number?: string | number | null;
}): {
  id: string;
  uuid: string | null;
  tag: string;
  label: string;
  number: string | number | null;
} {
  const uuid = attrs.uuid ?? null;
  const tag = attrs.tag ?? "";
  const label = attrs.label ?? "";
  const id = uuid || tag || label || "";
  const number = attrs.number ?? null;
  return { id, uuid, tag, label, number };
}

export interface FigureEntry {
  uuid: string;
  pos: number;
  label: string;
  numbered: boolean;
  /** Current `figureNumber` attribute (numberer updates this). */
  number: number | null;
  /** Will this figure carry a `\caption` in the emitted `.tex` (tasks
   *  318/319 — `figureNodeEmitsCaption`)? A NUMBERING input, so it belongs to
   *  the structural comparison beside `numbered`: LaTeX numbers a float iff it
   *  is captioned, and a popover caption add/remove that the diff couldn't see
   *  left every LATER figure's on-screen number — and every `\ref` resolved
   *  from it — off by one until some unrelated structural edit came along.
   *  Deliberately a BOOLEAN and not the caption text: typing inside an already
   *  non-empty caption derives equal on both sides and stays structurally null
   *  (the `parTitled` precedent), so only the empty↔non-empty transition, which
   *  is exactly the transition that changes the number, wakes the numberer. */
  emitsCaption: boolean;
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
  /** Every citation node, in document order. Top-level citations have no
   *  `nestedInFootnoteId`; citations NESTED inside a footnote's `attrs.content`
   *  literal (opaque to step inspection / `descendants()`) carry their host
   *  footnote id in `nestedInFootnoteId` and the host footnote's `pos` (T3 /
   *  C10). The footnote-nested entries are populated ONLY by the load-only
   *  `buildInitial` descend pass — the per-transaction `applyDiff` path stays
   *  O(edit) and never re-walks a footnote body, so a nested cite's liveness is
   *  refreshed out-of-band (`footnoteOrderChanged` re-walk), not per-keystroke. */
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
  /** Same UUID, changed pos — the signature of a top-level block MOVE
   *  (delete+insert, uuid preserved). The moved block's mapped position is
   *  STALE (its old pos was deleted; `tr.mapping` does not follow moved
   *  content), so the structure index must fold the NEW pos in — exactly as
   *  `changedFootnotes`/`changedCitations` do for atom moves. Without this,
   *  `structure.blocks.get(movedUuid).pos` is wrong after a reorder and any
   *  position-keyed resolve (focus band) reads the wrong index. */
  changedBlocks: readonly BlockEntry[];
  /** True iff a top-level block was REORDERED with its UUID preserved (i.e.
   *  `changedBlocks` is non-empty): no block identity entered or left, but
   *  document order changed. Mirrors `citationOrderChanged`/
   *  `footnoteOrderChanged` — the consumer-facing ping for position-keyed
   *  consumers (focus band, fold filter) to re-resolve. A plain in-paragraph
   *  keystroke never touches a block's opening token, so it cannot set this. */
  blockOrderChanged: boolean;
  /** True iff some block's `parTitled` flag FLIPPED (a title was added to or
   *  removed from a block; same uuid, position unchanged). The flipped entries
   *  ride `changedBlocks` (so `applyDiff` folds the new flag into the index)
   *  WITHOUT setting `blockOrderChanged` — a title flip moves nothing, so
   *  position-keyed consumers stay asleep; section-path consumers (breadcrumb
   *  vocabulary) wake on this instead. Typing inside an existing title edits
   *  the string without flipping the boolean → no entry, no flag — the
   *  keystroke-sanctity path for title editing. */
  blockParTitleChanged: boolean;

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
  /** Same example id survived (same-uuid drag-reorder MOVE, or an in-place
   *  `setNodeMarkup` renumber) but its pos/number/tag/label changed. Mirrors
   *  `changedFigures`/`changedCitations`: a uuid landing in BOTH added+removed
   *  is an identity-preserving move — it must NOT appear in added/removed
   *  (no phantom orphan), but its mapped entry is stale, so it's carried here
   *  so the structure index folds the NEW pos/number in and a re-derive fires.
   *  This is the "changed" bucket examples used to lack — the hole that left
   *  docked/Omni ExampleCards showing a stale `(N)` after a reorder. */
  changedExamples: readonly ExampleEntry[];
  /** True iff the nesting or count of exampleItems changed, OR a same-uuid
   *  example move/renumber populated `changedExamples`. Gates the bus's
   *  `onExamplesRecomputable` emit and the structure-index example rebuild. */
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
  changedBlocks: [],
  blockOrderChanged: false,
  blockParTitleChanged: false,
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
  changedExamples: [],
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
    diff.changedBlocks.length === 0 &&
    !diff.blockOrderChanged &&
    !diff.blockParTitleChanged &&
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
    diff.changedExamples.length === 0 &&
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

/**
 * True when the diff carries anything BEYOND the two content-only sets —
 * i.e. `applyDiff` would fold at least one entry. The observer plugin uses
 * this to decide defer-vs-materialize per transaction: a content-only diff
 * (every plain keystroke) accumulates StepMaps lazily; anything structural
 * materializes so `applyDiff` folds into coherent positions.
 *
 * NOTE: deliberately BROADER than the bus's `emitCount` predicate — that one
 * omits `changedBlocks`/`changedFootnotes` by design (they don't wake
 * structural watchers), but applyDiff still folds them, so the observer must
 * treat them as structural. Don't unify the two.
 */
export function diffHasStructuralEntries(diff: StructureDiff): boolean {
  return !(
    diff.addedBlocks.length === 0 &&
    diff.removedBlocks.length === 0 &&
    diff.changedBlocks.length === 0 &&
    !diff.blockOrderChanged &&
    !diff.blockParTitleChanged &&
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
    diff.changedExamples.length === 0 &&
    !diff.exampleStructureChanged &&
    diff.addedFigures.length === 0 &&
    diff.removedFigures.length === 0 &&
    diff.changedFigures.length === 0 &&
    diff.addedLabels.length === 0 &&
    diff.removedLabels.length === 0
  );
}
