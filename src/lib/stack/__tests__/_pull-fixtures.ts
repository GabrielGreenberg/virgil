/**
 * Fully-populated snapshot records, one per `StackCardKind` — the fixtures the
 * task-330 fidelity suites drive.
 *
 * They live in a shared module because three suites need the SAME records: the
 * strip table's own contract (`pull-seed.test.ts`), the spec leg
 * (`cards/__tests__/stack-pull-content-fidelity.test.ts`) and the hook-door leg
 * (`hooks/__tests__/stack-pull-seed-doors.test.tsx`). A per-suite copy would let
 * one of them quietly stop populating the very field whose loss it exists to
 * catch.
 *
 * Every field of every record is populated with a DISTINCTIVE value, including
 * the identity / per-doc-binding / doc-bound-lifecycle fields — a fidelity suite
 * has to assert what must NOT travel just as sharply as what must, and a fixture
 * that left those at their defaults would pass either way.
 *
 * The fixtures are hand-written, as fixtures are; what is NOT hand-written is
 * the set of fields the suites demand back, which is derived from
 * `CARD_REGISTRY[kind].content`. So a new content field on an existing kind
 * fails the suite until this fixture grows one — which is the direction that
 * catches the defect, since the pre-330 loss was exactly a field nobody listed.
 */
import type { StackCardKind } from "../card-kinds";
import type { SnapshotData } from "../pull-seed";
import type { Link } from "@/links/_shared/types";

/** A per-doc anchor link — the shape a pull must never carry across. */
const SOURCE_LINK = {
  id: "link-from-source-doc",
  kind: "textObject",
  anchor: { type: "textObject", targetKind: "paragraph", uuid: "src-para-uuid" },
} as unknown as Link;

/** The Mode-B restore hint — per-doc, so it must not travel either. */
const SOURCE_ORIGINAL_ANCHOR = {
  droppedAt: "2020-01-03T00:00:00.000Z",
  anchorId: "src-anchor-id",
  textSnapshot: "the range this card used to sit in",
  paragraphIds: ["src-para-uuid"],
};

const RICH_BODY = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "body the user typed" }] },
  ],
};

/** A record's fields as a plain bag — the shape a field-name sweep needs. The
 *  card records are interfaces without index signatures, so every sweep in the
 *  330 suites goes through this one cast rather than re-deriving it. */
export const asRecord = (v: unknown): Record<string, unknown> =>
  v as Record<string, unknown>;

/** Every snapshot payload, every field populated. */
export const POPULATED_SNAPSHOT_DATA: {
  [K in StackCardKind]: SnapshotData<K>;
} = {
  note: {
    kind: "note",
    id: "src-note-id",
    archived: true,
    title: "a title the user typed",
    titleAuto: false,
    content: RICH_BODY,
    createdAt: "2020-01-01T00:00:00.000Z",
    aiRequest: true,
    links: [SOURCE_LINK],
    originalAnchor: SOURCE_ORIGINAL_ANCHOR,
  },
  highlight: {
    kind: "highlight",
    id: "src-highlight-id",
    archived: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    highlightColor: "#abcdef",
    aiRequest: true,
    links: [SOURCE_LINK],
    originalAnchor: SOURCE_ORIGINAL_ANCHOR,
  },
  footnote: {
    id: "src-footnote-id",
    archived: true,
    aiRequest: true,
    unanchored: true,
    content: RICH_BODY,
    createdAt: "2020-01-01T00:00:00.000Z",
  },
  citation: {
    id: "src-citation-id",
    archived: true,
    command: "\\citep{smith2020}",
    keys: ["smith2020"],
    createdAt: "2020-01-01T00:00:00.000Z",
    unanchored: true,
  },
  bibliography: {
    uid: "src-bib-uid",
    key: "smith2020",
    type: "article",
    fields: { title: "A Paper", author: "Smith" },
    raw: "@article{smith2020, title={A Paper}}",
  },
  todo: {
    id: "src-todo-id",
    archived: true,
    text: "the todo the user typed",
    titleAuto: false,
    notes: "notes the user typed",
    done: true,
    aiRequest: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    links: [SOURCE_LINK],
  },
  archive: {
    id: "src-archive-id",
    archived: true,
    title: "a clip title the user typed",
    titleAuto: false,
    content: RICH_BODY,
    createdAt: "2020-01-01T00:00:00.000Z",
    unanchored: true,
    links: [SOURCE_LINK],
  },
  "revision-comment": {
    kind: "comment",
    id: "src-rev-comment-id",
    createdAt: "2020-01-01T00:00:00.000Z",
    archived: true,
    text: "body the user typed",
    content: RICH_BODY,
    aiRequest: true,
    selectedText: "text selected in the SOURCE doc",
    selectedContent: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "text selected in the SOURCE doc" }] },
      ],
    },
    links: [SOURCE_LINK],
  },
  "revision-suggestion": {
    kind: "suggestion",
    id: "src-rev-suggestion-id",
    createdAt: "2020-01-01T00:00:00.000Z",
    archived: true,
    author: "ai",
    original_text: "the passage as it stood",
    suggested_text: "the AI's replacement",
    explanation: "why the change helps",
    user_text: "the human's own rewrite",
    instructions: "make it punchier",
    status: "applied",
    appliedChange: {
      anchorId: "src-anchor",
      anchorUuid: "src-para-uuid",
      originalText: "the passage as it stood",
      replacement: "the AI's replacement",
      mode: "replace",
      appliedAt: "2020-01-02T00:00:00.000Z",
    },
    selectedText: "text selected in the SOURCE doc",
    selectedContent: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "text selected in the SOURCE doc" }] },
      ],
    },
    links: [SOURCE_LINK],
  },
  "cutter-comment": {
    kind: "comment",
    id: "src-cut-comment-id",
    createdAt: "2020-01-01T00:00:00.000Z",
    archived: true,
    text: "body the user typed",
    content: RICH_BODY,
    aiRequest: true,
    selectedText: "text selected in the SOURCE doc",
    selectedContent: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "text selected in the SOURCE doc" }] },
      ],
    },
    links: [SOURCE_LINK],
  },
  "cutter-suggestion": {
    kind: "suggestion",
    id: "src-cut-suggestion-id",
    createdAt: "2020-01-01T00:00:00.000Z",
    archived: true,
    author: "ai",
    original_text: "the passage as it stood",
    suggested_text: "the AI's replacement",
    explanation: "why the cut helps",
    user_text: "the human's own rewrite",
    instructions: "preserve the citation",
    status: "applied",
    appliedChange: {
      anchorId: "src-anchor",
      anchorUuid: "src-para-uuid",
      originalText: "the passage as it stood",
      replacement: "the AI's replacement",
      mode: "replace",
      appliedAt: "2020-01-02T00:00:00.000Z",
    },
    selectedText: "text selected in the SOURCE doc",
    selectedContent: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "text selected in the SOURCE doc" }] },
      ],
    },
    links: [SOURCE_LINK],
  },
};

/**
 * The fields a pull of `kind` must deliver, DERIVED from the registry's content
 * model — body + text + AI-prefilled + author-conditional, i.e. every field the
 * model calls user content under any verdict. (The verdicts split what the
 * DELETE-CONFIRM counts; transport carries all of them, because
 * `original_text`/`suggested_text` are words on the card either way.)
 *
 * Callers pass `CARD_REGISTRY` in rather than importing it, so this leaf keeps
 * the zero-runtime-import discipline `card-kinds.ts` documents.
 */
export function declaredContentFields(
  content: {
    bodyField: string | null;
    textFields: readonly string[];
    aiPrefilledFields: readonly string[];
    authorConditionalFields: readonly string[];
  } | null,
): string[] {
  if (!content) return [];
  return [
    ...(content.bodyField ? [content.bodyField] : []),
    ...content.textFields,
    ...content.aiPrefilledFields,
    ...content.authorConditionalFields,
  ];
}

/**
 * Content fields the registry declares that the SNAPSHOT RECORD structurally
 * cannot carry — so a pull cannot deliver them and this is where that is said
 * out loud rather than quietly relaxed inside an assertion.
 *
 * ONE entry. `CARD_REGISTRY.footnote.content` names `title` (the `\thanks`
 * label), and the content model is fed a COMPOSED `{ content, title }` object at
 * its footnote call sites — the title lives on the `\footnote` atom's node
 * attrs, and `FootnoteRef`, which is what a stack snapshot carries, has no such
 * field. The loss is therefore at the CAPTURE, one layer before anything this
 * task touches. The set may only shrink: closing it means teaching
 * `snapshotCard` to capture the atom's title, at which point the exemption goes
 * and this suite demands it back.
 */
export const UNCARRIABLE_CONTENT_FIELDS: Readonly<
  Partial<Record<StackCardKind, readonly string[]>>
> = {
  footnote: ["title"],
};
