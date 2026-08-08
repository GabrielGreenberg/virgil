/**
 * Drop Mode — shared types.
 *
 * Drop mode is the "grab a card's drop button (the double-chevron) and
 * drag" gesture that lets the user place the item back into the document
 * text at a specific location. A central controller handles the geometry,
 * picks an indicator shape, and dispatches a per-item `DropSpec` on
 * release. (Before req-7 the entry was a Shift-grab on a float header;
 * that entry is retired — the drop button is now the gesture.)
 *
 * Architecture overview: see `/Users/gabriel/.claude/plans/today-i-need-a-nifty-prism.md`.
 */

import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { ReactNode } from "react";
import type { TextObjectKind } from "@/text-objects/types";
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
   *  in the margin. Used for whole-paragraph attachments (note, todo). */
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
 * (note, todo, archive, cutter, revision) exposes the same
 * shape: lookup the entity, read its current paragraph anchor(s),
 * add or remove a link. The spec factory `textObjectSideReanchorSpec`
 * consumes any API matching this contract.
 */
export interface ParagraphAnchorApi {
  /** Returns true if the entity still exists in this doc. */
  exists: (id: string) => boolean;
  /** Linked paragraph UUIDs for this entity. */
  getAnchorTextObjectIds: (id: string) => string[];
  /** Anchor the card to `paragraphId`. `targetKind` (optional, defaults to
   *  "paragraph") records the anchored TextObject kind. `paragraphSnapshot`
   *  (optional) is the anchored paragraph's plain text, captured at the
   *  editor-aware drop site so the new Mode-A link is self-healing on
   *  reload (the reconciler re-finds the paragraph by text if its UUID is
   *  lost). Omitted snapshot → legacy UUID-only link, backfilled on next
   *  load. (Matches the underlying `links.ts:addTextObjectLink` arg order.) */
  addTextObjectLink: (
    id: string,
    paragraphId: string,
    targetKind?: TextObjectKind,
    paragraphSnapshot?: string | null,
  ) => void;
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
  /**
   * Convert a surviving Mode-B (`linkedRange`) link on the card into a
   * clean Mode-A `paragraph` link, preserving the paragraph ids. Called
   * by the paragraph-side re-anchor commit (after `preserveModeBAnchor`
   * + mark strip) so the card sheds its `linkedRange` shape BEFORE the
   * fresh paragraph anchor lands — otherwise the new paragraph would be
   * folded into the dead textRange link (RC1). After this runs,
   * `getTextAnchor` returns null. Optional — kinds that are intrinsically
   * Mode-B (highlights) deliberately omit the call, and hooks that don't
   * support Mode B can omit the method. Backs onto `useNotes`'
   * `clearTextAnchorLink` / `links.ts:clearTextAnchorLink`.
   */
  clearModeB?: (id: string) => void;
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
  /**
   * CHIP-C: persist the `.tex` (with the target paragraph's `%!v:<uuid>`
   * comment) on a successful paragraph re-anchor COMMIT — independent of
   * whether `ensureAnchorUuid` minted a fresh UUID. Called ONCE per commit by
   * `controller.finishApply` (the single mouseup), NEVER per pointermove.
   * Closes the RC3 durability gap where re-anchoring onto an already-UUID'd
   * paragraph dispatches no mint tx → no flush → the UUID never reaches the
   * `.tex` → a reload re-mints and the anchor dies. Wired in `EditorPane` to
   * the same `useDocument` immediate-flush path the anchor-mint signal uses, so
   * a commit that ALSO minted coalesces to one write (no double-flush). Absent
   * means the doc isn't wired for commit-flush (Reader mode) → silently no-op. */
  requestAnchorFlush?: (paragraphId: string) => void;
  /** Imperative confirm — opens the modal and awaits the user's choice. */
  confirm: (opts: {
    title?: string;
    message: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
  /** Per-kind hook APIs. Each spec needs its own; absent means the
   *  feature isn't wired in this doc (silently no-op). One sub-bag
   *  per paragraph-side attachment kind. The INLINE-ATOM kinds do NOT
   *  each add a sibling field — they share the one registry-keyed
   *  {@link InlineAtomCardApis} bag below (task 233). */
  notes?: ParagraphAnchorApi;
  /** Highlights are always Mode B; the drop spec uses the same shape
   *  as `notes` but reads/writes the highlight-specific corner of the
   *  `useNotes` hook. */
  highlights?: ParagraphAnchorApi;
  todos?: ParagraphAnchorApi;
  archive?: ParagraphAnchorApi;
  /** Both cutter-comment and cutter-suggestion share this API — they
   *  live in the same `useCutter` hook with one ID space. */
  cutterCards?: ParagraphAnchorApi;
  /** Both revision (comment) and revision-suggestion share this API. */
  revisions?: ParagraphAnchorApi;
  /** Both report and report-request share this API — they live in the
   *  same `useReports` hook with one ID space. */
  reports?: ParagraphAnchorApi;
  /** Sub-bag for the stack-pull spec. Carries the per-doc card-creation
   *  factories plus a bib upsert so a pulled snapshot can materialize a
   *  fresh entity in the destination doc with a new id. Absent means
   *  stack pulls into this doc are no-ops (e.g. paper render mode). */
  stack?: StackPullApi;
  /** The ONE sub-bag every inline-atom card kind's "anchor the unanchored"
   *  create branch reads — keyed by card kind, not one hand-added field per
   *  kind (task 233). Absent, or missing this kind's entry, means the feature
   *  isn't wired in this doc: the create branch falls back to its declared
   *  no-api behavior (decline, or the empty create shape). */
  atomCards?: InlineAtomCardApis;
}

/**
 * The atom attrs an unanchored card of each inline-atom kind carries — the
 * per-kind payload of {@link InlineAtomCardApi}. **This map is the SSOT for
 * "which kinds own a create branch that needs card-authoritative data."**
 *
 * Why it exists (task 233): an unanchored card has NO marker in any editor, so
 * the "anchor the unanchored" create branch cannot read the atom's attrs off
 * the document — it must read them from the card. Before this map each kind
 * bolted its own optional sub-bag onto {@link DropCtx} by hand, and the
 * footnote's was simply never added: its `createAtom` built a hard-coded EMPTY
 * body, so re-placing an archived footnote **silently destroyed the user's
 * footnote text** (the body is the atom's `content` attr and regenerates from
 * nothing). The citation's `command` was wired and worked. Same branch, same
 * week, one mirrored and one not.
 *
 * Adding a kind here is now the ONE edit that makes the whole chain typecheck-
 * enforced: `INLINE_ATOM_CARD_BUILDERS` (drop-mode/atom-card-apis.ts) is a
 * `Record` over this union, so a kind added here and left unwired in
 * `EditorPane` is a COMPILE ERROR, not a silent empty atom.
 *
 * **Scope: the guard is per-KIND, not per-ATTR.** Each payload below is still a
 * hand-written list, and only covers what the CARD can supply. A known residual:
 * the `footnote` node also carries `title` and `thanks`, and `FootnoteRef` has
 * neither — so archiving a `\footnote[title]`/`\thanks{…}` already discards them
 * at splice time and the rebuild emits a plain `\footnote{}`. Same failure
 * SHAPE as task 233 (an attr the rebuilt atom can't regenerate), much smaller
 * loss. Closing it means persisting those fields on the ref first.
 */
export interface InlineAtomCardAttrs {
  /** The footnote body. It IS the atom's `content` attr and lives nowhere else
   *  — losing it loses the user's text (task 233). NOT the whole node: `title`
   *  and `thanks` have no home on `FootnoteRef` (see the scope note above). */
  footnote: { content: JSONContent };
  /** The serializable `\cite{…}`. Null for an empty/keyless DRAFT, which the
   *  citation create branch declines on. */
  citation: { command: string | null };
}

/** The inline-atom card kinds that own a create branch. Union of the keys of
 *  {@link InlineAtomCardAttrs} — a subset of `CardKind`, kept structural (not
 *  imported from the card registry) so `drop-mode/types.ts` stays a leaf. */
export type InlineAtomCardKind = keyof InlineAtomCardAttrs;

/**
 * What one inline-atom kind's create branch needs from its owning panel hook.
 * Two halves, and BOTH are load-bearing — the pre-233 footnote path had
 * neither:
 *
 *  - `atomAttrsFor` — READ the attrs only the card knows (the body, the
 *    command), so the rebuilt atom is lossless. Returning `null` DECLINES the
 *    drop (an empty draft citation), matching the upstream disabled button.
 *  - `onAnchored` — RECONCILE the card's own anchor state once the atom has
 *    landed: the card is no longer unanchored (nor archived — archiving is
 *    what spliced the atom out), so the flags that made it a "parked,
 *    re-placeable" ref must clear. Without it the sidecar keeps declaring
 *    `unanchored`, and a panel that lists atomless refs from the sidecar alone
 *    shows the SAME footnote twice: once live in the prose, once as a stale
 *    parked duplicate.
 */
export interface InlineAtomCardApi<TAttrs> {
  /** The card-authoritative atom attrs, or null to DECLINE the create. */
  atomAttrsFor: (id: string) => TAttrs | null;
  /** Called once, after the new atom has been inserted, so the owning hook can
   *  clear the card's `unanchored` / `archived` intent. Optional — a kind whose
   *  sidecar carries no such intent omits it. */
  onAnchored?: (id: string) => void;
}

/** The registry-keyed bag itself: at most one API per inline-atom kind. */
export type InlineAtomCardApis = {
  [K in InlineAtomCardKind]?: InlineAtomCardApi<InlineAtomCardAttrs[K]>;
};

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
  /** Re-attach a user-authored bib annotation (the bib-review note) in the
   *  destination doc's per-doc `annotations.json` sidecar, keyed by citekey.
   *  Called after `upsertBibEntry` on a bibliography/citation pull so the
   *  note survives a cross-doc round-trip (annotations don't ride the
   *  `BibEntry`). No-op / omitted when the pulled snapshot carried no
   *  annotation, so a same-doc pull writes nothing spurious. */
  setAnnotation?: (key: string, html: string) => void;
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
  /**
   * True when this spec owns an "anchor the unanchored" CREATE branch — i.e.
   * it can REBUILD its inline atom for a card that has no marker anywhere. Set
   * by `inlineAtomMoveSpec` from `!!opts.createAtom`, so it is a property of
   * the mechanism and can't be forgotten.
   *
   * Paired with `requiresCardApi` it states the invariant that actually failed
   * in task 233: **a spec that rebuilds an atom must declare where the card's
   * half of that atom comes from.** The pre-233 footnote spec had a create
   * branch and no accessor, and hard-coded an empty body — so a guard keyed on
   * "declared but unwired" would have walked straight past it. The guard is
   * keyed on this instead: `createsAtom ⇒ requiresCardApi`.
   */
  createsAtom?: boolean;
  /**
   * Declared ctx REQUIREMENT (task 233): this spec's create branch reads
   * `ctx.atomCards[<this kind>]`. Set by `inlineAtomMoveSpec` from its
   * `cardApiKind` option — never a second hand-maintained list.
   *
   * It exists so the gap that produced task 233 is VISIBLE from the registry:
   * a spec can be registered-and-reachable while the accessor it needs was
   * never wired, and the only symptom is a silently degraded atom. The
   * contract test reads this field off `CARD_REGISTRY[kind].dropSpec` and
   * asserts the wiring builder covers every kind that declares it; the factory
   * also warns in dev when a declared accessor is missing at drop time.
   */
  requiresCardApi?: InlineAtomCardKind;
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
  /** True when the gesture sourced from an in-editor lift (lifted-
   *  overlay) rather than from a popped-out float header. The
   *  controller skips `markSourceFloat` for in-place sessions — no
   *  float exists to dim. */
  inPlace: boolean;
}
