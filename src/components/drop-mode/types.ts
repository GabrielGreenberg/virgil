/**
 * Drop Mode — shared types.
 *
 * Drop mode is the "shift + grab a popped-out item's grab bar" gesture
 * that lets the user place the item back into the document text at a
 * specific location. A central controller handles the geometry, picks
 * an indicator shape, and dispatches a per-item `DropSpec` on release.
 *
 * Architecture overview: see `/Users/gabriel/.claude/plans/today-i-need-a-nifty-prism.md`.
 */

import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  FootnoteRef,
  HighlightCard,
  QuotationGroup,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";

/** A rectangle in viewport coordinates, used to position the indicator. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One of the three drop placement shapes. Picked at hit-test time by
 * combining the dragged item's allowed placements with the cursor's
 * geometric relationship to the editor under it.
 */
export type Placement =
  /** Cursor is between two block nodes (or above the first / below the
   *  last). Indicator is a thin horizontal line spanning the text column. */
  | {
      kind: "between-blocks";
      editor: Editor;
      /** ProseMirror position where the drop should insert. */
      insertPos: number;
      rect: ViewportRect;
    }
  /** Cursor is alongside a paragraph; indicator is a 2px vertical bar
   *  in the gutter. Used for whole-paragraph attachments (note, todo). */
  | {
      kind: "paragraph-side";
      editor: Editor;
      paragraphId: string;
      side: "left" | "right";
      rect: ViewportRect;
    }
  /** Cursor is at an inline character position; indicator is a 2px
   *  line-height vertical bar. Used for inline atoms (footnote,
   *  citation) and inline text inserts. */
  | {
      kind: "inline-cursor";
      editor: Editor;
      pos: number;
      rect: ViewportRect;
    };

export type PlacementKind = Placement["kind"];

/** Decision returned by `DropSpec.classifyDrop`. */
export type DropDecision =
  | { kind: "no-op" }
  | { kind: "apply" }
  | {
      kind: "confirm";
      title?: string;
      message: ReactNode;
      confirmLabel?: string;
      cancelLabel?: string;
    };

/**
 * Generic per-kind paragraph-anchor API. Every attachment-card kind
 * (note, todo, quotation, archive, cutter, revision) exposes the same
 * shape: lookup the entity, read its current paragraph anchor(s),
 * add or remove a link. The spec factory `textObjectSideReanchorSpec`
 * consumes any API matching this contract.
 */
export interface ParagraphAnchorApi {
  /** Returns true if the entity still exists in this doc. */
  exists: (id: string) => boolean;
  /** Linked paragraph UUIDs for this entity. */
  getAnchorTextObjectIds: (id: string) => string[];
  addTextObjectLink: (id: string, paragraphId: string) => void;
  removeTextObjectLink: (id: string, paragraphId: string) => void;
  /**
   * Phase 4 sidecar capture. If the entity carries a Mode B textRange
   * anchor, persist that anchor's data onto `card.originalAnchor` so
   * future UX can revisit the lost range. Returns the captured
   * `anchorId` so the caller can remove the corresponding
   * `linkedAnchor` mark from the editor; null when the entity was
   * Mode A (no preservation needed). Optional — hooks that don't
   * support Mode B can omit this method.
   */
  preserveModeBAnchor?: (id: string) => string | null;
}

/**
 * Per-doc context bag handed to drop specs. Built by `EditorPane` from
 * the aggregated hooks; registered with the controller via
 * `setDropCtx`. Specs use it to look up the source entity and call
 * setters on the right hook.
 */
export interface DropCtx {
  /** The main document's editor — distinguished from card-body editors
   *  so specs can enforce `targetScope: "main-only"`. */
  mainEditor: Editor | null;
  /** Dismiss a popped-out float. */
  closePopout: (cardKey: string) => void;
  /** Imperative confirm — opens the modal and awaits the user's choice. */
  confirm: (opts: {
    title?: string;
    message: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  /** Per-kind hook APIs. Each spec needs its own; absent means the
   *  feature isn't wired in this doc (silently no-op). One sub-bag
   *  per paragraph-side attachment kind; future inline-atom kinds
   *  (footnote, citation, ai) will add their own sibling sub-bags. */
  notes?: ParagraphAnchorApi;
  /** Highlights are always Mode B; the drop spec uses the same shape
   *  as `notes` but reads/writes the highlight-specific corner of the
   *  `useNotes` hook. */
  highlights?: ParagraphAnchorApi;
  todos?: ParagraphAnchorApi;
  quotations?: ParagraphAnchorApi;
  archive?: ParagraphAnchorApi;
  /** Both cutter-comment and cutter-suggestion share this API — they
   *  live in the same `useCutter` hook with one ID space. */
  cutterCards?: ParagraphAnchorApi;
  /** Both revision (comment) and revision-suggestion share this API. */
  revisions?: ParagraphAnchorApi;
  /** Sub-bag for the stack-pull spec. Carries the per-doc card-creation
   *  factories plus a bib upsert so a pulled snapshot can materialize a
   *  fresh entity in the destination doc with a new id. Absent means
   *  stack pulls into this doc are no-ops (e.g. paper render mode). */
  stack?: StackPullApi;
}

/**
 * API the stack-pull DropSpec uses to materialize a snapshot into the
 * destination doc. Each method creates a NEW entity with a fresh id
 * (paste-as-new) and returns it so the spec can chain anchoring.
 *
 * Cards that anchor to a paragraph accept an optional `paragraphId`;
 * when null, the card is unanchored. Bib upsert is no-op when the key
 * already exists.
 */
export interface StackPullApi {
  /** Add a note. Returns the new card with a fresh id. */
  addNote: (
    paragraphId: string | null,
    seed: { title?: string; content?: unknown },
  ) => UserNote;
  /** Add a highlight. v1 stack-pull skips re-anchoring a highlight's
   *  text range (the original mark is gone) — drops always create an
   *  unanchored highlight or a paragraph-anchored placeholder.
   *  Absent means highlights aren't supported in this doc. */
  addHighlight?: (paragraphId: string | null) => HighlightCard;
  addTodo: (paragraphId: string | null, seed: { text?: string }) => TodoItem;
  addArchive: (
    paragraphId: string | null,
    seed: { title?: string; content?: unknown },
  ) => ArchivedSnippet;
  addQuotation: (
    paragraphId: string | null,
    seed: QuotationGroup,
  ) => QuotationGroup;
  addRevisionComment: (
    paragraphId: string | null,
    seed: Extract<RevisionCard, { kind: "comment" }>,
  ) => RevisionCard;
  addRevisionSuggestion: (
    paragraphId: string | null,
    seed: Extract<RevisionCard, { kind: "suggestion" }>,
  ) => RevisionCard;
  addCutterComment: (
    paragraphId: string | null,
    seed: Extract<CutterCard, { kind: "comment" }>,
  ) => CutterCard;
  addCutterSuggestion: (
    paragraphId: string | null,
    seed: Extract<CutterCard, { kind: "suggestion" }>,
  ) => CutterCard;
  /** Register a footnote ref (without inline marker insertion — v1
   *  stack-pull only adds the ref so the body content survives; the
   *  inline atom belongs to a future enhancement). */
  addFootnote: (seed: FootnoteRef) => FootnoteRef;
  /** Add an unanchored citation; v1 stack-pull creates citations as
   *  unanchored entries in the panel. */
  addCitation: (seed: CitationRef) => CitationRef;
  /** Upsert a bib entry. No-op when the key already exists. */
  upsertBibEntry: (entry: BibEntry) => void;
}

/**
 * Per-kind drop behavior. Each kind (note, todo, paragraph, footnote, …)
 * contributes one spec; the registry composes them into a single record.
 */
export interface DropSpec {
  /** Listed in priority order; first matching geometry wins. */
  allowedPlacements: ReadonlyArray<PlacementKind>;
  /**
   * Whether this kind may drop into card-body editors or only the main
   * editor. Attachment cards (note, todo, etc.) anchor to paragraph
   * UUIDs in the main document — re-anchoring them to a paragraph
   * inside another card's body has no meaning, so they declare
   * `"main-only"`. Content items and inline atoms declare `"any-editor"`.
   */
  targetScope: "main-only" | "any-editor";
  /**
   * Decide what to do on release. Runs at mouseup with the final
   * placement. Returning `no-op` cancels silently; `apply` runs
   * `applyDrop` immediately; `confirm` opens the modal and runs
   * `applyDrop` only on user confirmation.
   */
  classifyDrop: (
    placement: Placement,
    cardKey: string,
    ctx: DropCtx,
  ) => DropDecision;
  /** Carry out the drop. Called after classifyDrop returns apply (or
   *  after the user confirms a confirm decision). */
  applyDrop: (placement: Placement, cardKey: string, ctx: DropCtx) => void;
  /** What happens to the float after a successful drop. */
  postDrop: "close" | "keep";
}

/**
 * The active drop session. Held in a module-level signal so the
 * FloatingPanel header (the source) and the Indicator + Provider (the
 * consumers) can share state across unrelated React subtrees — same
 * pattern as `card-lift.ts`.
 */
export interface DropSession {
  cardKey: string;
  /** The kind prefix of `cardKey` (e.g. "note", "paragraph"). Used to
   *  look the spec up in the registry. */
  kind: string;
  spec: DropSpec;
  /** Where the user mousedowned, used by ESC / leave logic. */
  origin: { x: number; y: number };
  /** Current placement under the cursor, or null when not over a valid
   *  target. The Indicator subscribes to this and re-renders. */
  placement: Placement | null;
}
