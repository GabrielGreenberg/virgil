import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
  HighlightCard,
  CutterCommentCard,
  CutterSuggestionCard,
  RevisionRequestCard,
  RevisionSuggestionCard,
  ReportCard,
  ReportRequestCard,
  TodoItem,
  CitationRef,
  ArchivedSnippet,
} from "@/lib/types";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import { isPanelDocked } from "@/hooks/view-prefs-derived";
import type { TextObjectKind } from "@/text-objects/types";
import type { CardKind } from "@/cards/types";
import { panelForCardKind } from "@/cards/predicates";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";
import type { CardStore } from "@/links/_shared/anchored-card-store";
import { cardPopKey } from "@/panels/panel-registry";
import { focusNewCard, cardKindHasEditableBody } from "@/lib/focus-new-card";
import type { EditorHandle } from "../../Editor";
import type {
  RecentlyAddedKind,
  RecentlyAddedTracker,
} from "@/hooks/useRecentlyAddedTracker";

/**
 * Centralized card creation — every "+" / toolbar / drop / selection path
 * that produces a new card funnels through here. Each `create*` function
 * owns the same post-create chores:
 *
 *   1. Delegate to the kind's hook `add*` method (which handles pristine
 *      marking for blank creates internally via the injected manager).
 *   2. Set the kind's panel selection so the new card is highlighted.
 *   3. Activate the panel on its placed side (no-op if already active).
 *   4. Optionally pop the card into a floating wrapper when called from a
 *      toolbar path (with an `anchorRect`).
 *
 * Click-away discard for blank cards is not a concern here — it's owned
 * entirely by the pristine manager's global pointerdown watcher.
 */

export type AnchorRef = { anchorId: string; anchorText: string };

export interface CardCreationDeps {
  editorRef: RefObject<EditorHandle | null>;
  addNote: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
    targetKind?: TextObjectKind,
  ) => UserNote;
  addHighlight: (
    anchor: AnchorRef,
    paragraphId: string | null,
    color?: string | null,
  ) => HighlightCard;
  deleteNote: (id: string) => void;
  addCutterComment: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
    targetKind?: TextObjectKind,
  ) => CutterCommentCard;
  addCutterSuggestion: (
    paragraphId: string | null,
    originalText?: string,
    anchor?: AnchorRef,
  ) => CutterSuggestionCard;
  addRevisionComment: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
    targetKind?: TextObjectKind,
  ) => RevisionRequestCard;
  addRevisionSuggestion: (
    paragraphId: string | null,
    originalText?: string,
    anchor?: AnchorRef,
  ) => RevisionSuggestionCard;
  addReport: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
    targetKind?: TextObjectKind,
    author?: "human" | "ai",
  ) => ReportCard;
  addReportRequest: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
    targetKind?: TextObjectKind,
  ) => ReportRequestCard;
  addTodo: () => TodoItem;
  updateTodo: (id: string, text: string) => void;
  addTodoTextObjectId: (id: string, paragraphId: string, targetKind?: TextObjectKind) => void;
  /** Set a todo's Mode-B text-range anchor (symmetric with note's
   *  `setTextAnchorLink` path). Used by the selection drag-handle path. */
  setTodoAnchor: (id: string, anchorId: string, anchorText: string) => void;
  addCitation: (command: string, existingId?: string, unanchored?: boolean) => CitationRef;
  /** Archive — mints a snippet and (optionally) writes a Mode A
   *  paragraph link. The dispatcher owns the editor mutation (cleanup
   *  walker + tr.delete) before/around the call. */
  archiveContent: (content: unknown) => ArchivedSnippet;
  updateArchiveSnippet: (id: string, content: unknown) => void;
  addArchiveTextObjectId: (
    id: string,
    paragraphId: string,
    targetKind?: TextObjectKind,
  ) => void;
  setSelectedArchiveId: (id: string | null) => void;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedReportCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  popCardAtAnchor: (kind: CardKind, id: string, anchorRect: DOMRect | null) => void;
  markFootnotePristine: (id: string) => void;
  /** Total footnote count (anchored + orphans) the panel currently
   *  shows. Used to seed the auto-title of newly created footnotes. */
  getFootnoteCount: () => number;
  /** Optional tracker that pins the just-added card to the top of its
   *  panel until the user moves selection elsewhere. */
  recentlyAdded?: RecentlyAddedTracker | null;
  /** This doc's interaction store. `finishCreate` expands + selects the new
   *  card in it. Threaded from the EditorPane body (resolved from
   *  `getCardStore(docId)`), so a create paints the active card in the RIGHT
   *  doc's store — never a cross-doc singleton. */
  store: CardStore;
}

/**
 * Where the new card surfaces for the user:
 *  - "float" (default): pop as a floating card anchored to the trigger
 *    (the Actions toolbar path — keeps the user's eye near the click).
 *  - "omni": leave the panel as-is, just select + pin the card. The
 *    caller is responsible for ensuring the omni-view is active on the
 *    panel's side so the card is visible at the top of the omni list.
 *    Used by the paragraph/selection/heading drag-handle action menu.
 */
export type CardCreateMode = "float" | "omni";

/**
 * Caret-into-body gate (CHIP B). When omitted it defaults to `true`
 * (user-initiated create → drop the cursor into the new card's body). AI /
 * programmatic create paths pass `false` so they don't yank focus mid-edit.
 * Threaded through every factory's opts and read centrally in `finishCreate`.
 */
type AutoFocusOpt = {
  /** Drop the caret into the new card's body. Defaults to `true`
   *  (user-initiated). Pass `false` for AI/programmatic creation. */
  autoFocus?: boolean;
};

export interface CardCreationApi {
  createNote: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    /** TextObject kind being anchored to. Defaults to "paragraph" when
     *  unspecified. Pass explicitly when the caller resolved a
     *  `TextObjectRef` (e.g. anchoring to a `listItem` or `exampleItem`)
     *  so the link records the right `targetKind`. */
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => UserNote;
  createHighlight: (opts: {
    /** Mandatory — highlights are always a text-range gesture. */
    anchor: AnchorRef;
    paragraphId?: string | null;
    color?: string | null;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => HighlightCard;
  /** Delete a note OR highlight by id. For highlights, also strips the
   *  in-doc `linkedAnchor` mark so the yellow tint goes away. */
  deleteHighlightOrNote: (id: string) => void;
  createCutterComment: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => CutterCommentCard;
  createCutterSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => CutterSuggestionCard;
  createReport: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => ReportCard;
  createReportRequest: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => ReportRequestCard;
  createRevisionRequest: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => RevisionRequestCard;
  createRevisionSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => RevisionSuggestionCard;
  createTodo: (opts: {
    text?: string;
    paragraphId?: string | null;
    /** Mode-B text-range anchor (a `linkedAnchor` dropped over a selection).
     *  When present, the new todo carries the range anchor in its `links[]`
     *  — symmetric with `createNote`. Absent ⇒ Mode-A paragraph anchoring
     *  (cursor-only todo). */
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
    targetKind?: TextObjectKind;
  } & AutoFocusOpt) => TodoItem;
  createFootnote: (opts: {
    fromSelection?: boolean;
    /**
     * Adopt an ALREADY-INSERTED footnote atom instead of minting + inserting
     * one. The slash / typed surfaces (CHIP 4b) insert the `\footnote{}` atom
     * SYNCHRONOUSLY in plugin-land (so it lands even if React is unmounted —
     * the citation durability principle), then route the CARD registration
     * here with the atom's id. When set, `createFootnote` runs ONLY the
     * pristine + pin + select + renumber tail against this id — it does NOT
     * call `createEmptyFootnote` (which would DOUBLE-insert). Mutually
     * exclusive with `fromSelection`. */
    existingFootnoteId?: string;
    /**
     * Adopt-path only: whether the adopted footnote is BLANK and so should be
     * marked pristine (click-away-discardable), matching the menu's empty
     * footnote. The menu's `fromSelection:false` path is ALWAYS pristine
     * (blank); the adopt path is pristine iff the PM caller inserted an empty
     * body. A typed `\footnote{some text}` carries real body content, so it
     * must NOT be reaped on click-away — the caller passes `pristine:false`
     * for it. Defaults to `true` (a slash `\footnote` inserts an empty body).
     */
    pristine?: boolean;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => { footnoteId: string } | null;
  createCitation: (opts: {
    command?: string;
    /** Pre-allocated id for the panel ref. Use when the caller has
     *  already inserted the matching inline citation atom into the editor
     *  with this id, so the panel ref and the atom share an identity and
     *  the card renders as anchored. */
    citationId?: string;
    unanchored?: boolean;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => CitationRef;
  /** Archive snippet — created post-extraction (the dispatcher slices the
   *  doc content first, then hands the content + the surviving paragraph
   *  uuid in here). Mode A link is written when `paragraphId` is given.
   *  See ACTION-MENU-DIAGNOSIS.md cluster C4 — this peer of `createNote`
   *  etc. retires the five ad-hoc archive deps that used to live on the
   *  dispatcher. */
  createArchiveSnippet: (opts: {
    /** Initial plain-text content (used when rich `content` isn't given,
     *  e.g. for empty/blank archives spawned from a button). */
    text?: string;
    /** Rich JSON content snapshot. Overrides `text` when present. */
    content?: unknown;
    paragraphId?: string | null;
    targetKind?: TextObjectKind;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  } & AutoFocusOpt) => ArchivedSnippet;
}

export function useCardCreation(deps: CardCreationDeps): CardCreationApi {
  const {
    editorRef,
    addNote,
    addHighlight,
    deleteNote,
    addCutterComment,
    addCutterSuggestion,
    addRevisionComment,
    addRevisionSuggestion,
    addReport,
    addReportRequest,
    addTodo,
    updateTodo,
    addTodoTextObjectId,
    setTodoAnchor,
    addCitation,
    archiveContent,
    updateArchiveSnippet,
    addArchiveTextObjectId,
    setSelectedArchiveId,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedReportCardId,
    setSelectedCommentId,
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedCitationId,
    prefs,
    setActiveLeft,
    setActiveRight,
    popCardAtAnchor,
    markFootnotePristine,
    getFootnoteCount,
    recentlyAdded,
    store,
  } = deps;

  const pin = useCallback(
    (kind: RecentlyAddedKind, id: string) => {
      recentlyAdded?.markAdded(kind, id);
    },
    [recentlyAdded],
  );

  const ensurePanelActive = useCallback(
    (id: PanelId) => {
      // Idempotence guard: skip the opener when the panel is already docked on
      // its side. The opener is internally idempotent, but an unconditional
      // call still churns the dock MRU + fires a spurious openPanel.
      if (isPanelDocked(prefs, id)) return;
      const placement = prefs.placements.find((p) => p.id === id);
      const side = placement?.side ?? "right";
      if (side === "left") setActiveLeft(id);
      else setActiveRight(id);
    },
    [prefs, setActiveLeft, setActiveRight],
  );

  // When `anchorRect` is provided (every Actions-toolbar path), the new
  // card is popped as a floating popup and the underlying panel is left
  // untouched — opening both the float and the panel is redundant and
  // disruptive. In-panel "+" paths don't pass `anchorRect`, so they still
  // activate the panel (a no-op in practice since the panel is already
  // visible).
  const fromToolbar = (opts: { anchorRect?: DOMRect | null }) => opts.anchorRect !== undefined;

  /**
   * Shared post-create tail for every factory: select the new card (through
   * the kind's existing per-panel setter), pin it to the top of its panel, then
   * surface it — either as a floating popup at the trigger rect (the toolbar
   * path) or by activating its panel on the placed side (the in-panel "+"
   * path). The omni-view path leaves the panel alone.
   *
   * CREATION FOCUS (CHIP B — drop the caret into the new card's body): for a
   * USER-INITIATED create of an editable-body kind, we additionally EXPAND the
   * card (so its body mounts) + mark it selected in the shared `cardStore` (so
   * the body renders) + call the SSOT `focusNewCard` helper (which retries past
   * the async mount and drops the caret into the kind-appropriate editable). The
   * old "NEVER expand" rule on this tail was about *selecting an existing* card
   * (selection = halo, not body-open); *creating* a card the user means to type
   * into is the opposite intent, so the expand is scoped to the creation path.
   * `autoFocus` (default `true`) gates it: AI/programmatic callers pass `false`
   * so they never steal focus while the user is doing something else.
   *
   * `kind` is the canonical CardKind (drives the float key + the derived
   * panel). `pinToken` is the parallel `RecentlyAddedKind` enum's bucket —
   * NOT 1:1 with CardKind (e.g. cutter-comment/suggestion both pin "cutter",
   * report/report-request both pin "reports", revision-* both pin "revision").
   * TODO(A3-followup): reconcile RecentlyAddedKind onto the card registry so
   * this second token can go away.
   */
  const finishCreate = useCallback(
    (
      kind: CardKind,
      pinToken: RecentlyAddedKind,
      setSelected: (id: string) => void,
      id: string,
      opts: { mode?: CardCreateMode; anchorRect?: DOMRect | null; autoFocus?: boolean },
    ) => {
      // Suppress card→text placement for THIS selection change. A brand-new
      // card is already surfaced at the right spot — floated at its anchorRect
      // (toolbar/grab-bar paths) or pinned to its panel — so the editor must
      // NOT scroll to "align" it. Without this, the `setSelected` below trips
      // usePlacement's effect, whose `alignEntryToY` drags the shared row
      // scroll: the "creating a footnote/citation jumps the viewport" bug.
      // Mirrors marker-clicks.ts, the only other suppressor (same asymmetry
      // rule: usePlacement owns card→text; create surfaces text→card itself).
      suppressNextPlacement();
      setSelected(id);
      pin(pinToken, id);
      // Drop the caret into the new card's body (CHIP B). User-initiated
      // (`autoFocus` defaults true); editable-body kinds only — `focusNewCard`
      // is self-gating (returns a null target for bodiless kinds), but we also
      // gate the EXPAND so a bodiless/citation card isn't needlessly opened.
      // The citation carve-out lives in `cardKindHasEditableBody` (its create
      // popover owns its own focus).
      if (opts.autoFocus !== false && cardKindHasEditableBody(kind)) {
        // Expand so the RichTextField body actually mounts (a compressed card
        // has no contenteditable for `focusNewCard` to find) + select in the
        // shared store so the card paints as the active one. Both are
        // single store writes — no per-keystroke work.
        store.expand({ kind, id });
        store.select({ kind, id });
        focusNewCard(cardPopKey(kind, id));
      }
      if (opts.mode === "omni") return;
      if (fromToolbar(opts)) popCardAtAnchor(kind, id, opts.anchorRect!);
      // Every creatable kind owns a panel (panelForCardKind is non-null for
      // all 13 factories); the assertion documents that invariant.
      else ensurePanelActive(panelForCardKind(kind)!);
    },
    [store, pin, ensurePanelActive, popCardAtAnchor],
  );

  const createNote = useCallback<CardCreationApi["createNote"]>(
    (opts) => {
      const note = addNote(opts.paragraphId ?? null, opts.content, opts.anchor, opts.targetKind);
      finishCreate("note", "note", setSelectedNoteId, note.id, opts);
      return note;
    },
    [addNote, setSelectedNoteId, finishCreate],
  );

  const createHighlight = useCallback<CardCreationApi["createHighlight"]>(
    (opts) => {
      const card = addHighlight(opts.anchor, opts.paragraphId ?? null, opts.color ?? null);
      finishCreate("highlight", "highlight", setSelectedNoteId, card.id, opts);
      return card;
    },
    [addHighlight, setSelectedNoteId, finishCreate],
  );

  // R14: `addNoteForHighlight` (the one-way "+ note" morph) is removed —
  // note ⇄ highlight is now BIDIRECTIONAL via the A9 kind-chevron, routed
  // through EditorPane's `convertCardWithRemap` chokepoint.

  const deleteHighlightOrNote = useCallback<CardCreationApi["deleteHighlightOrNote"]>(
    // Mark cleanup is enforced centrally by `useLinkedAnchorReconciler`,
    // which strips any `linkedAnchor` whose backing card is no longer
    // alive in {notes, highlights, cutterCards, comments}. So this path
    // just drops the sidecar entry; the in-doc tint clears on the next
    // render commit.
    (id) => { deleteNote(id); },
    [deleteNote],
  );

  const createCutterComment = useCallback<CardCreationApi["createCutterComment"]>(
    (opts) => {
      const card = addCutterComment(
        opts.paragraphId ?? null,
        opts.content,
        opts.anchor,
        opts.targetKind,
      );
      finishCreate("cutter-comment", "cutter", setSelectedCutterCardId, card.id, opts);
      return card;
    },
    [addCutterComment, setSelectedCutterCardId, finishCreate],
  );

  const createCutterSuggestion = useCallback<
    CardCreationApi["createCutterSuggestion"]
  >(
    (opts) => {
      const card = addCutterSuggestion(
        opts.paragraphId ?? null,
        opts.originalText,
        opts.anchor,
      );
      finishCreate("cutter-suggestion", "cutter", setSelectedCutterCardId, card.id, opts);
      return card;
    },
    [addCutterSuggestion, setSelectedCutterCardId, finishCreate],
  );

  const createReport = useCallback<CardCreationApi["createReport"]>(
    (opts) => {
      const card = addReport(
        opts.paragraphId ?? null,
        opts.content,
        opts.anchor,
        opts.targetKind,
      );
      finishCreate("report", "reports", setSelectedReportCardId, card.id, opts);
      return card;
    },
    [addReport, setSelectedReportCardId, finishCreate],
  );

  const createReportRequest = useCallback<CardCreationApi["createReportRequest"]>(
    (opts) => {
      const card = addReportRequest(
        opts.paragraphId ?? null,
        opts.content,
        opts.anchor,
        opts.targetKind,
      );
      finishCreate("report-request", "reports", setSelectedReportCardId, card.id, opts);
      return card;
    },
    [addReportRequest, setSelectedReportCardId, finishCreate],
  );

  const createRevisionRequest = useCallback<
    CardCreationApi["createRevisionRequest"]
  >(
    (opts) => {
      const card = addRevisionComment(
        opts.paragraphId ?? null,
        opts.content,
        opts.anchor,
        opts.targetKind,
      );
      finishCreate("revision-comment", "revision", setSelectedCommentId, card.id, opts);
      return card;
    },
    [addRevisionComment, setSelectedCommentId, finishCreate],
  );

  const createRevisionSuggestion = useCallback<
    CardCreationApi["createRevisionSuggestion"]
  >(
    (opts) => {
      const card = addRevisionSuggestion(
        opts.paragraphId ?? null,
        opts.originalText,
        opts.anchor,
      );
      finishCreate("revision-suggestion", "revision", setSelectedCommentId, card.id, opts);
      return card;
    },
    [addRevisionSuggestion, setSelectedCommentId, finishCreate],
  );

  const createTodo = useCallback<CardCreationApi["createTodo"]>(
    (opts) => {
      const todo = addTodo();
      if (opts.text) updateTodo(todo.id, opts.text);
      // Mode-A paragraph link first (mirrors `addNote`): record the
      // containing paragraph, THEN fold it into the canonical Mode-B
      // anchor link if a range anchor was dropped. `setTextAnchorLink`
      // reads the just-added paragraph ids, so order matters.
      if (opts.paragraphId) addTodoTextObjectId(todo.id, opts.paragraphId, opts.targetKind);
      if (opts.anchor) {
        setTodoAnchor(todo.id, opts.anchor.anchorId, opts.anchor.anchorText);
      }
      finishCreate("todo", "todo", setSelectedTodoId, todo.id, opts);
      return todo;
    },
    [addTodo, updateTodo, addTodoTextObjectId, setTodoAnchor, setSelectedTodoId, finishCreate],
  );

  const createFootnote = useCallback<CardCreationApi["createFootnote"]>(
    (opts) => {
      const handle = editorRef.current;
      if (!handle) return null;
      // ── ADOPT path (CHIP 4b: slash / typed) ──────────────────────────
      // The PM caller already inserted the `\footnote{}` atom synchronously
      // and passed its id. Re-inserting via `createEmptyFootnote` would
      // DOUBLE-insert, so we skip the insert and run ONLY the shared tail —
      // the SAME pristine + pin + select the menu's blank footnote gets, now
      // applied to the already-landed atom. (Pristine ⇒ a blank footnote is
      // click-away-discardable; pin ⇒ it rides the top of the panel.)
      if (opts.existingFootnoteId) {
        handle.renumberFootnotes();
        // Pristine ⇒ a BLANK footnote is click-away-discardable. The slash
        // `\footnote` (empty body) is pristine, matching the menu; a typed
        // `\footnote{body}` carries real content, so the caller passes
        // `pristine:false` to keep the discard watcher from reaping it.
        if (opts.pristine !== false) markFootnotePristine(opts.existingFootnoteId);
        finishCreate(
          "footnote",
          "footnote",
          setSelectedFootnoteId,
          opts.existingFootnoteId,
          opts,
        );
        return { footnoteId: opts.existingFootnoteId };
      }
      // BUG #31: never persist a generated title ("Footnote 2"). Leave the
      // title empty so the collapsed view + expanded title row show the
      // placeholder / +T affordance until the user types a real title.
      const result = opts.fromSelection
        ? handle.createFootnoteFromSelection({ title: "" })
        : handle.createEmptyFootnote({ title: "" });
      if (!result) return null;
      handle.renumberFootnotes();
      if (!opts.fromSelection) markFootnotePristine(result.footnoteId);
      finishCreate("footnote", "footnote", setSelectedFootnoteId, result.footnoteId, opts);
      return result;
    },
    [editorRef, markFootnotePristine, setSelectedFootnoteId, finishCreate, getFootnoteCount],
  );

  const createArchiveSnippet = useCallback<
    CardCreationApi["createArchiveSnippet"]
  >(
    (opts) => {
      const snippet = archiveContent(opts.text ?? "");
      if (opts.content !== undefined) {
        updateArchiveSnippet(snippet.id, opts.content);
      }
      if (opts.paragraphId) {
        addArchiveTextObjectId(snippet.id, opts.paragraphId, opts.targetKind);
      }
      finishCreate("archive", "archive", setSelectedArchiveId, snippet.id, opts);
      return snippet;
    },
    [
      archiveContent,
      updateArchiveSnippet,
      addArchiveTextObjectId,
      setSelectedArchiveId,
      finishCreate,
    ],
  );

  const createCitation = useCallback<CardCreationApi["createCitation"]>(
    (opts) => {
      const ref = addCitation(
        opts.command ?? "\\cite{}",
        opts.citationId,
        opts.unanchored ?? true,
      );
      finishCreate("citation", "citation", setSelectedCitationId, ref.id, opts);
      return ref;
    },
    [addCitation, setSelectedCitationId, finishCreate],
  );

  return useMemo<CardCreationApi>(
    () => ({
      createNote,
      createHighlight,
      deleteHighlightOrNote,
      createCutterComment,
      createCutterSuggestion,
      createReport,
      createReportRequest,
      createRevisionRequest,
      createRevisionSuggestion,
      createTodo,
      createFootnote,
      createCitation,
      createArchiveSnippet,
    }),
    [
      createNote,
      createHighlight,
      deleteHighlightOrNote,
      createCutterComment,
      createCutterSuggestion,
      createReport,
      createReportRequest,
      createRevisionRequest,
      createRevisionSuggestion,
      createTodo,
      createFootnote,
      createCitation,
      createArchiveSnippet,
    ],
  );
}
