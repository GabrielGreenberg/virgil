import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
  HighlightCard,
  NoteCardItem,
  CutterCommentCard,
  CutterSuggestionCard,
  RevisionCommentCard,
  RevisionSuggestionCard,
  TodoItem,
  QuotationGroup,
  CitationRef,
} from "@/lib/types";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import { nextCardTitle } from "@/panels/panel-registry";
import { getTextAnchor } from "@/links/links";
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
  ) => UserNote;
  addHighlight: (
    anchor: AnchorRef,
    paragraphId: string | null,
    color?: string | null,
  ) => HighlightCard;
  /** Notes panel's current cards (note + highlight union). Used by
   *  `addNoteForHighlight` / `deleteHighlightOrNote` to look up the live
   *  card by id without forcing those callers to thread the hook through
   *  their own props. */
  notesCards: NoteCardItem[];
  deleteNote: (id: string) => void;
  addCutterComment: (
    paragraphId: string | null,
    content?: JSONContent,
    anchor?: AnchorRef,
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
  ) => RevisionCommentCard;
  addRevisionSuggestion: (
    paragraphId: string | null,
    originalText?: string,
    anchor?: AnchorRef,
  ) => RevisionSuggestionCard;
  addTodo: () => TodoItem;
  updateTodo: (id: string, text: string) => void;
  addTodoTextObjectId: (id: string, paragraphId: string) => void;
  addQuotationGroup: (init?: { text?: string; paragraphId?: string | null }) => QuotationGroup;
  addCitation: (command: string, existingId?: string, unanchored?: boolean) => CitationRef;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedCutterCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setSelectedTodoId: Dispatch<SetStateAction<string | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedQuotationGroupId: Dispatch<SetStateAction<string | null>>;
  setSelectedCitationId: Dispatch<SetStateAction<string | null>>;
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  popCardAtAnchor: (kind: string, id: string, anchorRect: DOMRect | null) => void;
  markFootnotePristine: (id: string) => void;
  /** Total footnote count (anchored + orphans) the panel currently
   *  shows. Used to seed the auto-title of newly created footnotes. */
  getFootnoteCount: () => number;
  /** Optional tracker that pins the just-added card to the top of its
   *  panel until the user moves selection elsewhere. */
  recentlyAdded?: RecentlyAddedTracker | null;
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

export interface CardCreationApi {
  createNote: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => UserNote;
  createHighlight: (opts: {
    /** Mandatory — highlights are always a text-range gesture. */
    anchor: AnchorRef;
    paragraphId?: string | null;
    color?: string | null;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => HighlightCard;
  /** Spawn a sibling Note card anchored to the same text range as the
   *  given highlight. The highlight is left untouched (yellow tint stays);
   *  the new note shares the highlight's `anchorId` so no new in-doc mark
   *  is created. */
  addNoteForHighlight: (highlightId: string) => UserNote | null;
  /** Delete a note OR highlight by id. For highlights, also strips the
   *  in-doc `linkedAnchor` mark so the yellow tint goes away. */
  deleteHighlightOrNote: (id: string) => void;
  createCutterComment: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => CutterCommentCard;
  createCutterSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => CutterSuggestionCard;
  createRevisionComment: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => RevisionCommentCard;
  createRevisionSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => RevisionSuggestionCard;
  createTodo: (opts: {
    text?: string;
    paragraphId?: string | null;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => TodoItem;
  createFootnote: (opts: {
    fromSelection?: boolean;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => { footnoteId: string } | null;
  createQuotation: (opts: {
    text?: string;
    paragraphId?: string | null;
    anchorRect?: DOMRect | null;
    mode?: CardCreateMode;
  }) => QuotationGroup;
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
  }) => CitationRef;
}

export function useCardCreation(deps: CardCreationDeps): CardCreationApi {
  const {
    editorRef,
    addNote,
    addHighlight,
    notesCards,
    deleteNote,
    addCutterComment,
    addCutterSuggestion,
    addRevisionComment,
    addRevisionSuggestion,
    addTodo,
    updateTodo,
    addTodoTextObjectId,
    addQuotationGroup,
    addCitation,
    setSelectedNoteId,
    setSelectedCutterCardId,
    setSelectedCommentId,
    setSelectedTodoId,
    setSelectedFootnoteId,
    setSelectedQuotationGroupId,
    setSelectedCitationId,
    prefs,
    setActiveLeft,
    setActiveRight,
    popCardAtAnchor,
    markFootnotePristine,
    getFootnoteCount,
    recentlyAdded,
  } = deps;

  const pin = useCallback(
    (kind: RecentlyAddedKind, id: string) => {
      recentlyAdded?.markAdded(kind, id);
    },
    [recentlyAdded],
  );

  const ensurePanelActive = useCallback(
    (id: PanelId) => {
      const placement = prefs.placements.find((p) => p.id === id);
      const side = placement?.side ?? "right";
      if (side === "left") {
        if (prefs.activeLeft !== id) setActiveLeft(id);
      } else {
        if (prefs.activeRight !== id) setActiveRight(id);
      }
    },
    [prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight],
  );

  // When `anchorRect` is provided (every Actions-toolbar path), the new
  // card is popped as a floating popup and the underlying panel is left
  // untouched — opening both the float and the panel is redundant and
  // disruptive. In-panel "+" paths don't pass `anchorRect`, so they still
  // activate the panel (a no-op in practice since the panel is already
  // visible).
  const fromToolbar = (opts: { anchorRect?: DOMRect | null }) => opts.anchorRect !== undefined;

  const createNote = useCallback<CardCreationApi["createNote"]>(
    (opts) => {
      const note = addNote(opts.paragraphId ?? null, opts.content, opts.anchor);
      setSelectedNoteId(note.id);
      pin("note", note.id);
      if (opts.mode === "omni") return note;
      if (fromToolbar(opts)) popCardAtAnchor("note", note.id, opts.anchorRect!);
      else ensurePanelActive("notes");
      return note;
    },
    [addNote, setSelectedNoteId, pin, ensurePanelActive, popCardAtAnchor],
  );

  const createHighlight = useCallback<CardCreationApi["createHighlight"]>(
    (opts) => {
      const card = addHighlight(opts.anchor, opts.paragraphId ?? null, opts.color ?? null);
      setSelectedNoteId(card.id);
      pin("highlight", card.id);
      if (opts.mode === "omni") return card;
      if (fromToolbar(opts))
        popCardAtAnchor("highlight", card.id, opts.anchorRect!);
      else ensurePanelActive("notes");
      return card;
    },
    [addHighlight, setSelectedNoteId, pin, ensurePanelActive, popCardAtAnchor],
  );

  const addNoteForHighlight = useCallback<CardCreationApi["addNoteForHighlight"]>(
    (highlightId) => {
      const highlight = notesCards.find(
        (c): c is HighlightCard => c.kind === "highlight" && c.id === highlightId,
      );
      if (!highlight) return null;
      const textAnchor = getTextAnchor(highlight);
      const pids = highlight.links
        .flatMap((l) => (l.anchor.type === "anchor" ? l.anchor.paragraphIds : []));
      const paragraphId = pids[0] ?? null;
      // The new note shares the highlight's existing `linkedAnchor` mark
      // by referencing the same `anchorId` — no new mark is created, so
      // the highlight's `tintColor` survives. Deleting the highlight
      // strips the mark; the note's textRange link goes stale but its
      // paragraph anchor still holds the note in the panel.
      const anchor = textAnchor
        ? { anchorId: textAnchor.anchorId, anchorText: textAnchor.anchorText }
        : undefined;
      const note = addNote(paragraphId, undefined, anchor);
      setSelectedNoteId(note.id);
      pin("note", note.id);
      return note;
    },
    [notesCards, addNote, setSelectedNoteId, pin],
  );

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
      );
      setSelectedCutterCardId(card.id);
      pin("cutter", card.id);
      if (opts.mode === "omni") return card;
      if (fromToolbar(opts))
        popCardAtAnchor("cutter-comment", card.id, opts.anchorRect!);
      else ensurePanelActive("cutter");
      return card;
    },
    [
      addCutterComment,
      setSelectedCutterCardId,
      pin,
      ensurePanelActive,
      popCardAtAnchor,
    ],
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
      setSelectedCutterCardId(card.id);
      pin("cutter", card.id);
      if (opts.mode === "omni") return card;
      if (fromToolbar(opts))
        popCardAtAnchor("cutter-suggestion", card.id, opts.anchorRect!);
      else ensurePanelActive("cutter");
      return card;
    },
    [
      addCutterSuggestion,
      setSelectedCutterCardId,
      pin,
      ensurePanelActive,
      popCardAtAnchor,
    ],
  );

  const createRevisionComment = useCallback<
    CardCreationApi["createRevisionComment"]
  >(
    (opts) => {
      const card = addRevisionComment(
        opts.paragraphId ?? null,
        opts.content,
        opts.anchor,
      );
      setSelectedCommentId(card.id);
      pin("revision", card.id);
      if (opts.mode === "omni") return card;
      if (fromToolbar(opts))
        popCardAtAnchor("revision", card.id, opts.anchorRect!);
      else ensurePanelActive("revisions");
      return card;
    },
    [
      addRevisionComment,
      setSelectedCommentId,
      pin,
      ensurePanelActive,
      popCardAtAnchor,
    ],
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
      setSelectedCommentId(card.id);
      pin("revision", card.id);
      if (opts.mode === "omni") return card;
      if (fromToolbar(opts))
        popCardAtAnchor("revision-suggestion", card.id, opts.anchorRect!);
      else ensurePanelActive("revisions");
      return card;
    },
    [
      addRevisionSuggestion,
      setSelectedCommentId,
      pin,
      ensurePanelActive,
      popCardAtAnchor,
    ],
  );

  const createTodo = useCallback<CardCreationApi["createTodo"]>(
    (opts) => {
      const todo = addTodo();
      if (opts.text) updateTodo(todo.id, opts.text);
      if (opts.paragraphId) addTodoTextObjectId(todo.id, opts.paragraphId);
      setSelectedTodoId(todo.id);
      pin("todo", todo.id);
      if (opts.mode === "omni") return todo;
      if (fromToolbar(opts)) popCardAtAnchor("todo", todo.id, opts.anchorRect!);
      else ensurePanelActive("todo");
      return todo;
    },
    [addTodo, updateTodo, addTodoTextObjectId, setSelectedTodoId, pin, ensurePanelActive, popCardAtAnchor],
  );

  const createFootnote = useCallback<CardCreationApi["createFootnote"]>(
    (opts) => {
      const handle = editorRef.current;
      if (!handle) return null;
      const title = nextCardTitle("footnote", getFootnoteCount());
      const result = opts.fromSelection
        ? handle.createFootnoteFromSelection({ title })
        : handle.createEmptyFootnote({ title });
      if (!result) return null;
      handle.renumberFootnotes();
      if (!opts.fromSelection) markFootnotePristine(result.footnoteId);
      setSelectedFootnoteId(result.footnoteId);
      pin("footnote", result.footnoteId);
      if (opts.mode === "omni") return result;
      if (fromToolbar(opts)) popCardAtAnchor("footnote", result.footnoteId, opts.anchorRect!);
      else ensurePanelActive("footnotes");
      return result;
    },
    [editorRef, markFootnotePristine, setSelectedFootnoteId, pin, ensurePanelActive, popCardAtAnchor, getFootnoteCount],
  );

  const createQuotation = useCallback<CardCreationApi["createQuotation"]>(
    (opts) => {
      const group =
        opts.text || opts.paragraphId
          ? addQuotationGroup({ text: opts.text, paragraphId: opts.paragraphId })
          : addQuotationGroup();
      setSelectedQuotationGroupId(group.id);
      pin("quotation", group.id);
      if (opts.mode === "omni") return group;
      if (fromToolbar(opts)) popCardAtAnchor("quotation", group.id, opts.anchorRect!);
      else ensurePanelActive("quotations");
      return group;
    },
    [addQuotationGroup, setSelectedQuotationGroupId, pin, ensurePanelActive, popCardAtAnchor],
  );

  const createCitation = useCallback<CardCreationApi["createCitation"]>(
    (opts) => {
      const ref = addCitation(
        opts.command ?? "\\cite{}",
        opts.citationId,
        opts.unanchored ?? true,
      );
      setSelectedCitationId(ref.id);
      pin("citation", ref.id);
      if (opts.mode === "omni") return ref;
      if (fromToolbar(opts)) popCardAtAnchor("citation", ref.id, opts.anchorRect!);
      else ensurePanelActive("citations");
      return ref;
    },
    [addCitation, setSelectedCitationId, pin, ensurePanelActive, popCardAtAnchor],
  );

  return useMemo<CardCreationApi>(
    () => ({
      createNote,
      createHighlight,
      addNoteForHighlight,
      deleteHighlightOrNote,
      createCutterComment,
      createCutterSuggestion,
      createRevisionComment,
      createRevisionSuggestion,
      createTodo,
      createFootnote,
      createQuotation,
      createCitation,
    }),
    [
      createNote,
      createHighlight,
      addNoteForHighlight,
      deleteHighlightOrNote,
      createCutterComment,
      createCutterSuggestion,
      createRevisionComment,
      createRevisionSuggestion,
      createTodo,
      createFootnote,
      createQuotation,
      createCitation,
    ],
  );
}
