/**
 * Stack — visual clipboard at the bottom-left of the editor.
 *
 * The Stack accepts snapshots of popped-out items (paragraphs, headings,
 * card popouts) plus plain text selections. Items are read-once at drop
 * time and never live-sync with the source, even after the source mutates
 * or is deleted. Pulling an item out of the Stack starts a drop-mode
 * session that inserts a fresh copy at the placement (paste-as-new); the
 * Stack item itself is preserved (pull is a copy, not a pop).
 *
 * Persistence: window-scoped localStorage (cross-document scope per the
 * approved plan). Schema is wrapped in a versioned envelope so old blobs
 * can be migrated rather than discarded.
 */
import type { JSONContent } from "@tiptap/react";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  FootnoteRef,
  HighlightCard,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";
import type { StackCardKind } from "./card-kinds";

// The vocabulary itself lives in `./card-kinds` — a zero-runtime-import leaf, so
// `cards/card-registry.tsx` (a documented runtime leaf) can read it to pin its
// `stackable` facet. Re-exported here because this module is the Stack's type
// entry point and every existing consumer imports the union from it.
export type { StackCardKind } from "./card-kinds";
export {
  CARD_KIND_BY_STACK_CARD_KIND,
  STACK_CARD_KINDS,
  isStackableCardKind,
  stackCardKindFor,
} from "./card-kinds";

/** Per-card-kind snapshot payload. The `data` field carries the source
 *  card's serialized record verbatim; consumers re-serialize on pull,
 *  swapping in a fresh id. Sidecars carry data the destination doc may
 *  not have (bib entries for citations). */
export type StackCardSnapshot =
  | { cardKind: "note"; data: UserNote }
  | { cardKind: "highlight"; data: HighlightCard }
  | { cardKind: "footnote"; data: FootnoteRef }
  | {
      cardKind: "citation";
      data: CitationRef;
      bibEntries?: BibEntry[];
      /** User-authored annotations for the side-channelled `bibEntries`,
       *  keyed by citekey. Annotations live in a per-doc `annotations.json`
       *  sidecar (NOT on the `BibEntry`), so they must ride the snapshot or a
       *  cross-doc pull drops them silently. Only non-empty entries are
       *  carried; absent ⇒ none of the referenced entries had a note. */
      bibAnnotations?: Record<string, string>;
    }
  | {
      cardKind: "bibliography";
      data: BibEntry;
      /** User-authored annotation for this entry (the bib-review note),
       *  resolved from the per-doc `annotations.json` sidecar at snapshot
       *  time. Carried so a cross-doc pull can re-attach it; absent/empty ⇒
       *  the entry had no annotation. */
      annotation?: string;
    }
  | { cardKind: "todo"; data: TodoItem }
  | { cardKind: "archive"; data: ArchivedSnippet }
  | { cardKind: "revision-comment"; data: Extract<RevisionCard, { kind: "comment" }> }
  | {
      cardKind: "revision-suggestion";
      data: Extract<RevisionCard, { kind: "suggestion" }>;
    }
  | {
      cardKind: "cutter-comment";
      data: Extract<CutterCard, { kind: "comment" }>;
    }
  | {
      cardKind: "cutter-suggestion";
      data: Extract<CutterCard, { kind: "suggestion" }>;
    };

/**
 * Compile-time pin (task 259): the payload union covers EXACTLY the vocabulary.
 *
 * These two are separate declarations by necessity — the union carries a
 * different `data` shape per member, which no `Record` over `StackCardKind` can
 * express — so a member added to one and not the other is precisely the drift
 * this file exists to prevent. Adding to `STACK_CARD_KINDS` without a payload
 * variant (or the reverse) fails here, at the declaration, rather than silently
 * at whichever switch is reached first.
 */
type ExactlyTheVocabulary<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
const _snapshotsCoverVocabulary: ExactlyTheVocabulary<
  StackCardSnapshot["cardKind"],
  StackCardKind
> = true;
void _snapshotsCoverVocabulary;

/** Discriminated union of all snapshot payloads. */
export type StackPayload =
  /** Inline text slice. `slice` is a ProseMirror Slice serialized to JSON
   *  (via `slice.toJSON()`) so it can be re-hydrated without losing open
   *  depths; `plain` is for thumbnail rendering. */
  | { kind: "text"; slice: unknown; plain: string }
  /** Snapshot of one editor block (a paragraph or other anchorable). The
   *  node JSON has its `attrs.uuid` stripped — pull regenerates a fresh
   *  uuid. */
  | { kind: "paragraph"; node: JSONContent }
  /** Snapshot of a heading + its dominated body range, captured with
   *  `getSectionRangeByUuid`. Each node's uuid is stripped. */
  | { kind: "heading"; nodes: JSONContent[] }
  /** Snapshot of a card. `card.data` carries the source record verbatim
   *  (including its original id, which is rewritten on pull). */
  | { kind: "card"; card: StackCardSnapshot };

export interface StackItem {
  /** Stack-local uuid; not the source entity's id. */
  id: string;
  /** ISO timestamp of when the item was added to the stack. */
  capturedAt: string;
  /** Best-effort source attribution. `docTitle` is filled in when known
   *  so a thumbnail tooltip can show "from <doc>". */
  source: { docId: string | null; docTitle?: string };
  payload: StackPayload;
}

/** Storage envelope. Versioned so future schema changes can migrate
 *  rather than discard. */
export interface StackEnvelope {
  version: 1;
  items: StackItem[];
}

/** Hard cap on stack size. localStorage limit is small (~5MB per origin);
 *  200 items × a few KB stays comfortably within budget. FIFO eviction. */
export const STACK_MAX_ITEMS = 200;

/** localStorage key for the Stack envelope. Window-scoped: every Virgil
 *  window has its own. */
export const STACK_STORAGE_KEY = "virgil-stack-v1";

/** Synthetic card-key prefix used by stack-pull drop sessions. The
 *  controller's `lookupSpec(kind)` will find the stack-pull spec under
 *  this prefix. */
export const STACK_PULL_PREFIX = "stack-pull";

/** DataTransfer MIME advertising a Stack-pull HTML5 drag (reserved for
 *  future use; v1 only initiates pulls via mousedown → drop-mode). */
export const MIME_STACK_PULL = "application/x-virgil-stack-pull";
