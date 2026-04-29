import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
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
  addTodoParagraphId: (id: string, paragraphId: string) => void;
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

export interface CardCreationApi {
  createNote: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
  }) => UserNote;
  createCutterComment: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
  }) => CutterCommentCard;
  createCutterSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
  }) => CutterSuggestionCard;
  createRevisionComment: (opts: {
    paragraphId?: string | null;
    content?: JSONContent;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
  }) => RevisionCommentCard;
  createRevisionSuggestion: (opts: {
    paragraphId?: string | null;
    originalText?: string;
    anchor?: AnchorRef;
    anchorRect?: DOMRect | null;
  }) => RevisionSuggestionCard;
  createTodo: (opts: {
    text?: string;
    paragraphId?: string | null;
    anchorRect?: DOMRect | null;
  }) => TodoItem;
  createFootnote: (opts: {
    fromSelection?: boolean;
    anchorRect?: DOMRect | null;
  }) => { footnoteId: string } | null;
  createQuotation: (opts: {
    text?: string;
    paragraphId?: string | null;
    anchorRect?: DOMRect | null;
  }) => QuotationGroup;
  createCitation: (opts: {
    command?: string;
    unanchored?: boolean;
    anchorRect?: DOMRect | null;
  }) => CitationRef;
}

export function useCardCreation(deps: CardCreationDeps): CardCreationApi {
  const {
    editorRef,
    addNote,
    addCutterComment,
    addCutterSuggestion,
    addRevisionComment,
    addRevisionSuggestion,
    addTodo,
    updateTodo,
    addTodoParagraphId,
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
      if (fromToolbar(opts)) popCardAtAnchor("note", note.id, opts.anchorRect!);
      else ensurePanelActive("notes");
      return note;
    },
    [addNote, setSelectedNoteId, pin, ensurePanelActive, popCardAtAnchor],
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
      if (opts.paragraphId) addTodoParagraphId(todo.id, opts.paragraphId);
      setSelectedTodoId(todo.id);
      pin("todo", todo.id);
      if (fromToolbar(opts)) popCardAtAnchor("todo", todo.id, opts.anchorRect!);
      else ensurePanelActive("todo");
      return todo;
    },
    [addTodo, updateTodo, addTodoParagraphId, setSelectedTodoId, pin, ensurePanelActive, popCardAtAnchor],
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
      if (fromToolbar(opts)) popCardAtAnchor("quotation", group.id, opts.anchorRect!);
      else ensurePanelActive("quotations");
      return group;
    },
    [addQuotationGroup, setSelectedQuotationGroupId, pin, ensurePanelActive, popCardAtAnchor],
  );

  const createCitation = useCallback<CardCreationApi["createCitation"]>(
    (opts) => {
      const ref = addCitation(opts.command ?? "\\cite{}", undefined, opts.unanchored ?? true);
      setSelectedCitationId(ref.id);
      pin("citation", ref.id);
      if (fromToolbar(opts)) popCardAtAnchor("citation", ref.id, opts.anchorRect!);
      else ensurePanelActive("citations");
      return ref;
    },
    [addCitation, setSelectedCitationId, pin, ensurePanelActive, popCardAtAnchor],
  );

  return useMemo<CardCreationApi>(
    () => ({
      createNote,
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
