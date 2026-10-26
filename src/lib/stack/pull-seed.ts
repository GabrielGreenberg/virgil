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
 * {@link FIELD_FATES} names EVERY field of every kind's record with its fate
 * (task 1298), keyed to each record's own `keyof`: a name that is not a real
 * field is a COMPILE ERROR, a kind added to `STACK_CARD_KINDS` with no entry
 * is another, and — the third rot mode, which a bare denylist could not see —
 * a field ADDED to a record with no stated fate is a third. That closes the
 * dead-facet hazard (task 202/227) for this table by construction rather than
 * by a census. {@link NON_TRAVELLING_FIELDS} is derived from it.
 *
 * ## The three reasons a field stays behind
 *
 * - **Identity** (`id`, `createdAt`, `uid`, the `kind` discriminant) — a pull is
 *   paste-as-new. The factory mints these; the source's are meaningless here,
 *   and a spread-through `kind` from a blob written by another build would file
 *   the record under the wrong shape.
 * - **Per-doc bindings** (`links`, `selectedText`/`selectedContent`/`selectedLatex`,
 *   `unanchored`, `archivedWith`, an archive snippet's origin + return records) — they address
 *   text in the SOURCE document. The pull decides its own anchor from the
 *   placement it landed on; a carried link would point at a paragraph uuid this
 *   doc has never seen.
 * - **Doc-bound lifecycle** (`archived`, `aiRequest`, `status`,
 *   `appliedChange`, `aiOriginRequestId`, `originalAnchor`) — state about this record's life in the
 *   source doc. Dropping `status`/`appliedChange` is load-bearing rather than
 *   incidental: an applied suggestion's `appliedChange` binds a LIVE range in
 *   the source paper's `.tex` (docs/agents/laws/capture-schema-symmetry.md, "The lifecycle half"), so a pulled
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
 * The strip is a DENYLIST at RUNTIME (the totality is a compile-time fact
 * about the fields this build knows), so a field the destination build does not know —
 * a `localStorage` blob written by a newer or older Virgil — spreads through
 * onto the new record. That is deliberate: the alternative is an allowlist,
 * which is the per-field hand-enumeration this module exists to delete, and an
 * unknown key is inert (nothing reads it) where a dropped known one is lost
 * user writing. `readEnvelope` validates the envelope shape; the payload is
 * shallowly typed, which is the same trust boundary every other consumer of a
 * `StackCardSnapshot` sits behind.
 */
import { DORMANT_CARD_FIELD } from "@/links/dormant";
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
 * Why a field does or does not arrive — the three reasons in the module header,
 * plus `travels`. Naming the REASON (not just a yes/no) is what makes each
 * entry a decision someone can read back.
 */
export type FieldFate = "travels" | "identity" | "per-doc" | "lifecycle";

/**
 * Every field of kind `K`'s record, each with its fate. The mapped type is
 * homomorphic with `-?`, so an OPTIONAL field is required here too.
 */
type FieldFates<K extends StackCardKind> = {
  readonly [F in keyof SnapshotData<K>]-?: FieldFate;
};

/**
 * **The classification is TOTAL (task 1298).** Per kind, EVERY field of the
 * record is named with its {@link FieldFate} — so a field added to a card type
 * later is a COMPILE ERROR here until someone states whether it travels.
 *
 * Before 1298 the table was a bare denylist, and a denylist cannot notice a
 * field it has never heard of: task 1194's `ArchivedSnippet.carriedMarks`,
 * 965/1079's `returnBefore`/`displaced`, 1193's `archivedWith` (on six
 * kinds), 696's `selectedLatex` and 1043's `aiOriginRequestId` all arrived
 * after it was written, all address the SOURCE paper, and all silently
 * travelled — a snippet restored in the new paper re-stamped `linkedAnchor`
 * marks naming cards that live only in the old one. A mapped type over
 * `keyof` turns "nobody thought about it" from an invisible default into a
 * type error, which is the whole point of the subtraction this module states.
 *
 * Per-kind notes cover only what the three categories do not make obvious.
 */
export const FIELD_FATES: { [K in StackCardKind]: FieldFates<K> } = {
  note: {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    // Task 1193's dormancy field (keyed by its owner's constant — the
    // dormant-links census forbids spelling it here): it names the SOURCE
    // paper's archive snippet these links are dormant in. Carried, it would
    // claim a dormancy in a snippet this paper does not have.
    [DORMANT_CARD_FIELD]: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    originalAnchor: "lifecycle",
    title: "travels",
    titleAuto: "travels",
    content: "travels",
  },
  // A highlight rides a text-range mark in the source doc, so the pull creates
  // a placeholder with no mark at all (`addHighlight`'s v1 contract) — only the
  // tint is the user's. `highlightColor` is v1-always-null today, so this seed
  // carries nothing in practice; it exists so highlight is not the ONE kind
  // whose factory cannot accept a field, which is how `addTodo`'s `notes` came
  // to be un-passable.
  highlight: {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    originalAnchor: "lifecycle",
    highlightColor: "travels",
  },
  // A footnote travels its body AND its card title. Since task 705 the title
  // is persisted on `FootnoteRef` (the `.tex` cannot carry it), so the
  // snapshot captures it and `addFootnoteFromSeed` lands it. `thanks` and
  // `numberOverride` are the footnote's own markup (`FootnoteMarkupAttrs`).
  footnote: {
    id: "identity",
    createdAt: "identity",
    unanchored: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    title: "travels",
    content: "travels",
    thanks: "travels",
    numberOverride: "travels",
  },
  // `keys` travels, and the hook re-derives it from `command` anyway
  // (`parseCiteCommand`) — the same derivation the destination uses.
  citation: {
    id: "identity",
    createdAt: "identity",
    unanchored: "per-doc",
    archived: "lifecycle",
    command: "travels",
    keys: "travels",
  },
  // Travels WHOLE but for its splice anchor, deliberately. Its pull runs
  // through `upsertBibEntry`, the same sink `applyBibCarry` (task 235) already
  // feeds with source-doc entries: insert-if-absent on the citekey, and
  // `useCitations.addBibEntry` is the documented uid MINT point, so an entry
  // arriving without a `uid` gets one and one arriving with it keeps it. A
  // second, contradicting rule here — stripping the uid on the card path while
  // the carry path keeps it — would be the fork this module exists to close.
  // `source` is the one exception, and the same door already states it: it is
  // a span in the SOURCE paper's `.bib` text (task 688), and `addBibEntry`
  // drops it for every arriving entry, carried or pulled alike.
  bibliography: {
    source: "per-doc",
    uid: "travels",
    key: "travels",
    type: "travels",
    fields: "travels",
    raw: "travels",
  },
  todo: {
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    text: "travels",
    notes: "travels",
    titleAuto: "travels",
    done: "travels",
  },
  // A pulled snippet arrives as a plain excerpt of its body. Everything that
  // ties it back to the SOURCE paper stays there: the ORIGIN record (task 712 —
  // `originalCard` holds the card's links into that paper, and "put it back in
  // Notes" means THAT paper's Notes), and the three RETURN-side records the
  // capture took so Restore can undo it (`returnBefore` names a source block
  // uuid, `displaced` source card ids, `carriedMarks` `linkedAnchor` marks
  // whose `linkCard` is a source card — restored here, they would stamp marks
  // no card in this paper owns).
  archive: {
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    unanchored: "per-doc",
    returnBefore: "per-doc",
    displaced: "per-doc",
    carriedMarks: "per-doc",
    originalPanel: "per-doc",
    originalCard: "per-doc",
    archived: "lifecycle",
    archivedAt: "lifecycle",
    title: "travels",
    titleAuto: "travels",
    content: "travels",
  },
  "revision-comment": {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    selectedText: "per-doc",
    selectedContent: "per-doc",
    selectedLatex: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    text: "travels",
    content: "travels",
  },
  // `aiOriginRequestId` (task 1043) points at a row of the SOURCE paper's
  // `ai-requests.json`; a pulled copy that kept it would finalize a Task this
  // paper never had when the user accepts or rejects it here.
  "revision-suggestion": {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    selectedText: "per-doc",
    selectedContent: "per-doc",
    selectedLatex: "per-doc",
    archived: "lifecycle",
    status: "lifecycle",
    appliedChange: "lifecycle",
    aiOriginRequestId: "lifecycle",
    author: "travels",
    original_text: "travels",
    suggested_text: "travels",
    explanation: "travels",
    user_text: "travels",
    instructions: "travels",
  },
  "cutter-comment": {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    selectedText: "per-doc",
    selectedContent: "per-doc",
    selectedLatex: "per-doc",
    archived: "lifecycle",
    aiRequest: "lifecycle",
    text: "travels",
    content: "travels",
  },
  "cutter-suggestion": {
    kind: "identity",
    id: "identity",
    createdAt: "identity",
    links: "per-doc",
    [DORMANT_CARD_FIELD]: "per-doc",
    selectedText: "per-doc",
    selectedContent: "per-doc",
    selectedLatex: "per-doc",
    archived: "lifecycle",
    status: "lifecycle",
    appliedChange: "lifecycle",
    aiOriginRequestId: "lifecycle",
    author: "travels",
    original_text: "travels",
    suggested_text: "travels",
    explanation: "travels",
    user_text: "travels",
    instructions: "travels",
  },
};

function nonTravelling<K extends StackCardKind>(
  kind: K,
): readonly (keyof SnapshotData<K>)[] {
  const fates = FIELD_FATES[kind] as Record<string, FieldFate>;
  return Object.keys(fates).filter(
    (f) => fates[f] !== "travels",
  ) as (keyof SnapshotData<K>)[];
}

/**
 * Per-kind: the fields a pull deliberately leaves behind — DERIVED from
 * {@link FIELD_FATES}, so it cannot disagree with the classification.
 */
export const NON_TRAVELLING_FIELDS: {
  [K in StackCardKind]: readonly (keyof SnapshotData<K>)[];
} = Object.fromEntries(
  (Object.keys(FIELD_FATES) as StackCardKind[]).map((k) => [k, nonTravelling(k)]),
) as unknown as { [K in StackCardKind]: readonly (keyof SnapshotData<K>)[] };

/**
 * The ONE door from a snapshot record to a pull seed. Pure: it neither reads
 * the clock nor mints an id, because `planCardDrop` runs its resolution TWICE
 * per gesture (once per `DropSpec` door — docs/agents/laws/capture-schema-symmetry.md, "The feedback half").
 */
export function pullSeed<K extends StackCardKind>(
  kind: K,
  data: SnapshotData<K>,
): PullSeed<K> {
  const seed = { ...data } as unknown as Record<string, unknown>;
  for (const field of NON_TRAVELLING_FIELDS[kind]) delete seed[field as string];
  return seed as PullSeed<K>;
}
