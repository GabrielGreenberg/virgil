"use client";

import { useEditor, EditorContent, JSONContent, Editor } from "@tiptap/react";
import { pickProbeEditor } from "@/lib/active-editor-probe";
import { installKeystrokeLatencyProbe } from "@/lib/keystroke-latency-probe";
import { useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  collectLinksFromEditor,
  jumpToLink,
  jumpToCard,
  deleteLink,
} from "@/links/links";
import type { Link as VirgilLink, CardWithLinks } from "@/links/links";
import { applyLinkedAnchorsImpl } from "@/links/_shared/apply-linked-anchors";
import type { ModeBReapplyRecord } from "@/links/_shared/reapply-mode-b-anchors";
import { alignEntryToY, findEditorScrollFor, scrollHeadingToActiveLine } from "@/components/editor-layout/layout-scroll";
import {
  isAnchorableNode,
  isAnchorableAtom,
  MIME_CITATION,
  MIME_FOOTNOTE,
  MIME_TEXT_INSERT,
  isAnchorDrag,
  isEditorInsertDrag,
} from "@/lib/marginalia";
import { getAtomText } from "@/lib/atom-text";
import { registerDropTarget } from "@/components/drop-mode/target-registry";
// Side-effect import: registers every TextObject float body with the
// registry via `registerFloatBody`. Must run before any popout renders.
import "@/text-objects/floats";
import { generateShortId } from "@/lib/uuid";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { chromeAwareScrollMargin } from "@/lib/tiptap/chrome-scroll-margin";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { normalizeRichContent } from "@/lib/footnote-content";
import type { JSONContent as TipJSON } from "@tiptap/react";
import {
  walkJsonContentForCitations,
  stripFootnoteNestedCitation,
} from "./citation-doc-ops";
import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { ActiveTextObjectProvider } from "@/text-objects/active-text-object-context";
import { SelectionActionsMenu } from "./SelectionActionsMenu";
import { SlashCommandPopup } from "./SlashCommandPopup";
import { sectionFoldingPluginKey } from "@/lib/section-folding";
import {
  setTransientHighlights,
  clearTransientHighlights,
  TRANSIENT_HIGHLIGHT_COLOR,
} from "@/lib/tiptap/transient-highlight";
import type { HeadingTypePick } from "./HeadingTypeMenu";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { registerEditorMount } from "@/lib/editor-census-probe";

/**
 * Per-node LaTeX serialization cache for `\ex…\xe` example blocks.
 * ProseMirror nodes are immutable, so the same node reference always
 * produces the same LaTeX. The cache is hit on every `getExamples()`
 * call for examples that weren't touched by the latest transaction —
 * which is most of them, most of the time. Editing an example creates
 * a fresh node and forces one re-serialization. WeakMap so old nodes
 * are reclaimed when no longer referenced.
 */
const exampleLatexCache = new WeakMap<PMNode, string>();

// resolveAnchorableNode + ensureAnchorUuid moved to @/lib/anchor-uuid

interface EditorProps {
  initialContent: JSONContent;
  /** Called per docChanged transaction with the live editor instance.
   *  Pass-by-reference (not getJSON snapshot) so downstream consumers
   *  can defer O(doc-size) serialization to inside their own debounce
   *  timers — see useDocument.ts / editor-ops.ts handleUpdate. The second
   *  arg is TipTap's update-event transaction, threaded so the autosave can
   *  recognise an anchor-mint tx and flush immediately (anchor-mint-signal). */
  onUpdate: (editor: Editor, tx?: import("@tiptap/pm/state").Transaction) => void;
  highlightText: string | null;
  /** Position-based highlight (from search panel). Takes priority over highlightText. */
  highlightRange: { from: number; to: number } | null;
  onAddComment?: () => void;
  onArchive?: () => void;
  onEditorReady?: (editor: Editor) => void;
  onCitationDrop?: (command: string, citationId?: string) => { id: string; displayText: string } | null;
  /**
   * Called when the user drops an anchored footnote from the panel back
   * into the document. Resolving `true` causes the move to go through;
   * `false` cancels. Used to surface an in-app confirmation dialog
   * instead of the native `window.confirm`. When omitted, Editor falls
   * back to the native dialog.
   */
  onConfirmFootnoteMove?: () => Promise<boolean>;
  /**
   * Called when the user renames the label on a heading that has
   * existing `\ref` pods pointing to it. Resolving `true` causes the
   * refs to be rewritten to the new label in the same transaction;
   * `false` leaves them pointing at the old (now orphaned) key. When
   * omitted, Editor applies the heading rename without prompting.
   */
  onConfirmLabelRename?: (
    oldLabel: string,
    newLabel: string,
    refCount: number,
  ) => Promise<boolean>;
  /**
   * Predicate consulted by the heading label editor while the user
   * types — returns `true` when the candidate key is already claimed by
   * another `\label{...}` declaration in the doc. The editor surfaces a
   * "label already in use" warning beneath the input when so. Wired
   * centrally via `src/lib/labels.ts`.
   */
  isLabelTaken?: (candidate: string, excludeLabel: string | null) => boolean;
  /** Ref to a Set of paragraph UUIDs that have marginalia anchored to them */
  anchoredUuidsRef?: React.RefObject<Set<string>>;
  /* NOTE (task 120): `activeAnchorId` / `activeAnchorColor` used to live here
   * and drove a third branch of `applyHighlight`. They were a migration orphan
   * — NOTHING ever passed them (the sole `<VirgilEditor>` mount is in
   * `EditorPane`, with no spread), so the branch was unreachable. The
   * linked-anchor hover/selection highlight is owned by `useLinkHighlight`
   * (the `data-link-highlight` CSS coupling on the `.linked-anchor` span) and
   * `AnchorHighlightDecorator` (the node/atom attrs). Both props and the branch
   * are gone; a future consumer paints through `setTransientHighlights`, which
   * takes a per-band color for exactly this shape. */
  /** Predicate reporting whether a given texBlock uuid is currently
   *  popped out. The TexBlock NodeView consults this on every render to
   *  toggle the `.is-popped` class on its wrapper (dim the in-doc pod
   *  while the float is open). Other kinds don't have an analogous
   *  in-doc affordance today; their `is-popped` predicates lived here
   *  only to drive the now-deleted per-NodeView grips. */
  texBlockIsPoppedRef?: React.RefObject<(uuid: string) => boolean>;
  /** Doc id, passed into the FigureBlock / GraphicsBlock extensions so
   *  their NodeViews can resolve `\includegraphics` paths against the
   *  active paper folder. `null` is fine — figures just won't render. */
  docId?: string | null;
  /**
   * When `false`, the TipTap editor mounts with `editable: false` and the
   * top-level drop / paste handlers no-op. Defaults to `true`. Used by
   * the Library Reader and by collab read-only mode (when a partner
   * holds the pen). Composition with collab's `setEditable(false)` is
   * automatic — both flip to read-only via the same `setEditable` API.
   */
  editable?: boolean;
  /**
   * Open the heading-type dropdown for the lozenge's type chip. Called
   * from the vanilla DOM node view; the EditorPane layer renders the
   * React `<HeadingTypeMenu>` and routes the user's pick back via
   * `onPick`. Omit to disable the dropdown (chip becomes static text).
   */
  onOpenHeadingTypeMenu?: (params: {
    anchorRect: DOMRect;
    currentLevel: number;
    onPick: (pick: HeadingTypePick) => void;
  }) => void;
  /**
   * Confirmation for the lozenge `×` button. Resolving `false` cancels
   * the delete. When omitted, the delete fires without prompting.
   */
  onConfirmHeadingDelete?: (typeName: string) => Promise<boolean>;
  /**
   * Confirmation for the figure lozenge `×` button. Resolving `false`
   * cancels the delete. When omitted, the delete fires without prompting.
   */
  onConfirmFigureDelete?: () => Promise<boolean>;
  /**
   * Documentclass name (e.g. "article", "report") used by the heading-
   * type dropdown to disable entries the class doesn't support. Pass
   * `null` (or omit) to show every entry as enabled — appropriate when
   * the class isn't known or is a custom `.cls`.
   */
  documentClass?: string | null;
}

export interface FootnoteInfo {
  footnoteId: string;
  content: TipJSON;
  number: number;
  pos: number;
  title?: string;
  thanks?: boolean;
}

export interface ExampleSubItem {
  /** "a" / "b" / "i" / etc. as assigned by the numbering plugin. */
  subLabel: string;
  /** `\label{…}` on the item, if any. */
  label: string;
  /** Angle-bracket `\a<tag>` tag, if any. */
  tag: string;
  /** Flattened plain text of the item body. */
  text: string;
  /** The item's body as JSONContent (a `doc`), so the Example card can render
   *  real inline atoms (citation / `\ref` / inline math) via BorrowedMainText
   *  instead of the flattened `text`. `null` for an empty item. Additive (A9
   *  §C1): existing consumers read `text`; only the card body reads this. */
  content: JSONContent | null;
}

export interface ExampleInfo {
  /** exampleBlock uuid (same value serialized as `\vexid{…}`). */
  exampleId: string;
  /** ProseMirror position of the exampleBlock node. */
  pos: number;
  /** Global example number as computed by the live numbering plugin. */
  number: number;
  /** "single" (`\ex`) or "multi" (`\pex`). */
  kind: "single" | "multi";
  /** Angle-bracket `\ex<tag>` tag, if any. */
  tag: string;
  /** Inner `\label{…}`, if any. */
  label: string;
  /** First ~80 chars of the example body, flattened to plain text. */
  preview: string;
  /** Sub-label range for multi-part examples (e.g. "a–c"), empty for single. */
  subLabelRange: string;
  /** Plain text from top-level paragraphs (`\ex` body before any `\a` items). */
  bodyText: string;
  /** Top-level body paragraphs as JSONContent (a `doc`), so the Example card
   *  can render real inline atoms (citation / `\ref` / inline math) via
   *  BorrowedMainText instead of the flattened `bodyText`. `null` when there's
   *  no top-level body. Additive (A9 §C1) — existing consumers read `bodyText`. */
  bodyContent: JSONContent | null;
  /** Top-level sub-items (one entry per `\a`). Empty for `\ex` with no items. */
  items: ExampleSubItem[];
  /** Round-trippable LaTeX source for the entire `\ex…\xe` block. */
  latex: string;
}

export interface EditorHandle {
  replaceText: (oldText: string, newText: string) => boolean;
  getEditor: () => Editor | null;
  // --- Heading-label callbacks, exposed for float proxying (FCU Chip B) ---
  // A popped-out heading float runs the SAME `createHeadingWithLabel`
  // NodeView as main but proxies its structural writes back to the main
  // editor. These three expose main's own label handlers so the float reads
  // the identical predicate / confirmations off `editorRef.current` and
  // threads them into the factory's `callbacks`. Each falls back to the
  // no-prop default the NodeView assumes (predicate→false, rename→false,
  // delete→true) when the host didn't supply the corresponding prop.
  /** True when `candidate` is already claimed by another `\label{…}`. */
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
  /** Confirm rewriting `\ref`s when a heading label is renamed. */
  onConfirmLabelRename: (
    oldLabel: string,
    newLabel: string,
    refCount: number,
  ) => Promise<boolean>;
  /** Confirm deleting a heading (unused from floats — delete is gated off
   *  there — but exposed for parity with the main NodeView). */
  onConfirmHeadingDelete: (typeName: string) => Promise<boolean>;
  getSelectedText: () => string;
  scrollToHeading: (blockIndex: number) => void;
  archiveSelection: (archiveId: string) => { content: unknown; paragraphId: string | null } | null;
  restoreArchive: (content: unknown) => void;
  getFootnotes: () => FootnoteInfo[];
  scrollToFootnote: (footnoteId: string, sourceEl?: HTMLElement | null) => void;
  updateFootnoteContent: (footnoteId: string, newContent: TipJSON) => void;
  updateFootnoteTitle: (footnoteId: string, title: string) => void;
  deleteFootnote: (footnoteId: string) => void;
  createFootnoteFromSelection: (opts?: { title?: string }) => { footnoteId: string } | null;
  /** Insert an empty footnote atom at the current cursor position (or
   *  the start of the doc if no cursor) and return its id. Used by
   *  toolbar actions that need to create a footnote regardless of
   *  whether text is selected. */
  createEmptyFootnote: (opts?: { title?: string }) => { footnoteId: string } | null;
  renumberFootnotes: () => void;
  getExamples: () => ExampleInfo[];
  scrollToExample: (exampleId: string, sourceEl?: HTMLElement | null) => void;
  // CHIP 5c: `insertExample` was RETIRED — the only caller was the now-retired
  // `virgil-ex-create` command-input bridge. Example creation is unified on
  // `exampleRun` (action-registry), reached by the slash `\ex` via the
  // EditorActions bridge and by the grid `ex` cell directly.
  getCitations: () => { citationId: string; command: string; displayText: string; pos: number }[];
  scrollToCitation: (citationId: string, sourceEl?: HTMLElement | null) => void;
  updateCitationDisplay: (citationId: string, displayText: string, command?: string) => void;
  getCitationIds: () => Set<string>;
  getCitationOrder: () => string[];
  insertCitation: (command: string, citationId: string, displayText: string) => void;
  /** Remove a `\cite` atom from the doc by its citationId. Mirrors
   *  `deleteFootnote`: builds an inline-atom link and routes through the
   *  shared `deleteLink` primitive, which no-ops if the atom isn't found
   *  (a draft / unanchored citation has no in-doc node). The sidecar
   *  entry is the caller's responsibility (see `handleDeleteCitation`). */
  deleteCitation: (citationId: string) => void;
  getActiveParagraphId: () => string | null;
  scrollToParagraphId: (uuid: string) => void;
  /** Jump to the first resolvable link on a card. Preferred over
   *  scrollToParagraphId for any card that carries a `links[]` — it picks
   *  the first anchor still present in the doc and respects Mode B
   *  text-range anchors. When `sourceEl` is provided, the in-text marker
   *  is aligned to that element's top edge (mirrors the marker→card
   *  alignment used when clicking links in text). */
  jumpToCard: (card: CardWithLinks, sourceEl?: HTMLElement | null) => boolean;
  /** Jump to a specific link. Exposed so callers (omni, popped-out cards)
   *  can target a particular anchor when a card has several. */
  jumpToLink: (link: VirgilLink) => void;
  /**
   * Returns the UUID of the paragraph (or list/heading with paragraph-like uuid)
   * containing the given doc position. If the node has no UUID yet, one is
   * generated and applied. Returns null if no eligible node is found.
   */
  ensureParagraphUuid: (pos: number) => string | null;
  /** Like ensureParagraphUuid but for the paragraph containing the current selection. */
  ensureActiveParagraphUuid: () => string | null;
  /** Resolve a screen-space (clientX, clientY) point to a paragraph UUID, ensuring one. */
  ensureParagraphUuidAtCoords: (x: number, y: number) => string | null;
  /** Returns paragraph UUIDs and their top offset (px) within the editor scroll container. */
  getParagraphPositions: () => Array<{ id: string; top: number }>;
  /** Scroll to a raw doc position (used by panel prev/next navigation). */
  scrollToPos: (pos: number) => void;
  /**
   * Re-apply / reconcile linked-anchor marks from sidecar records. Called once
   * per doc-open from the EditorPane load reconcile pass. Reconcile-not-skip:
   * a present mark whose kind/linkCard/tintColor disagrees with its record is
   * re-stamped in place (BUG1); an absent one is re-anchored by text snapshot
   * (records whose text isn't found are skipped). See `applyLinkedAnchorsImpl`.
   */
  applyLinkedAnchors: (records: ModeBReapplyRecord[]) => void;
  /** Collapse all top-level heading sections (fold every section). */
  collapseAllSections: () => void;
  /** Expand all previously folded sections. */
  expandAllSections: () => void;
  /** Set the folded-sections state to exactly the given heading UUIDs.
   *  UUIDs that no longer exist in the doc are silently dropped. Used to
   *  restore section folds from persisted UI state on reload. */
  setFolded: (uuids: string[]) => void;
  /** Place the cursor at the end of the paragraph with this UUID. Silently
   *  no-ops if the UUID is no longer in the doc. Used to restore the
   *  last-edited paragraph from persisted UI state on reload.
   *
   *  `scrollIntoView` (default true) controls whether the paragraph is
   *  ALSO scrolled into view. Pass `false` when a saved/live scroll offset
   *  is being restored by the pane's scroll-restoration owner — restoring
   *  the cursor must not fight the viewport. The selection (for resuming an
   *  edit) is restored either way; only the competing scroll is suppressed. */
  restoreCursorToParagraph: (
    uuid: string,
    opts?: { scrollIntoView?: boolean },
  ) => void;
}

// Citation collectors/mutators (including footnote-nested cites) live in a
// dedicated import-light module so the #38 data-integrity invariant — every
// place that COLLECTS a footnote-nested cite has a matching remover — is
// unit-testable without mounting this whole component. See citation-doc-ops.ts.

function findTextRange(editor: Editor, searchText: string): { from: number; to: number } | null {
  const text = editor.getText();
  const index = text.indexOf(searchText);
  if (index === -1) return null;

  let charCount = 0;
  let fromPos = -1;
  let toPos = -1;

  editor.state.doc.descendants((node, pos) => {
    if (fromPos !== -1 && toPos !== -1) return false;
    if (node.isText && node.text) {
      const nodeStart = charCount;
      const nodeEnd = charCount + node.text.length;

      if (fromPos === -1 && index >= nodeStart && index < nodeEnd) {
        fromPos = pos + (index - nodeStart);
      }
      if (fromPos !== -1 && toPos === -1) {
        const endIndex = index + searchText.length;
        if (endIndex <= nodeEnd) {
          toPos = pos + (endIndex - nodeStart);
        }
      }
      charCount = nodeEnd;
    }
    return true;
  });

  if (fromPos !== -1 && toPos !== -1) {
    return { from: fromPos, to: toPos };
  }
  return null;
}

// ── Dev keystroke-sanctity probe (multi-doc safe) ──────────────────────────
// `window.__virgilBusStats()` must read the editor being TYPED INTO so the
// "type N chars → emitCount stays flat" check stays trustworthy when N warm
// editors are mounted at once (multi-doc keep-alive). A single last-mount-wins
// global would read the wrong (often hidden) editor. We keep a registry of live
// editors and resolve the FOCUSED one on demand (falling back to the sole
// editor). Dev-only and lazy: the getter touches the bus only when called from
// the console — zero per-keystroke cost.
type BusStats = { emitCount: number; version: number; materializeCount: number };
const busStatsEditors = new Set<Editor>();
let busStatsInstalled = false;
function installBusStatsProbe() {
  if (busStatsInstalled || typeof window === "undefined") return;
  busStatsInstalled = true;
  void import("@/lib/tiptap/doc-structure").then(
    ({ getBus, peekStructureVersion, getMaterializeCount }) => {
      (
        window as unknown as { __virgilBusStats?: (() => BusStats | null) | null }
      ).__virgilBusStats = (): BusStats | null => {
        const ed = pickProbeEditor(busStatsEditors);
        if (!ed) return null;
        const bus = getBus(ed);
        if (!bus) return null;
        return {
          emitCount: bus.emitCount,
          // Peek, don't materialize — reading the probe must not itself
          // count as a consumer materialization, or the "typing leaves
          // materializeCount flat" criterion couldn't be checked.
          version: peekStructureVersion(ed.state),
          materializeCount: getMaterializeCount(),
        };
      };
    },
  );
}

const VirgilEditor = forwardRef<EditorHandle, EditorProps>(function VirgilEditor(
  { initialContent, onUpdate, highlightText, highlightRange, onAddComment, onArchive, onEditorReady, onCitationDrop, onConfirmFootnoteMove, onConfirmLabelRename, isLabelTaken, anchoredUuidsRef, texBlockIsPoppedRef, onOpenHeadingTypeMenu, onConfirmHeadingDelete, onConfirmFigureDelete, documentClass, editable = true, docId = null },
  ref
) {
  const highlightTextRef = useRef(highlightText);
  highlightTextRef.current = highlightText;
  const highlightRangeRef = useRef(highlightRange);
  highlightRangeRef.current = highlightRange;

  const onCitationDropRef = useRef(onCitationDrop);
  onCitationDropRef.current = onCitationDrop;
  // Track the user-facing read-only state in a ref so the inline PM
  // `filterTransaction` plugin (below) and the imperative drop handler
  // can read the current value without rebuilding the editor.
  //
  // We keep TipTap's `view.editable` at `true` regardless of the prop so
  // the DOM stays `contenteditable="true"` and PM continues to sync
  // native drag-to-select to `view.state.selection`. Read-only is
  // enforced separately by rejecting any transaction that touches the
  // doc. This is what unblocks the TextObjectGrabHandle in the Library
  // Reader — `contenteditable="false"` interferes with how some browsers
  // route user-initiated selection events to PM, which made the handle
  // never appear even though the wiring was correct end-to-end.
  const readOnlyRef = useRef(!editable);
  readOnlyRef.current = !editable;
  // Mirror of the user-facing `editable` prop in the positive sense,
  // threaded into buildEditorExtensions so the factory's readOnlyEnforcer
  // reads the same live value the former inline plugin read via
  // `readOnlyRef` (editableRef.current === !readOnlyRef.current).
  const editableRef = useRef(editable);
  editableRef.current = editable;
  // Stable ref to the live TipTap editor instance — used by the
  // TextObjectGrabHandle to subscribe to selectionUpdate / coords without
  // re-renders. Populated below via useEffect once `useEditor` returns
  // the instance.
  const editorInstanceRef = useRef<Editor | null>(null);
  // The texBlock NodeView reads this through its extension options to
  // mirror the "popped out" state into the in-doc rendering (dim the
  // pod while its float is open). Other kinds don't have an analogous
  // is-popped affordance today — their refs lived here only to drive
  // the now-deleted per-NodeView grips.
  const texBlockIsPoppedPredicateRef = useRef(texBlockIsPoppedRef);
  texBlockIsPoppedPredicateRef.current = texBlockIsPoppedRef;
  // docId mirror — FigureBlock / GraphicsBlock NodeViews read it via
  // `extension.options.docIdRef.current` to resolve `\includegraphics`
  // paths against the active paper folder.
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;
  // Mirror onConfirmFootnoteMove into a ref so the ProseMirror handleDrop
  // closure always sees the current value without needing to reattach.
  const onConfirmFootnoteMoveRef = useRef(onConfirmFootnoteMove);
  onConfirmFootnoteMoveRef.current = onConfirmFootnoteMove;
  // Same pattern for the label-rename confirmation — the heading node
  // view commits labels out of a DOM-level input callback that lives
  // inside the extension closure; a ref keeps it in sync across renders.
  const onConfirmLabelRenameRef = useRef(onConfirmLabelRename);
  onConfirmLabelRenameRef.current = onConfirmLabelRename;
  // Same ref dance for the label-conflict predicate — it's called
  // synchronously on every keystroke inside the heading label input.
  const isLabelTakenRef = useRef(isLabelTaken);
  isLabelTakenRef.current = isLabelTaken;
  // Heading lozenge controls: type-menu opener, delete confirmation, and
  // the live documentclass name. All consumed from inside the vanilla
  // DOM heading node view through the standard ref-mirror pattern.
  const onOpenHeadingTypeMenuRef = useRef(onOpenHeadingTypeMenu);
  onOpenHeadingTypeMenuRef.current = onOpenHeadingTypeMenu;
  const onConfirmHeadingDeleteRef = useRef(onConfirmHeadingDelete);
  onConfirmHeadingDeleteRef.current = onConfirmHeadingDelete;

  const onConfirmFigureDeleteRef = useRef(onConfirmFigureDelete);
  onConfirmFigureDeleteRef.current = onConfirmFigureDelete;
  const documentClassRef = useRef<string | null>(documentClass ?? null);
  documentClassRef.current = documentClass ?? null;

  // Chrome-aware scroll margin (Part B): an intentional scrollIntoView() (block
  // inserts, jump-to-link) lands BELOW the sticky MenuBar strip + top reading-mask
  // instead of beneath them. Read live off the editor DOM so a top-margin drag
  // (which mutates --editor-pt) stays correct without re-creating the editor.
  // Created once (the getters re-read at scroll time, so a stable object is fine).
  const editorViewDomRef = useRef<HTMLElement | null>(null);
  const chromeScrollMargin = useRef(
    chromeAwareScrollMargin(() => editorViewDomRef.current),
  ).current;

  const editor = useEditor({
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef,
      cardContext: false,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
        onOpenHeadingTypeMenu: onOpenHeadingTypeMenuRef,
        onConfirmFigureDelete: onConfirmFigureDeleteRef,
      },
      docIdRef,
      texBlockIsPoppedRef: texBlockIsPoppedPredicateRef,
      anchoredUuidsRef,
      host: null,
    }),
    content: initialContent,
    // Always mount PM with `editable: true` so the DOM stays
    // `contenteditable="true"` and the browser/PM duo continues to sync
    // native drag-to-select to `view.state.selection`. The user-facing
    // read-only flag is enforced by the `readOnlyEnforcer` plugin above
    // (rejects doc-modifying transactions) and the `readOnlyRef` guards
    // on the imperative drop / drag paths.
    editable: true,
    editorProps: {
      // Chrome-aware: intentional scrollIntoView() lands below the sticky top
      // chrome (MenuBar strip + reading-mask), not beneath it. Live-tracking
      // getters; see chrome-scroll-margin.ts.
      scrollMargin: chromeScrollMargin,
      attributes: {
        // Page padding driven by --editor-pl / --editor-pr / --editor-pt
        // / --editor-pb (set on the editor column from the persisted
        // user prefs `editor{Left,Right,Top,Bottom}Margin`, defaults
        // 88/72/40/40). The left default 88 = 72px marginalia margin
        // + 8px breathing strip for heading fold-chevron + extra.
        // Right 72 sits flush against the 72px right margin.
        //
        // L/R control prose column width directly (page padding).
        // T/B serve a dual role: they set the height of the persistent
        // top/bottom mask overlays (in EditorPane pod) AND match the
        // prose pt/pb so the document's first line stays visible just
        // below the top mask at scroll y=0 and the last line just
        // above the bottom mask at scroll max. Without the prose
        // padding, content at scroll extremes would be trapped behind
        // the mask bands.
        //
        // The "Margins…" ViewMenu mode renders draggable in-text guides
        // on all four sides that update these vars live.
        class:
          // `doc-prose-leadin` is a pure CSS hook (no behavior of its own):
          // it scopes the globals.css `.doc-prose-leadin::before` title
          // lead-in to THIS prose root — the main document editor and the
          // read-only Library Reader (which reuses this same Editor config,
          // so it inherits the marker → desired parity). The text-object
          // pop-out floats and lifted drag clones build their OWN bare
          // `.tiptap` class strings (they don't route through this config),
          // so they never inherit the 40px lead-in.
          "doc-prose-leadin prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] pl-[var(--editor-pl,88px)] pr-[var(--editor-pr,72px)] pt-[var(--editor-pt,40px)] pb-[var(--editor-pb,40px)]",
        // Grammarly's extension is a per-keystroke O(doc) DOM scanner for
        // users who have it installed; these attributes are its documented
        // opt-out and inert for everyone else. Native spellcheck stays ON
        // (prose editor; A/B-measured no per-keystroke cost).
        "data-gramm": "false",
        "data-gramm_editor": "false",
        "data-enable-grammarly": "false",
        // PM keeps the DOM at `contenteditable="true"` even in Reader
        // mode (so native drag-to-select reaches `view.state.selection`,
        // and the unified TextObjectGrabHandle / linkedRange-float flow
        // inherits from the main editor). Suppress the spellcheck
        // underlines that would otherwise appear under prose in
        // read-only docs.
        ...(editable ? {} : { spellcheck: "false" }),
      },
      handleDOMEvents: {
        // Every canonical text move is mousedown-driven, not HTML5 drag:
        // block drag-to-pop-out (the 6-dot lift), the inline-Atom grab
        // (footnote/citation/ref/inline math → InlineAtomGrab), and
        // drop-mode (the card drop-button grab). So native browser drags —
        // text-selection from contenteditable, an accidental node drag —
        // are suppressed here. No inline atom opts into native drag anymore;
        // the `[data-drag-handle]` / `[draggable="true"]` escape hatch is
        // kept as a general guard for any element that explicitly opts in.
        dragstart(view, event) {
          const rawTarget = event.target as Node | null;
          const target =
            rawTarget instanceof Element
              ? rawTarget
              : (rawTarget?.parentElement ?? null);
          if (!target) return false;
          if (target.closest("[data-drag-handle]")) return false;
          if (target.closest('[draggable="true"]')) return false;
          event.preventDefault();
          return true;
        },
        // Drop affordance for the sanctioned inline-insert drags the
        // `handleDrop` below accepts (citation / bib card, panel text, footnote
        // move). Without this the browser derives `dropEffect` from the source's
        // `effectAllowed` over the contenteditable surface and shows its native
        // green-plus `copy` cursor. Give these a clean `"move"` affordance
        // instead — cosmetic only; `handleDrop` is unchanged. The matching
        // sources advertise `effectAllowed = "copyMove"` so `"move"` isn't reset
        // to `"none"` here (while `"copy"` still works at the card/panel merge
        // targets). Non-sanctioned drags fall through to ProseMirror's built-in
        // `dragover` (which just `preventDefault()`s with the default effect).
        dragover(_view, event) {
          if (!isEditorInsertDrag(event.dataTransfer)) return false;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          return false;
        },
      },
      handleDrop(view, event) {
        // Read-only short-circuit: when the React `editable` prop is
        // false (Library Reader, collab read-only), every drop branch
        // below would mutate the doc — bail out before any of it fires.
        // The `readOnlyEnforcer` plugin would also reject the resulting
        // transaction, but stopping here avoids the custom side-effects
        // (UUID assignment, capture-stash bookkeeping, etc.) that those
        // branches perform alongside the dispatch.
        if (readOnlyRef.current) return false;

        // Paragraph-level anchor drags are no longer native HTML5 DnD — both
        // the panel→margin anchor (chip H PHASE 1) and the margin-pin re-anchor
        // (chip H PHASE 2) now flow through the unified drop-mode controller, so
        // no `handleDrop` branch handles them. This guard is the residual
        // suppressor (kept for `ANCHOR_DRAG_TYPES` if any anchor MIME is ever
        // re-introduced): returning false lets such a drop fall through rather
        // than be mistaken for an inline insert.
        if (isAnchorDrag(event.dataTransfer)) return false;

        // --- Citation drop ---
        const citData = event.dataTransfer?.getData(MIME_CITATION);
        if (citData && onCitationDropRef.current) {
          event.preventDefault();
          try {
            const { command, citationId } = JSON.parse(citData);
            const result = onCitationDropRef.current(command, citationId);
            if (!result) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;
            const node = view.state.schema.nodes.citation.create({
              citationId: result.id,
              command,
              displayText: result.displayText,
            });
            const tr = view.state.tr.insert(pos.pos, node);
            view.dispatch(tr);
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Text-only drop (from panel text handle) ---
        // Inserts raw text content inline — no anchoring, no entity identity.
        const textInsertData = event.dataTransfer?.getData(MIME_TEXT_INSERT);
        if (textInsertData) {
          event.preventDefault();
          try {
            const { content } = JSON.parse(textInsertData);
            if (!content) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true;
            const inlineJson: TipJSON[] = [];
            const walk = (n: TipJSON | undefined) => {
              if (!n) return;
              if (n.type === "paragraph") {
                if (inlineJson.length > 0) inlineJson.push({ type: "text", text: " " });
                (n.content || []).forEach((c) => inlineJson.push(c));
                return;
              }
              if (n.content) n.content.forEach(walk);
            };
            walk(content as TipJSON);
            if (inlineJson.length > 0) {
              const pmNodes = inlineJson
                .map((j) => {
                  try { return PMNode.fromJSON(view.state.schema, j); }
                  catch { return null; }
                })
                .filter(Boolean) as PMNode[];
              if (pmNodes.length > 0) {
                view.dispatch(view.state.tr.insert(posResult.pos, pmNodes));
              }
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Footnote drop (from panel) ---
        const fnData = event.dataTransfer?.getData(MIME_FOOTNOTE);
        if (fnData) {
          event.preventDefault();
          try {
            const { footnoteId, content, isOrphan } = JSON.parse(fnData);

            // Capture the drop target position synchronously — once we
            // return from handleDrop, the native drop event is gone and
            // we can't call view.posAtCoords with clientX/Y anymore.
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;
            const dropPos = pos.pos;

            // Apply the move against the editor's current state. Called
            // either immediately (orphan) or after the user confirms in
            // the in-app dialog (anchored footnote). Since the confirm
            // dialog is modal, the doc can't have drifted in between.
            const performMove = () => {
              let tr = view.state.tr;
              if (!isOrphan) {
                let oldPos: number | null = null;
                view.state.doc.descendants((node, npos) => {
                  if (node.type.name === "footnote" && node.attrs.footnoteId === footnoteId) {
                    oldPos = npos;
                    return false;
                  }
                  return true;
                });
                if (oldPos != null) {
                  tr = tr.delete(oldPos, oldPos + 1);
                }
              }
              const mappedPos = tr.mapping.map(dropPos);
              const newNode = view.state.schema.nodes.footnote.create({
                footnoteId,
                content,
                number: 0,
              });
              tr = tr.insert(mappedPos, newNode);
              view.dispatch(tr);

              const originDocId = docIdRef.current ?? null;
              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("virgil-footnote-panel-dropped", {
                    // `docId` scopes the orphan-clear to the originating doc's
                    // store so a re-drop in doc A can't clear a same-id orphan
                    // in doc B under multi-doc keep-alive (FN-A2-03).
                    detail: { footnoteId, isOrphan, docId: originDocId },
                  })
                );
              }, 0);
            };

            if (isOrphan) {
              performMove();
            } else {
              const requestConfirm = onConfirmFootnoteMoveRef.current;
              // Fire-and-forget: the drop event is already prevented, so
              // we can safely do async work and dispatch the move when
              // the user resolves the dialog. EditorLayout always wires
              // the callback — if it's missing we log and skip silently
              // rather than dropping into a native browser dialog.
              if (requestConfirm) {
                requestConfirm()
                  .then((ok) => { if (ok) performMove(); })
                  .catch(() => { /* swallow: user cancelled */ });
              } else {
                console.warn(
                  "[editor] footnote drop without onConfirmFootnoteMove handler — skipping",
                );
              }
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        return false;
      },
    },
    immediatelyRender: false,
    // Pass the editor by reference — downstream consumers (useDocument
    // autosave, editor-ops handleUpdate -> setLatestDoc) call
    // `editor.getJSON()` only when their debounce settles. Pre-fix this
    // called `getJSON()` on every keystroke and triggered a React
    // re-render cascade through EditorPane via `useDocument.setContent`.
    onUpdate: ({ editor, transaction }) => {
      // Thread the update-event transaction so the autosave can recognise an
      // anchor-mint tx and flush the doc bundle immediately (anchor-mint-signal).
      onUpdate(editor, transaction);
    },
  });

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // Editor-census probe (__editorCensus): one live-instance tick per mount.
  useEffect(() => registerEditorMount("main"), []);

  // No `setEditable` sync: PM stays `editable: true` for the entire
  // lifetime of the view so native selection always works. Read-only
  // is enforced by the `readOnlyEnforcer` plugin's `filterTransaction`
  // (gated on `readOnlyRef`), and external callers (collab, the prop)
  // flip that ref by re-rendering with a new `editable` value.

  // Paragraph drag-handle hover: detect via Y coordinate against each
  // wrapper's bounding rect, scoped to the editor's scroll container.
  // Why not CSS :hover or mouseover-on-dom? The grab handle and popout
  // button sit in the marginalia margin, which is OUTSIDE the
  // contenteditable element. Once the cursor leaves the contenteditable
  // (e.g. moving from text into the margin to grab the handle), a
  // mouseover-on-dom listener fires mouseleave and the .hovered class
  // is dropped — so the handle disappears mid-reach. Y-based detection
  // on the scroll container keeps the band lit for the full row the
  // paragraph occupies, regardless of where horizontally the cursor
  // sits (text, left margin, right margin).
  useEffect(() => {
    const dom = editor?.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    let scroller: HTMLElement | null = dom;
    while (scroller && scroller !== document.body) {
      const cs = window.getComputedStyle(scroller);
      if (cs.overflowY === "auto" || cs.overflowY === "scroll") break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) scroller = dom;
    let prev: Element | null = null;
    const setHovered = (next: Element | null) => {
      if (next === prev) return;
      if (prev) prev.classList.remove("hovered");
      if (next) next.classList.add("hovered");
      prev = next;
    };
    const onMove = (e: MouseEvent) => {
      const wrappers = dom.querySelectorAll(
        ".par-title-wrapper.has-text, .list-title-wrapper.has-text",
      );
      let found: Element | null = null;
      for (const w of Array.from(wrappers)) {
        const r = w.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          found = w;
          break;
        }
      }
      setHovered(found);
    };
    const onLeave = () => setHovered(null);
    scroller.addEventListener("mousemove", onMove);
    scroller.addEventListener("mouseleave", onLeave);
    return () => {
      scroller!.removeEventListener("mousemove", onMove);
      scroller!.removeEventListener("mouseleave", onLeave);
    };
  }, [editor]);

  // Keep the chrome-aware scroll-margin's DOM source pointed at the live editor
  // (its getters read CSS vars off this element at scroll time). See Part B above.
  useEffect(() => {
    editorViewDomRef.current = (editor?.view?.dom as HTMLElement | undefined) ?? null;
  }, [editor]);

  // Dev-only: expose window.__virgil.collectLinks() for ad-hoc inspection
  // while the Link system is being rolled out. Reads from the live editor.
  useEffect(() => {
    if (!editor) return;
    type VirgilDevtools = { collectLinks: () => unknown };
    const w = window as typeof window & { __virgil?: VirgilDevtools };
    w.__virgil = { collectLinks: () => collectLinksFromEditor(editor) };
    return () => {
      if (w.__virgil) delete w.__virgil;
    };
  }, [editor]);

  useImperativeHandle(ref, () => ({
    replaceText(oldText: string, newText: string): boolean {
      if (!editor) return false;
      const range = findTextRange(editor, oldText);
      if (!range) return false;

      // Drop the transient band before splicing — a meta-only dispatch, so
      // unlike the old select-all-then-unset-the-mark clear it adds no history
      // entry in front of the real replacement (and can't erase a user mark).
      clearTransientHighlights(editor.view);

      if (newText) {
        editor
          .chain()
          .focus()
          .setTextSelection(range)
          .insertContent(newText)
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection(range)
          .deleteSelection()
          .run();
      }
      return true;
    },
    getEditor() {
      return editor;
    },
    // Heading-label callbacks proxied to a popped-out heading float (FCU
    // Chip B). They read the live prop mirrors so the float consults the
    // exact same predicate / confirmations main uses. Defaults match what
    // the NodeView assumes when the host omitted the prop.
    isLabelTaken(candidate: string, excludeLabel: string | null): boolean {
      return isLabelTakenRef.current?.(candidate, excludeLabel) ?? false;
    },
    onConfirmLabelRename(
      oldLabel: string,
      newLabel: string,
      refCount: number,
    ): Promise<boolean> {
      const fn = onConfirmLabelRenameRef.current;
      return fn ? fn(oldLabel, newLabel, refCount) : Promise.resolve(false);
    },
    onConfirmHeadingDelete(typeName: string): Promise<boolean> {
      const fn = onConfirmHeadingDeleteRef.current;
      return fn ? fn(typeName) : Promise.resolve(true);
    },
    getSelectedText(): string {
      if (!editor) return "";
      const sel = editor.state.selection;
      // For NodeSelection on atom nodes, route through the central
      // atom-text registry so adding a new atom only touches that file.
      if (sel instanceof NodeSelection && sel.node.type.spec.atom) {
        return getAtomText(sel.node);
      }
      const { from, to } = sel;
      return editor.state.doc.textBetween(from, to, " ");
    },
    scrollToHeading(blockIndex: number): void {
      if (!editor) return;
      // Sentinel -1 means "scroll to the very top of the document"
      if (blockIndex === -1) {
        editor.commands.setTextSelection(1);
        const scrollEl = findEditorScrollFor(editor.view.dom);
        if (scrollEl) scrollEl.scrollTop = 0;
        return;
      }
      // Walk top-level nodes to find the nth one
      let pos = 0;
      let idx = 0;
      editor.state.doc.forEach((node, offset) => {
        if (idx === blockIndex) {
          pos = offset + 1; // +1 to be inside the node
        }
        idx++;
      });
      if (pos > 0) {
        editor.commands.setTextSelection(pos);
        // Jump so the heading lands on the shared section-active line — the
        // same line the position detector reads — so the clicked section
        // immediately registers as current (OUT-#6). (Was block:"center" at
        // 0.5, below the detector's 0.25 line, so the prior section stuck.)
        const domAtPos = editor.view.domAtPos(pos);
        const el = domAtPos.node instanceof HTMLElement
          ? domAtPos.node
          : domAtPos.node.parentElement;
        if (el) scrollHeadingToActiveLine(editor.view.dom, el);
      }
    },
    archiveSelection(_archiveId: string): { content: unknown; paragraphId: string | null } | null {
      if (!editor) return null;
      const sel = editor.state.selection;

      // After the delete, resolve (or create) an anchor at the cursor and
      // return its UUID. Three cases:
      //   1. Paragraph-archive: cursor lands inside the now-empty paragraph,
      //      which still carries its original UUID. `ensureAnchorUuid`
      //      returns the existing UUID.
      //   2. Heading- or block-atom-archive: the host block was removed.
      //      The cursor lands inside whatever paragraph survived at the
      //      join — usually a UUID-less empty paragraph, which the helper
      //      stamps.
      //   3. Edge case (e.g. atom was at doc end): no anchorable node at
      //      cursor — insert a fresh empty paragraph with a UUID.
      const resolveAnchor = (): string | null => {
        const existing = ensureAnchorUuid(editor.view, editor.state.selection.from);
        if (existing) return existing;
        // Cursor not inside any anchorable node — insert one.
        const seen = new Set<string>();
        editor.state.doc.descendants((n) => {
          const u = n.attrs?.uuid as string | undefined;
          if (u) seen.add(u);
        });
        const newUuid = generateShortId(seen);
        editor
          .chain()
          .focus()
          .insertContent({ type: "paragraph", attrs: { uuid: newUuid } })
          .run();
        return newUuid;
      };

      // Slice the selection to preserve full node structure (paragraphs,
      // headings, blockquotes, AND block atoms like texBlock/figureBlock/
      // latexComment). The matching restoreArchive path below feeds the
      // slice JSON back through `insertContent`, so round-trip works for
      // any node type without per-atom branching. The text-emptiness
      // check is intentional only for text selections: an atom slice has
      // size > 0 but `textBetween` is empty, so the guard would wrongly
      // reject it; the explicit `slice.size === 0` covers the legitimate
      // "nothing to archive" case.
      const { from, to } = sel;
      if (from === to) return null;
      const slice = editor.state.doc.slice(from, to);
      if (slice.size === 0) return null;
      const richContent = { type: "doc", content: slice.content.toJSON() };
      editor.chain().focus().deleteSelection().run();
      const paragraphId = resolveAnchor();
      return { content: richContent, paragraphId };
    },
    restoreArchive(content: unknown): void {
      if (!editor) return;
      // Insert at current cursor position
      if (typeof content === "string") {
        if (content.startsWith("% ")) {
          const body = content.slice(2);
          editor.chain().focus().insertContent({
            type: "latexComment",
            content: body ? [{ type: "text", text: body }] : [],
          }).run();
        } else {
          editor.chain().focus().insertContent(content).run();
        }
      } else {
        const doc = content as { type?: string; content?: unknown[] };
        const nodes = doc?.content ?? [];
        editor.chain().focus().insertContent(nodes).run();
      }
    },
    getFootnotes(): FootnoteInfo[] {
      const footnotes: FootnoteInfo[] = [];
      if (!editor) return footnotes;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId) {
          footnotes.push({
            footnoteId: node.attrs.footnoteId,
            content: normalizeRichContent(node.attrs.content),
            number: node.attrs.number || 0,
            pos,
            title: node.attrs.title || undefined,
            thanks: !!node.attrs.thanks,
          });
        }
        return true;
      });
      return footnotes;
    },
    scrollToFootnote(footnoteId: string, sourceEl?: HTMLElement | null): void {
      if (!editor) return;
      const link: VirgilLink = {
        id: footnoteId,
        kind: "footnote",
        anchor: { type: "inline-atom", nodeName: "footnote", pos: null },
        target: { type: "card", ref: { kind: "footnote", id: footnoteId } },
        createdAt: "",
      };
      jumpToLink(editor, link, "to-marker", sourceEl);
    },
    updateFootnoteContent(footnoteId: string, newContent: TipJSON): void {
      if (!editor) return;
      let fnPos: number | null = null;
      let fnNode: any = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId === footnoteId) {
          fnPos = pos;
          fnNode = node;
          return false;
        }
        return true;
      });
      if (fnPos != null && fnNode) {
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(fnPos, undefined, {
            ...fnNode.attrs,
            content: newContent,
          })
        );
      }
    },
    updateFootnoteTitle(footnoteId: string, title: string): void {
      if (!editor) return;
      let fnPos: number | null = null;
      let fnNode: any = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId === footnoteId) {
          fnPos = pos;
          fnNode = node;
          return false;
        }
        return true;
      });
      if (fnPos != null && fnNode) {
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(fnPos, undefined, {
            ...fnNode.attrs,
            title,
          })
        );
      }
    },
    deleteFootnote(footnoteId: string): void {
      if (!editor) return;
      const link: VirgilLink = {
        id: footnoteId,
        kind: "footnote",
        anchor: { type: "inline-atom", nodeName: "footnote", pos: null },
        target: { type: "card", ref: { kind: "footnote", id: footnoteId } },
        createdAt: "",
      };
      deleteLink(editor, link);
    },
    createFootnoteFromSelection(opts): { footnoteId: string } | null {
      if (!editor) return null;
      const { from, to } = editor.state.selection;
      if (from === to) return null;
      const text = editor.state.doc.textBetween(from, to, " ");
      if (!text.trim()) return null;
      const existing = new Set<string>();
      editor.state.doc.descendants((n) => {
        if (n.type.name === "footnote" && n.attrs.footnoteId) {
          existing.add(n.attrs.footnoteId as string);
        }
        return true;
      });
      const footnoteId = generateShortId(existing);
      const content: TipJSON = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      };
      // No scroll: inline atoms must never jump the viewport (insertInlineAtom
      // enforces the invariant). insertContent replaces the selected range, so the
      // highlighted text becomes the footnote's seed content.
      insertInlineAtom({
        editor,
        type: "footnote",
        attrs: { footnoteId, content, number: 0, title: opts?.title ?? "" },
      });
      return { footnoteId };
    },
    createEmptyFootnote(opts): { footnoteId: string } | null {
      if (!editor) return null;
      const existing = new Set<string>();
      editor.state.doc.descendants((n) => {
        if (n.type.name === "footnote" && n.attrs.footnoteId) {
          existing.add(n.attrs.footnoteId as string);
        }
        return true;
      });
      const footnoteId = generateShortId(existing);
      const content: TipJSON = { type: "doc", content: [{ type: "paragraph" }] };
      // No scroll: inline atoms must never jump the viewport.
      insertInlineAtom({
        editor,
        type: "footnote",
        attrs: { footnoteId, content, number: 0, title: opts?.title ?? "" },
      });
      return { footnoteId };
    },
    renumberFootnotes(): void {
      if (!editor) return;
      const positions: { pos: number; attrs: any }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote") {
          positions.push({ pos, attrs: node.attrs });
        }
        return true;
      });
      if (positions.length === 0) return;
      let tr = editor.state.tr;
      let counter = 1;
      for (const { pos, attrs } of positions) {
        tr = tr.setNodeMarkup(pos, undefined, { ...attrs, number: counter++ });
      }
      editor.view.dispatch(tr);
    },

    getExamples(): ExampleInfo[] {
      if (!editor) return [];
      const out: ExampleInfo[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "exampleBlock") return true;
        const id = (node.attrs.uuid as string) || "";
        if (!id) return false;
        let preview = "";
        node.descendants((child) => {
          if (child.isText && child.text) {
            preview += child.text;
            return preview.length < 120;
          }
          return true;
        });
        // Top-level body text: paragraphs that are direct children of the
        // exampleBlock (i.e. not nested inside an exampleItemList). For
        // `\ex` examples this captures the whole body; for `\pex` it
        // captures any preamble paragraphs before the items.
        const bodyParagraphs: string[] = [];
        // Capture the top-level body paragraphs as JSONContent too, so the
        // Example card can render real inline atoms (citation / \ref / math)
        // via BorrowedMainText. Same paragraphs as bodyText, kept in lockstep.
        const bodyParaJson: JSONContent[] = [];
        node.forEach((child) => {
          if (child.type.name === "paragraph") {
            bodyParagraphs.push(child.textContent);
            bodyParaJson.push(child.toJSON() as JSONContent);
          }
        });
        const bodyText = bodyParagraphs.join("\n").trim();
        const bodyContent: JSONContent | null =
          bodyParaJson.length > 0
            ? { type: "doc", content: bodyParaJson }
            : null;
        // Top-level sub-items: walk the first exampleItemList only, so
        // nested xlists don't get inlined into the flat list (they
        // remain accessible via the .tex source editor).
        const items: ExampleSubItem[] = [];
        node.forEach((child) => {
          if (child.type.name === "exampleItemList" && items.length === 0) {
            child.forEach((it) => {
              if (it.type.name !== "exampleItem") return;
              // The item's inner paragraphs as a JSONContent doc (atoms intact)
              // for BorrowedMainText; null when the item has no text.
              const itemParas: JSONContent[] = [];
              it.forEach((inner) => {
                if (inner.type.name === "paragraph") {
                  itemParas.push(inner.toJSON() as JSONContent);
                }
              });
              items.push({
                subLabel: (it.attrs.subLabel as string) || "",
                label: (it.attrs.label as string) || "",
                tag: (it.attrs.tag as string) || "",
                text: it.textContent.trim(),
                content:
                  itemParas.length > 0
                    ? { type: "doc", content: itemParas }
                    : null,
              });
            });
          }
        });
        const subs = items.map((it) => it.subLabel).filter(Boolean);
        const subLabelRange =
          subs.length > 1 ? `${subs[0]}–${subs[subs.length - 1]}` : subs[0] || "";
        let latex = exampleLatexCache.get(node) ?? "";
        if (!latex) {
          try {
            latex = serializeBodyOnly({
              type: "doc",
              content: [node.toJSON() as JSONContent],
            });
            exampleLatexCache.set(node, latex);
          } catch {
            latex = "";
          }
        }
        out.push({
          exampleId: id,
          pos,
          number: Number(node.attrs.number) || 0,
          kind: node.attrs.kind === "multi" ? "multi" : "single",
          tag: (node.attrs.tag as string) || "",
          label: (node.attrs.label as string) || "",
          preview: (preview.trim() || "(empty example)").slice(0, 120),
          subLabelRange,
          bodyText,
          bodyContent,
          items,
          latex,
        });
        return false;
      });
      return out;
    },

    scrollToExample(exampleId: string, sourceEl?: HTMLElement | null): void {
      if (!editor) return;
      let target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "exampleBlock" && node.attrs.uuid === exampleId) {
          target = pos;
          return false;
        }
        return true;
      });
      if (target < 0) return;
      if (sourceEl) {
        const domEl = editor.view.nodeDOM(target) as HTMLElement | null;
        if (domEl) {
          alignEntryToY(domEl, sourceEl.getBoundingClientRect().top);
          return;
        }
      }
      editor.chain().focus().setTextSelection(target + 1).scrollIntoView().run();
    },

    // CHIP 5c: `insertExample` RETIRED here — example creation unified on
    // `exampleRun` (action-registry); the slash `\ex` reaches it via the
    // EditorActions bridge, the grid `ex` cell calls it directly.

    getCitations() {
      if (!editor) return [];
      const results: { citationId: string; command: string; displayText: string; pos: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "citation") {
          results.push({
            citationId: node.attrs.citationId,
            command: node.attrs.command,
            displayText: node.attrs.displayText,
            pos,
          });
        }
        // Footnotes are atomic nodes; their `attrs.content` is a
        // JSONContent literal that ProseMirror's traversal won't enter.
        // Walk it explicitly so citations inside footnotes register in
        // the Citations / Bibliography panels.
        if (node.type.name === "footnote" && node.attrs.content) {
          walkJsonContentForCitations(
            node.attrs.content as JSONContent,
            (cit) => results.push({ ...cit, pos }),
          );
        }
        return true;
      });
      return results;
    },

    scrollToCitation(citationId: string, sourceEl?: HTMLElement | null): void {
      if (!editor) return;
      const link: VirgilLink = {
        id: citationId,
        kind: "citation",
        anchor: { type: "inline-atom", nodeName: "citation", pos: null },
        target: { type: "card", ref: { kind: "citation", id: citationId } },
        createdAt: "",
      };
      jumpToLink(editor, link, "to-marker", sourceEl);
    },

    updateCitationDisplay(citationId: string, displayText: string, command?: string): void {
      if (!editor) return;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "citation" && node.attrs.citationId === citationId) {
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            displayText,
            ...(command !== undefined ? { command } : {}),
          });
          // Tag so the readOnlyEnforcer plugin lets this attr-only
          // update through even in collaborator read-only mode.
          tr.setMeta("ignoreReadOnly", true);
          editor.view.dispatch(tr);
          return false;
        }
        return true;
      });
    },

    getCitationIds(): Set<string> {
      if (!editor) return new Set();
      const ids = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (node.type.name === "citation") ids.add(node.attrs.citationId);
        if (node.type.name === "footnote" && node.attrs.content) {
          walkJsonContentForCitations(
            node.attrs.content as JSONContent,
            (cit) => ids.add(cit.citationId),
          );
        }
        return true;
      });
      return ids;
    },

    getCitationOrder(): string[] {
      if (!editor) return [];
      const ids: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "citation") ids.push(node.attrs.citationId);
        if (node.type.name === "footnote" && node.attrs.content) {
          walkJsonContentForCitations(
            node.attrs.content as JSONContent,
            (cit) => ids.push(cit.citationId),
          );
        }
        return true;
      });
      return ids;
    },

    insertCitation(command: string, citationId: string, displayText: string): void {
      if (!editor) return;
      // No scroll: inline atoms must never jump the viewport.
      insertInlineAtom({
        editor,
        type: "citation",
        attrs: { citationId, command, displayText },
      });
    },
    deleteCitation(citationId: string): void {
      if (!editor) return;
      // 1) Top-level `\cite` atom: removed via the shared deleteLink primitive
      //    (no-ops for a draft/unanchored citation, which has no doc node).
      const link: VirgilLink = {
        id: citationId,
        kind: "citation",
        anchor: { type: "inline-atom", nodeName: "citation", pos: null },
        target: { type: "card", ref: { kind: "citation", id: citationId } },
        createdAt: "",
      };
      deleteLink(editor, link);
      // 2) Footnote-NESTED `\cite` (backlog #38): a citation living inside a
      //    footnote's `attrs.content` is not a top-level doc atom, so step (1)
      //    leaves it in place — yet `getCitations()` collects it, so the
      //    deleted card would re-derive on reload. Strip it from the host
      //    footnote(s). The rewrite is a real doc tx with no ignoreReadOnly
      //    meta, so the readOnlyEnforcer leaves it inert in collaborator
      //    read-only mode (nested cite untouched in a partner-claimed doc).
      stripFootnoteNestedCitation(editor, citationId);
    },
    getActiveParagraphId(): string | null {
      if (!editor) return null;
      const scrollEl = findEditorScrollFor(editor.view.dom) as HTMLElement | null;
      if (!scrollEl) return null;
      const viewTop = scrollEl.scrollTop;
      const viewBottom = viewTop + scrollEl.clientHeight;
      const scrollRect = scrollEl.getBoundingClientRect();

      // If scrolled to the very top (title area visible), return sentinel
      if (viewTop < 10) return "__DOC_TOP__";

      // Helper: get the UUID of a node (paragraph, bulletList, orderedList)
      const getUuid = (node: any): string | null => node.attrs?.uuid || null;
      const hasParagraphUuid = (node: any): boolean => {
        return isAnchorableNode(node.type) && !!node.attrs?.uuid;
      };

      // Rule 1: Find the paragraph the cursor is in
      const cursorPos = editor.state.selection.$anchor.pos;
      let cursorUuid: string | null = null;
      let cursorNodeTop: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (cursorUuid) return false;
        if (hasParagraphUuid(node)) {
          const end = pos + node.nodeSize;
          if (cursorPos >= pos && cursorPos <= end) {
            cursorUuid = getUuid(node);
            try {
              const coords = editor.view.coordsAtPos(pos);
              cursorNodeTop = coords.top - scrollRect.top + scrollEl.scrollTop;
            } catch { /* ignore */ }
          }
        }
        return true;
      });

      // If cursor is in a UUID paragraph and its top is visible, use it
      if (cursorUuid && cursorNodeTop !== null) {
        if (cursorNodeTop >= viewTop && cursorNodeTop < viewBottom) {
          return cursorUuid;
        }
      }

      // If cursor wasn't in a UUID paragraph, scan nearest forward/backward
      if (!cursorUuid) {
        let bestUuid: string | null = null;
        let bestDist = Infinity;
        editor.state.doc.descendants((node, pos) => {
          if (hasParagraphUuid(node)) {
            const mid = pos + node.nodeSize / 2;
            const dist = Math.abs(mid - cursorPos);
            if (dist < bestDist) {
              bestDist = dist;
              bestUuid = getUuid(node);
            }
          }
          return true;
        });
        if (bestUuid) {
          // Check if this nearest paragraph is visible
          // (we'll fall through to rule 2 visibility check anyway)
          cursorUuid = bestUuid;
        }
      }

      // Rule 2: Cursor's paragraph (or nearest) is off-screen.
      // Find topmost paragraph whose opening lines are visible.
      let topmostUuid: string | null = null;
      let topmostY = Infinity;
      editor.state.doc.descendants((node, pos) => {
        if (hasParagraphUuid(node)) {
          try {
            const coords = editor.view.coordsAtPos(pos);
            const nodeTop = coords.top - scrollRect.top + scrollEl.scrollTop;
            // "Opening lines visible" = the top of the paragraph is in the viewport
            if (nodeTop >= viewTop && nodeTop < viewBottom && nodeTop < topmostY) {
              topmostY = nodeTop;
              topmostUuid = getUuid(node);
            }
          } catch { /* ignore */ }
        }
        return true;
      });
      if (topmostUuid) return topmostUuid;

      // Rule 3: No paragraph has opening lines visible (e.g., middle of a long paragraph).
      // Find any paragraph that overlaps the viewport.
      let overlappingUuid: string | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (overlappingUuid) return false;
        if (hasParagraphUuid(node)) {
          try {
            const startCoords = editor.view.coordsAtPos(pos);
            const endCoords = editor.view.coordsAtPos(pos + node.nodeSize - 1);
            const nodeTop = startCoords.top - scrollRect.top + scrollEl.scrollTop;
            const nodeBottom = endCoords.bottom - scrollRect.top + scrollEl.scrollTop;
            if (nodeBottom > viewTop && nodeTop < viewBottom) {
              overlappingUuid = getUuid(node);
            }
          } catch { /* ignore */ }
        }
        return true;
      });
      return overlappingUuid ?? cursorUuid;
    },
    scrollToParagraphId(uuid: string): void {
      if (!editor) return;
      let targetPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (targetPos >= 0) return false;
        if (node.attrs?.uuid === uuid) {
          targetPos = pos + 1; // +1 to be inside the node
        }
        return true;
      });
      if (targetPos < 0) return;
      try {
        editor.commands.setTextSelection(targetPos);
        const coords = editor.view.coordsAtPos(targetPos);
        const scrollEl = findEditorScrollFor(editor.view.dom);
        if (scrollEl && coords) {
          const scrollRect = scrollEl.getBoundingClientRect();
          const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 100;
          scrollEl.scrollTop = Math.max(0, targetY);
        }
      } catch { /* pos out of range */ }
    },
    jumpToCard(card: CardWithLinks, sourceEl?: HTMLElement | null): boolean {
      if (!editor) return false;
      return jumpToCard(editor, card, sourceEl);
    },
    jumpToLink(link: VirgilLink): void {
      if (!editor) return;
      jumpToLink(editor, link, "to-marker");
    },
    ensureParagraphUuid(pos: number): string | null {
      if (!editor) return null;
      const doc = editor.state.doc;
      if (pos < 0 || pos > doc.content.size) return null;
      const clamped = Math.min(Math.max(pos, 0), doc.content.size);
      return ensureAnchorUuid(editor.view, clamped);
    },
    ensureActiveParagraphUuid(): string | null {
      if (!editor) return null;
      return (this as EditorHandle).ensureParagraphUuid(editor.state.selection.from);
    },
    ensureParagraphUuidAtCoords(x: number, y: number): string | null {
      if (!editor) return null;
      let posResult: { pos: number; inside: number } | null;
      try {
        posResult = editor.view.posAtCoords({ left: x, top: y });
      } catch {
        return null;
      }
      if (!posResult) return null;
      return (this as EditorHandle).ensureParagraphUuid(posResult.pos);
    },
    getParagraphPositions(): Array<{ id: string; top: number }> {
      if (!editor) return [];
      const view = editor.view;
      let scrollEl: HTMLElement | null = null;
      try {
        scrollEl = findEditorScrollFor(view.dom);
      } catch {
        return [];
      }
      if (!scrollEl) return [];
      const scrollRect = scrollEl.getBoundingClientRect();
      const result: Array<{ id: string; top: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        const name = node.type.name;
        const id = node.attrs?.uuid as string | undefined;
        if (id && isAnchorableNode(node.type)) {
          try {
            let top: number;
            if (isAnchorableAtom(node.type)) {
              const dom = view.nodeDOM(pos) as HTMLElement | null;
              if (!dom) return true;
              top = dom.getBoundingClientRect().top - scrollRect.top + scrollEl!.scrollTop;
            } else {
              const coords = view.coordsAtPos(pos + 1);
              top = coords.top - scrollRect.top + scrollEl!.scrollTop;
            }
            result.push({ id, top });
          } catch { /* ignore */ }
        }
        // Don't recurse into list items — the list itself carries the uuid
        if (name === "bulletList" || name === "orderedList") return false;
        return true;
      });
      return result;
    },
    scrollToPos(pos: number): void {
      if (!editor) return;
      const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size));
      try {
        editor.commands.setTextSelection(clamped);
        const coords = editor.view.coordsAtPos(clamped);
        const scrollEl = findEditorScrollFor(editor.view.dom);
        if (scrollEl && coords) {
          const scrollRect = scrollEl.getBoundingClientRect();
          const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 100;
          scrollEl.scrollTop = Math.max(0, targetY);
        }
      } catch { /* pos out of range */ }
    },
    applyLinkedAnchors(records): void {
      if (!editor) return;
      // Reconcile-not-skip: re-stamp present marks whose kind/linkCard/tintColor
      // disagree with the sidecar record (BUG1), re-anchor absent ones by text.
      // The ONE shared impl both production and the RC-B tests import.
      applyLinkedAnchorsImpl(editor, records);
    },
    collapseAllSections(): void {
      if (!editor) return;
      // Ensure every top-level heading has a UUID so fold state has a stable
      // key per heading.
      const existing = new Set<string>();
      editor.state.doc.descendants((n) => {
        if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
      });
      const tr = editor.state.tr;
      let mutated = false;
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "heading" && !node.attrs?.uuid) {
          const newUuid = generateShortId(existing);
          existing.add(newUuid);
          tr.setNodeMarkup(offset, undefined, { ...node.attrs, uuid: newUuid });
          mutated = true;
        }
      });
      if (mutated) {
        tr.setMeta("addToHistory", false);
      }
      tr.setMeta(sectionFoldingPluginKey, { action: "collapseAll" });
      editor.view.dispatch(tr);
    },
    expandAllSections(): void {
      if (!editor) return;
      const tr = editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "expandAll",
      });
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    },
    setFolded(uuids: string[]): void {
      if (!editor) return;
      const tr = editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "setFolded",
        uuids,
      });
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    },
    restoreCursorToParagraph(
      uuid: string,
      opts?: { scrollIntoView?: boolean },
    ): void {
      if (!editor) return;
      const scrollIntoView = opts?.scrollIntoView ?? true;
      let targetPos = -1;
      let targetNodeSize = 0;
      editor.state.doc.descendants((node, pos) => {
        if (targetPos >= 0) return false;
        if (node.attrs?.uuid === uuid) {
          targetPos = pos;
          targetNodeSize = node.nodeSize;
        }
        return true;
      });
      if (targetPos < 0) return;
      const endPos = targetPos + targetNodeSize - 1;
      try {
        if (scrollIntoView) {
          // Scroll first (moves selection to paragraph start internally),
          // then place cursor at end + take DOM focus. Focus can silently
          // no-op on the very first load if the browser blocks autofocus
          // without a user gesture — the selection still lands correctly,
          // so the cursor is ready the moment the user clicks anywhere.
          (this as EditorHandle).scrollToParagraphId(uuid);
          editor.commands.setTextSelection(endPos);
          editor.view.focus();
        } else {
          // A saved/live scroll offset is being restored by the pane's
          // scroll-restoration owner; the cursor must NOT pull the viewport.
          // Place the selection and take focus WITHOUT the default deferred
          // focus-scroll (`scrollIntoView: false`) — otherwise the focus-scroll
          // races the offset restore and the doc lands on the cursor paragraph
          // instead of where the user was last looking.
          editor.commands.setTextSelection(endPos);
          editor.commands.focus(null, { scrollIntoView: false });
        }
      } catch {
        /* position out of range — silently skip */
      }
    },
  }), [editor]);

  /**
   * Paint the ONE live transient highlight band, or clear it.
   *
   * Every band here is view-only — a search hit, a diagnostics error range, a
   * revision's quoted text. None of it is document content, so none of it is a
   * MARK any more: the band is a ProseMirror decoration replaced by a meta-only
   * transaction (see `lib/tiptap/transient-highlight.ts`, task 120).
   * Consequences of the swap, all of them the point:
   *
   *  - **Never a history entry.** Clicking a search result used to record a
   *    mark-add, wiping the redo branch; the clear-on-close recorded an unset
   *    that the next Cmd+Z UNDID, resurrecting the amber band with the panel
   *    already closed.
   *  - **Never `docChanged`.** A hover no longer dirties the document or arms
   *    the `useDocument` autosaver — no phantom disk write on an unedited doc.
   *  - **Never touches the user's marks or selection.** The old painter cleared
   *    by selecting the WHOLE doc and unsetting the highlight mark (which would
   *    erase a real user highlight too), and had to put the SELECTION on the
   *    range to apply the mark at all — hence the collapse-to-`prevSelection`
   *    dance that existed only to hide the grey inactive-selection ghost. A
   *    decoration needs no selection, so the user's own selection survives.
   *
   * Both surviving bands are NAVIGATIONAL — they scroll into view and land the
   * caret at the range start, because that is the point of a jump. (The third
   * branch, a linked-anchor hover band keyed off an `activeAnchorId` prop, was
   * an unreachable orphan and is gone — see the prop note on `EditorProps`.)
   */
  const applyHighlight = useCallback(() => {
    if (!editor) return;

    const scrollRangeIntoView = (from: number) => {
      try {
        const domAtPos = editor.view.domAtPos(from);
        if (domAtPos.node instanceof HTMLElement || domAtPos.node.parentElement) {
          const el =
            domAtPos.node instanceof HTMLElement
              ? domAtPos.node
              : domAtPos.node.parentElement;
          el?.scrollIntoView({ behavior: "instant", block: "center" });
        }
      } catch { /* pos out of range after edit */ }
    };

    // Position-based highlight (search panel / diagnostics) takes priority.
    const range = highlightRangeRef.current;
    if (range) {
      setTransientHighlights(editor.view, [
        { from: range.from, to: range.to, color: TRANSIENT_HIGHLIGHT_COLOR },
      ]);
      try {
        editor.commands.setTextSelection(range.from);
      } catch { /* pos out of range after edit */ }
      scrollRangeIntoView(range.from);
      return;
    }

    // Text-based highlight (from revisions/suggestions).
    const textRange = highlightTextRef.current
      ? findTextRange(editor, highlightTextRef.current)
      : null;
    if (!textRange) {
      clearTransientHighlights(editor.view);
      return;
    }

    setTransientHighlights(editor.view, [
      { from: textRange.from, to: textRange.to, color: TRANSIENT_HIGHLIGHT_COLOR },
    ]);
    try {
      editor.commands.setTextSelection(textRange.from);
    } catch { /* pos out of range after edit */ }
    scrollRangeIntoView(textRange.from);
  }, [editor]);

  useEffect(() => {
    highlightTextRef.current = highlightText;
    highlightRangeRef.current = highlightRange;
    applyHighlight();
  }, [highlightText, highlightRange, applyHighlight]);

  // Keep the stable editor ref in sync for TextObjectGrabHandle and
  // anything else that needs a non-rerendering handle.
  useEffect(() => {
    editorInstanceRef.current = editor;
    return () => {
      if (editorInstanceRef.current === editor) {
        editorInstanceRef.current = null;
      }
    };
  }, [editor]);

  // Verification hook: expose the DocStructureObserver's emit counter on
  // `window.__virgilBusStats` so the keystroke-sanctity success criteria can be
  // checked live in the dev preview. Registers this editor in the shared probe
  // registry (multi-doc safe — resolves the FOCUSED editor on call); the getter
  // reads the bus on demand, with no RAF polling and zero per-keystroke cost.
  // See `docs/perf/keystroke-sanctity-findings.md` §9.
  useEffect(() => {
    if (typeof window === "undefined" || !editor) return;
    busStatsEditors.add(editor);
    installBusStatsProbe();
    installKeystrokeLatencyProbe();
    return () => {
      busStatsEditors.delete(editor);
    };
  }, [editor]);

  // Mirror the React `editable` prop onto the ProseMirror DOM as a
  // `data-editable` attribute. Lets NodeViews (and CSS) react declaratively
  // to read-only mode without each one having to wire its own ref.
  //
  // We still keep `view.editable = true` always (see `readOnlyRef` comment
  // above): this attribute is a *display* signal, not an editability one.
  // The `readOnlyEnforcer` plugin remains the source of truth for blocking
  // doc-changing transactions; this attribute just lets the UI hide
  // affordances that would silently fail when read-only.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    dom.setAttribute("data-editable", String(editable));
  }, [editor, editable]);

  // Register the editor's ProseMirror DOM with the drop-mode target
  // registry, so drop-mode hit-testing can find this editor under the
  // cursor. Re-registers when the editor instance changes (extension
  // reloads, doc swaps).
  useEffect(() => {
    if (!editor) return;
    return registerDropTarget(editor);
  }, [editor]);

  return (
    <ActiveTextObjectProvider editorRef={editorInstanceRef}>
      <div className="flex flex-col flex-1 min-w-0">
        <EditorContent editor={editor} />
        <TextObjectGrabHandle editorRef={editorInstanceRef} />
        <SelectionActionsMenu editorRef={editorInstanceRef} />
        <SlashCommandPopup editorRef={editorInstanceRef} />
      </div>
    </ActiveTextObjectProvider>
  );
});

export default VirgilEditor;
