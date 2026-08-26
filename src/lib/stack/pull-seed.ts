/**
 * **What a Stack pull CARRIES — stated once, as a subtraction.**
 *
 * A pull re-creates a card in the destination doc from a snapshot taken in the
 * source doc. Before task 330 that re-creation was a hand-picked COPY: the ONE
 * host implementation (`EditorPane`'s `dropStackApi`) started from an empty
 * record and forwarded a few named fields, so every kind lost at least one
 * field the user had typed — a note's `title` (and its `titleAuto` provenance,
 * so "never titled" and "title lost" became indistinguishable), a todo's
 * `notes` (whose seed type could not even carry it), a suggestion's `user_text`
 * and `instructions`. Nothing warned; the Stack thumbnail previewed the very
 * text the pull then discarded.
 *
 * > **A per-kind materialization never hand-picks fields out of a full-record
 * > snapshot. It rebuilds FROM the snapshot and SUBTRACTS — so a field arrives
 * > unless someone stated a reason it must not.**
 *
 * The direction is the whole fix. A copy list omits silently (the omission
 * looks exactly like a field that does not exist); a subtraction list is a
 * finite set of decisions, each of which has to be written down and can be
 * read back. It is the same inversion `snapshotCard` already uses on the
 * capture side — it deep-clones the WHOLE record — which is why the payload was
 * complete at every link of the chain and lossy only at the last inch.
 *
 * ## The table is checked against the record type
 *
 * {@link NON_TRAVELLING_FIELDS} is `readonly (keyof SnapshotData<K>)[]` per
 * kind, so a name that is not a real field of that record is a COMPILE ERROR,
 * and a kind added to `STACK_CARD_KINDS` with no entry is another. That closes
 * the dead-facet hazard (task 202/227) for this table by construction rather
 * than by a census: the two ways it could rot are both type errors.
 *
 * ## The three reasons a field stays behind
 *
 * - **Identity** (`id`, `createdAt`, `uid`, the `kind` discriminant) — a pull is
 *   paste-as-new. The factory mints these; the source's are meaningless here,
 *   and a spread-through `kind` from a blob written by another build would file
 *   the record under the wrong shape.
 * - **Per-doc bindings** (`links`, `selectedText`/`selectedContent`, `unanchored`) — they address
 *   text in the SOURCE document. The pull decides its own anchor from the
 *   placement it landed on; a carried link would point at a paragraph uuid this
 *   doc has never seen.
 * - **Doc-bound lifecycle** (`archived`, `aiRequest`, `status`,
 *   `appliedChange`, `originalAnchor`) — state about this record's life in the
 *   source doc. Dropping `status`/`appliedChange` is load-bearing rather than
 *   incidental: an applied suggestion's `appliedChange` binds a LIVE range in
 *   the source paper's `.tex` (AGENTS.md, "The lifecycle half"), so a pulled
 *   copy that claimed `applied` would advertise a Keep/Revert over a splice
 *   that does not exist in this document.
 *
 * Everything else travels, including the provenance flags that describe the
 * travelling content — `titleAuto` (is this title machine-default or typed?)
 * and `author` (did a human or the AI write this text?). Those are facts ABOUT
 * the words that arrive, so a pull that dropped them would deliver the content
 * and lie about it.
 *
 * ## Stated limit
 *
 * The strip is a DENYLIST, so a field the destination build does not know —
 * a `localStorage` blob written by a newer or older Virgil — spreads through
 * onto the new record. That is deliberate: the alternative is an allowlist,
 * which is the per-field hand-enumeration this module exists to delete, and an
 * unknown key is inert (nothing reads it) where a dropped known one is lost
 * user writing. `readEnvelope` validates the envelope shape; the payload is
 * shallowly typed, which is the same trust boundary every other consumer of a
 * `StackCardSnapshot` sits behind.
 */
import type { StackCardKind } from "./card-kinds";
import type { StackCardSnapshot } from "./types";

/** The record shape a snapshot of kind `K` carries. */
export type SnapshotData<K extends StackCardKind> = Extract<
  StackCardSnapshot,
  { cardKind: K }
>["data"];

/**
 * What a pull hands a `StackPullApi` factory: the snapshot's record MINUS the
 * fields {@link NON_TRAVELLING_FIELDS} withholds. `Partial` because the strip
 * removes required keys — the factory supplies its own.
 */
export type PullSeed<K extends StackCardKind> = Partial<SnapshotData<K>>;

/**
 * Per-kind: the fields a pull deliberately leaves behind. Total over
 * `StackCardKind` (a new stackable kind is a compile error until someone states
 * its answer) and keyed to each record's own `keyof` (a name the record does
 * not have is a compile error too).
 *
 * Read the three categories in the module header. Per-kind notes below cover
 * only what is not obvious from them.
 */
export const NON_TRAVELLING_FIELDS: {
  [K in StackCardKind]: readonly (keyof SnapshotData<K>)[];
} = {
  note: ["kind", "id", "createdAt", "links", "archived", "aiRequest", "originalAnchor"],
  // A highlight rides a text-range mark in the source doc, so the pull creates
  // a placeholder with no mark at all (`addHighlight`'s v1 contract) — only the
  // tint is the user's. `highlightColor` is v1-always-null today, so this seed
  // carries nothing in practice; it exists so highlight is not the ONE kind
  // whose factory cannot accept a field, which is how `addTodo`'s `notes` came
  // to be un-passable.
  highlight: ["kind", "id", "createdAt", "links", "archived", "aiRequest", "originalAnchor"],
  // A footnote's whole travelling set is its body. NOTE the asymmetry, recorded
  // rather than implied: `CARD_REGISTRY.footnote.content` also names `title`
  // (the `\thanks` label), which lives on the ATOM's node attrs and NOT on
  // `FootnoteRef` — so the title is already absent from the snapshot, one layer
  // before this table. A pull cannot carry what the capture never took.
  footnote: ["id", "createdAt", "archived", "aiRequest", "unanchored"],
  // `keys` travels, and the hook re-derives it from `command` anyway
  // (`parseCiteCommand`) — the same derivation the destination uses.
  citation: ["id", "createdAt", "archived", "unanchored"],
  // NOTHING, deliberately — a bib entry travels WHOLE, and this empty entry is
  // a stated decision rather than an oversight. Its pull runs through
  // `upsertBibEntry`, the same sink `applyBibCarry` (task 235) already feeds
  // with source-doc entries: insert-if-absent on the citekey, and
  // `useCitations.addBibEntry` is the documented uid MINT point, so an entry
  // arriving without a `uid` gets one and one arriving with it keeps it. A
  // second, contradicting rule here — stripping the uid on the card path while
  // the carry path keeps it — would be the fork this module exists to close.
  bibliography: [],
  todo: ["id", "createdAt", "links", "archived", "aiRequest"],
  archive: ["id", "createdAt", "links", "archived", "unanchored"],
  "revision-comment": [
    "kind",
    "id",
    "createdAt",
    "links",
    "archived",
    "aiRequest",
    "selectedText",
    "selectedContent",
  ],
  "revision-suggestion": [
    "kind",
    "id",
    "createdAt",
    "links",
    "archived",
    "selectedText",
    "selectedContent",
    "status",
    "appliedChange",
  ],
  "cutter-comment": [
    "kind",
    "id",
    "createdAt",
    "links",
    "archived",
    "aiRequest",
    "selectedText",
    "selectedContent",
  ],
  "cutter-suggestion": [
    "kind",
    "id",
    "createdAt",
    "links",
    "archived",
    "selectedText",
    "selectedContent",
    "status",
    "appliedChange",
  ],
};

/**
 * The ONE door from a snapshot record to a pull seed. Pure: it neither reads
 * the clock nor mints an id, because `planCardDrop` runs its resolution TWICE
 * per gesture (once per `DropSpec` door — AGENTS.md, "The feedback half").
 */
export function pullSeed<K extends StackCardKind>(
  kind: K,
  data: SnapshotData<K>,
): PullSeed<K> {
  const seed = { ...data } as unknown as Record<string, unknown>;
  for (const field of NON_TRAVELLING_FIELDS[kind]) delete seed[field as string];
  return seed as PullSeed<K>;
}
