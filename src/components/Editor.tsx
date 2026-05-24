"use client";

import { useEditor, EditorContent, JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import { Extension, mergeAttributes } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { InlineMath, DisplayMath, Footnote, LatexComment, Citation, LabelRef, LatexCommandMark, SlashPopupExtension, LabelHandler, TitleField, MaketitleMarker, EmptyParagraphTitleCleaner, AiRequestMarker, MarginaliaAnchorGuard, LinkedAnchor, LinkedAnchorGuard, ExampleBlock, ExampleItemList, ExampleItem, ExampleGloss, AlignedGlossRow, ProseGlossRow, GlossCell, ExpexNumbering, SmartQuotes, TabIndent, PgMarkChip, TextColor, TexBlock, FigureBlock, FigureCaption, GraphicsBlock } from "@/lib/tiptap-extensions";
import {
  collectLinksFromEditor,
  jumpToLink,
  jumpToCard,
  deleteLink,
  reanchorByText,
  resolveAnchorRange,
  type LinkedAnchorKind,
} from "@/links/links";
import type { Link as VirgilLink, CardWithLinks } from "@/links/links";
import { alignEntryToY, findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import {
  isAnchorableNode,
  isAnchorableAtom,
  MIME_MARGINALIA_MOVE,
  MIME_QUOTATION,
  MIME_NOTE,
  MIME_TODO,
  MIME_QUOTE,
  MIME_CITATION,
  MIME_FOOTNOTE,
  MIME_AI_REQUEST,
  MIME_TEXT_INSERT,
  MIME_CUT,
  isAnchorDrag,
} from "@/lib/marginalia";
import { getAtomText } from "@/lib/atom-text";
import { registerDropTarget } from "@/components/drop-mode/target-registry";
// Side-effect import: registers every TextObject float body with the
// registry via `registerFloatBody`. Must run before any popout renders.
import "@/text-objects/floats";
import { generateShortId } from "@/lib/uuid";
import { UUID_ATTR_SPEC, UuidAttrDecorator } from "@/lib/tiptap/uuid-attr";
import { DocStructureObserver, readPendingDiff } from "@/lib/tiptap/doc-structure";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { autoSizeInput } from "@/lib/autoSizeInput";
import { normalizeRichContent } from "@/lib/footnote-content";
import type { JSONContent as TipJSON } from "@tiptap/react";
import MenuBar from "./MenuBar";
import { createPopoutButtonEl } from "./panel-primitives";
import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { ActiveTextObjectProvider } from "@/text-objects/active-text-object-context";
import { SelectionActionsMenu } from "./SelectionActionsMenu";
import { SlashCommandPopup } from "./SlashCommandPopup";
import {
  sectionFoldingPlugin,
  sectionFoldingPluginKey,
  getSectionFoldingState,
} from "@/lib/section-folding";
import { HEADING_TYPES, headingTypeName } from "@/lib/heading-types";
import type { HeadingTypePick } from "./HeadingTypeMenu";

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
  onUpdate: (doc: JSONContent) => void;
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
  /**
   * Currently active linked-anchor id. When set, the mark for that id is
   * highlighted. Takes priority over `highlightText` but not `highlightRange`.
   */
  activeAnchorId?: string | null;
  /** Color token used for the active anchor highlight. Defaults to yellow. */
  activeAnchorColor?: string | null;
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
  /** Top-level sub-items (one entry per `\a`). Empty for `\ex` with no items. */
  items: ExampleSubItem[];
  /** Round-trippable LaTeX source for the entire `\ex…\xe` block. */
  latex: string;
}

export interface EditorHandle {
  replaceText: (oldText: string, newText: string) => boolean;
  getEditor: () => Editor | null;
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
  insertExample: (kind: "single" | "multi") => { exampleId: string } | null;
  /** Replace an existing example block with the parsed result of `latex`.
   *  Returns false when the source can't be parsed into an exampleBlock or
   *  the target id no longer exists. The new block keeps the original uuid
   *  so links/references stay intact. */
  replaceExampleLatex: (exampleId: string, latex: string) => boolean;
  getCitations: () => { citationId: string; command: string; displayText: string; pos: number }[];
  scrollToCitation: (citationId: string, sourceEl?: HTMLElement | null) => void;
  updateCitationDisplay: (citationId: string, displayText: string, command?: string) => void;
  getCitationIds: () => Set<string>;
  getCitationOrder: () => string[];
  insertCitation: (command: string, citationId: string, displayText: string) => void;
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
   * Re-apply linked-anchor marks from sidecar records. Called after load
   * and whenever the editor is first ready. Uses text-snapshot search via
   * `reanchorByText` — records whose text isn't found are skipped.
   */
  applyLinkedAnchors: (
    records: Array<{ anchorId: string; kind: LinkedAnchorKind; text: string }>,
  ) => void;
  /** Collapse all top-level heading sections (fold every section). */
  collapseAllSections: () => void;
  /** Expand all previously folded sections. */
  expandAllSections: () => void;
  /** Set the folded-sections state to exactly the given heading UUIDs.
   *  UUIDs that no longer exist in the doc are silently dropped. Used to
   *  restore section folds from persisted UI state on reload. */
  setFolded: (uuids: string[]) => void;
  /** Scroll to the paragraph with this UUID and place the cursor at its
   *  end. Silently no-ops if the UUID is no longer in the doc. Used to
   *  restore the last-edited paragraph from persisted UI state on reload. */
  restoreCursorToParagraph: (uuid: string) => void;
}

/**
 * Walk a JSONContent tree and invoke `visit` for every citation node.
 *
 * Atomic nodes (footnote, examples) keep their inner content as a
 * JSONContent literal in `attrs.content`; ProseMirror's `descendants`
 * doesn't traverse into that. Citations stored inside such inner
 * content are otherwise invisible to the editor's citation collectors,
 * which means the Citations and Bibliography panels under-count the
 * doc's actual citations. This helper walks the literal to surface
 * them.
 */
function walkJsonContentForCitations(
  json: JSONContent | null | undefined,
  visit: (cit: { citationId: string; command: string; displayText: string }) => void,
): void {
  if (!json) return;
  if (json.type === "citation" && json.attrs) {
    const a = json.attrs as Record<string, unknown>;
    visit({
      citationId: (a.citationId as string) || "",
      command: (a.command as string) || "",
      displayText: (a.displayText as string) || "",
    });
  }
  if (Array.isArray(json.content)) {
    for (const child of json.content) walkJsonContentForCitations(child, visit);
  }
}

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

const VirgilEditor = forwardRef<EditorHandle, EditorProps>(function VirgilEditor(
  { initialContent, onUpdate, highlightText, highlightRange, onAddComment, onArchive, onEditorReady, onCitationDrop, onConfirmFootnoteMove, onConfirmLabelRename, isLabelTaken, anchoredUuidsRef, activeAnchorId, activeAnchorColor, texBlockIsPoppedRef, onOpenHeadingTypeMenu, onConfirmHeadingDelete, onConfirmFigureDelete, documentClass, editable = true, docId = null },
  ref
) {
  const highlightTextRef = useRef(highlightText);
  highlightTextRef.current = highlightText;
  const highlightRangeRef = useRef(highlightRange);
  highlightRangeRef.current = highlightRange;
  const activeAnchorIdRef = useRef(activeAnchorId);
  activeAnchorIdRef.current = activeAnchorId;
  const activeAnchorColorRef = useRef(activeAnchorColor);
  activeAnchorColorRef.current = activeAnchorColor;

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
  // doc. This is what unblocks the SelectionDragHandle in the Library
  // Reader — `contenteditable="false"` interferes with how some browsers
  // route user-initiated selection events to PM, which made the handle
  // never appear even though the wiring was correct end-to-end.
  const readOnlyRef = useRef(!editable);
  readOnlyRef.current = !editable;
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

  const ParagraphWithTitle = Paragraph.extend({
    // Paragraphs never participate in HTML5 drag. Pop-out (custom mousedown
    // lift on the 6-dot grip) and drop-mode (shift-drag on a float header)
    // own all paragraph repositioning; PM-native node-drag would be a third
    // text-move surface and is suppressed at the schema root.
    draggable: false,
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        let currentNode = node;
        // dragHandleEl is gone — the editor-mounted TextObjectGrabHandle
        // (src/text-objects/TextObjectGrabHandle.tsx) handles every block
        // kind now via the registry-driven, cursor/hover-following handle.

        // Detect if this paragraph is inside a list item or an expex example
        // block — skip title controls + drag handle so the inner text reads
        // as plain prose. The example block itself carries its own chrome
        // (number + drag handle) via the exampleBlock node view.
        const pos = typeof getPos === "function" ? getPos() : null;
        let skipChrome = false;
        if (pos != null) {
          const resolved = nodeEditor.state.doc.resolve(pos);
          for (let d = resolved.depth; d >= 0; d--) {
            const name = resolved.node(d).type.name;
            if (name === "listItem" || name === "exampleBlock" || name === "exampleItem") {
              skipChrome = true;
              break;
            }
          }
        }

        if (skipChrome) {
          const p = document.createElement("p");
          return { dom: p, contentDOM: p };
        }

        const wrapper = document.createElement("div");
        wrapper.className = "par-title-wrapper";
        // Belt-and-suspenders with the schema `draggable: false`: the
        // browser must never see this wrapper as a drag source.
        wrapper.draggable = false;

        // Left-margin hover sensor — covers the gutter strip from the
        // text edge out to where the popout button sits, so the popout
        // reveal triggers on grab-handle/left-margin hover but NOT when
        // hovering the paragraph text itself. Replaces the older
        // .par-title-wrapper::before hover bridge (pseudo-elements
        // can't be selected via :has()).
        const leftZone = document.createElement("div");
        leftZone.className = "par-left-margin-zone";
        leftZone.contentEditable = "false";
        wrapper.appendChild(leftZone);

        // Title annotation area (above paragraph — holds +T or title)
        const titleAnnot = document.createElement("div");
        titleAnnot.className = "par-title-annotation";
        titleAnnot.contentEditable = "false";
        wrapper.appendChild(titleAnnot);

        // Paragraph content — wrapped in a relative container so the drag
        // handle can be positioned next to the first text line, not the title.
        const pContainer = document.createElement("div");
        pContainer.className = "par-body-container";
        const p = document.createElement("p");
        pContainer.appendChild(p);

        wrapper.appendChild(pContainer);

        function setTitle(newTitle: string | null) {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos != null) {
            const n = nodeEditor.state.doc.nodeAt(pos);
            if (n) {
              const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
              // Assign UUID if setting a title and node doesn't have one yet
              if (newTitle && !attrs.uuid) {
                attrs.uuid = generateShortId();
              }
              const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
              nodeEditor.view.dispatch(tr);
            }
          }
        }

        function enterEditMode() {
          // Show annotation area and place input over it
          wrapper.classList.add("has-add-btn");
          wrapper.classList.add("is-editing-title");
          titleAnnot.style.display = "block";
          titleAnnot.textContent = "\u00A0"; // nbsp placeholder for height

          const annotRect = titleAnnot.getBoundingClientRect();
          const wrapperRect = wrapper.getBoundingClientRect();

          const input = document.createElement("input");
          input.type = "text";
          input.className = "par-title-input";
          input.value = (currentNode.attrs.parTitle as string) || "";
          input.placeholder = "Paragraph title…";
          input.style.position = "fixed";
          input.style.left = `${wrapperRect.left}px`;
          input.style.top = `${annotRect.top}px`;
          input.style.zIndex = "9999";
          document.body.appendChild(input);

          // Auto-size to content (must be in DOM first for font measurement)
          const cleanupSizer = autoSizeInput(input);

          let committed = false;
          const cleanup = () => {
            cleanupSizer();
            wrapper.classList.remove("is-editing-title");
            if (document.body.contains(input)) document.body.removeChild(input);
          };
          const commit = () => {
            if (committed) return;
            committed = true;
            const val = input.value.trim() || null;
            const original = (currentNode.attrs.parTitle as string | null) || null;
            cleanup();
            if (val === original) {
              renderAnnot();
              return;
            }
            setTitle(val);
          };

          input.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); committed = true; cleanup(); renderAnnot(); }
          });

          input.addEventListener("blur", () => {
            setTimeout(() => { if (!committed) commit(); }, 150);
          });

          input.focus();
          input.select();
        }

        function renderAnnot() {
          const title = currentNode.attrs.parTitle as string | null;
          titleAnnot.innerHTML = "";

          // Toggle has-text for drag handle visibility
          const hasText = currentNode.textContent.trim().length > 0;
          wrapper.classList.toggle("has-text", hasText);

          if (title) {
            wrapper.classList.add("has-title");
            wrapper.classList.remove("has-add-btn");
            titleAnnot.style.display = "block";

            // Title text, then × delete button to its right
            const span = document.createElement("span");
            span.className = "par-title-text";
            span.textContent = title;
            titleAnnot.appendChild(span);
            const xBtn = document.createElement("button");
            xBtn.className = "par-title-delete";
            xBtn.textContent = "×";
            xBtn.title = "Remove title";
            xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
            xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
            titleAnnot.appendChild(xBtn);
          } else {
            wrapper.classList.remove("has-title");

            if (hasText) {
              wrapper.classList.add("has-add-btn");
              titleAnnot.style.display = "block";

              // "+T" label shown in the gap above paragraph, revealed on hover
              const addLabel = document.createElement("span");
              addLabel.className = "par-title-add";
              addLabel.textContent = "+T";
              addLabel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
              addLabel.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
              titleAnnot.appendChild(addLabel);
            } else {
              wrapper.classList.remove("has-add-btn");
              titleAnnot.style.display = "none";
            }
          }
        }

        renderAnnot();

        // Click on title text to edit
        titleAnnot.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        titleAnnot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (titleAnnot.querySelector("input")) return;
          enterEditMode();
        });

        return {
          dom: wrapper,
          contentDOM: p,
          stopEvent(event) {
            return (
              titleAnnot === event.target || titleAnnot.contains(event.target as Node)
            );
          },
          ignoreMutation(mutation) {
            if (titleAnnot.contains(mutation.target)) return true;
            if (mutation.target === wrapper) return true;
            return false;
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "paragraph") return false;
            currentNode = updatedNode;
            if (!titleAnnot.querySelector("input")) renderAnnot();
            return true;
          },
          destroy() {},
        };
      };
    },
  });

  // --- List title node view factory (shared by bullet + ordered lists) ---
  //
  // List-level chrome (drag handle + +T title) is added for top-level
  // lists only. Nested sublists (lists inside a `listItem`) return a
  // bare `<ul>` / `<ol>` with no wrapper — matching the way paragraphs
  // inside a `listItem` skip chrome (see ~line 572 above) so the inner
  // structure reads as part of its parent's prose.
  //
  // Per-listItem affordances are intentionally NOT implemented here:
  // `listItem` nodes have no `uuid` attr in the schema, and giving them
  // one requires synchronized changes to the LaTeX parser + serializer
  // so `\item` round-trips an identity. Deferred until a clear need.
  function createListTitleNodeView(tagName: "ul" | "ol", typeName: string) {
    return ({ node, getPos, editor: nodeEditor }: { node: any; getPos: (() => number | undefined) | boolean; editor: any }) => {
      let currentNode = node;

      // Detect nesting — return a bare list element with no chrome.
      const startPos = typeof getPos === "function" ? getPos() : null;
      let isNested = false;
      if (startPos != null) {
        const resolved = nodeEditor.state.doc.resolve(startPos);
        for (let d = resolved.depth; d >= 0; d--) {
          if (resolved.node(d).type.name === "listItem") {
            isNested = true;
            break;
          }
        }
      }
      if (isNested) {
        const bare = document.createElement(tagName);
        return { dom: bare, contentDOM: bare };
      }

      const wrapper = document.createElement("div");
      wrapper.className = "list-title-wrapper";
      // Lists always have content; mark the wrapper accordingly so the
      // editor-level hover-band delegation (see useEffect below) can
      // detect it the same way it detects paragraph wrappers.
      wrapper.classList.add("has-text");

      const titleAnnot = document.createElement("div");
      titleAnnot.className = "par-title-annotation";
      titleAnnot.contentEditable = "false";
      wrapper.appendChild(titleAnnot);

      const listEl = document.createElement(tagName);
      wrapper.appendChild(listEl);

      // The grip is gone — the editor-mounted TextObjectGrabHandle
      // (src/text-objects/TextObjectGrabHandle.tsx) handles bulletList /
      // orderedList lift via the registry-driven, cursor/hover-following
      // handle. The list wrapper keeps its `position: relative` so the
      // editor-level handle can pin to its gutter via DOM-rect math.

      function setTitle(newTitle: string | null) {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) {
          const n = nodeEditor.state.doc.nodeAt(pos);
          if (n) {
            const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
            if (newTitle && !attrs.uuid) {
              attrs.uuid = generateShortId();
            }
            const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
            nodeEditor.view.dispatch(tr);
          }
        }
      }

      function enterEditMode() {
        // Show annotation area and place input over it
        wrapper.classList.add("has-add-btn");
        wrapper.classList.add("is-editing-title");
        titleAnnot.style.display = "block";
        titleAnnot.textContent = "\u00A0"; // nbsp placeholder for height

        const annotRect = titleAnnot.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();

        const overlay = document.createElement("div");
        overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;`;
        document.body.appendChild(overlay);

        const input = document.createElement("input");
        input.type = "text";
        input.className = "par-title-input";
        input.value = currentNode.attrs.parTitle || "";
        input.placeholder = "Title…";
        input.style.cssText = `position:fixed;z-index:9999;left:${wrapperRect.left}px;top:${annotRect.top}px;`;
        document.body.appendChild(input);

        // Auto-size to content (must be in DOM first for font measurement)
        const cleanupSizer = autoSizeInput(input);

        input.focus();
        input.select();

        let committed = false;
        function commit() {
          if (committed) return;
          committed = true;
          cleanupSizer();
          wrapper.classList.remove("is-editing-title");
          const val = input.value.trim();
          setTitle(val || null);
          if (document.body.contains(input)) input.remove();
          if (document.body.contains(overlay)) overlay.remove();
        }
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); committed = true; cleanupSizer(); wrapper.classList.remove("is-editing-title"); if (document.body.contains(input)) input.remove(); if (document.body.contains(overlay)) overlay.remove(); renderAnnot(); }
        });
        input.addEventListener("blur", commit);
        overlay.addEventListener("mousedown", (e) => { e.preventDefault(); commit(); });
      }

      function renderAnnot() {
        const title = currentNode.attrs.parTitle as string | null;
        titleAnnot.innerHTML = "";

        if (title) {
          wrapper.classList.add("has-title");
          wrapper.classList.remove("has-add-btn");
          titleAnnot.style.display = "block";

          const span = document.createElement("span");
          span.className = "par-title-text";
          span.textContent = title;
          titleAnnot.appendChild(span);
          const xBtn = document.createElement("button");
          xBtn.className = "par-title-delete";
          xBtn.textContent = "×";
          xBtn.title = "Remove title";
          xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
          xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
          titleAnnot.appendChild(xBtn);
        } else {
          wrapper.classList.remove("has-title");
          wrapper.classList.add("has-add-btn");
          titleAnnot.style.display = "block";

          const addLabel = document.createElement("span");
          addLabel.className = "par-title-add";
          addLabel.textContent = "+T";
          addLabel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
          addLabel.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
          titleAnnot.appendChild(addLabel);
        }
      }

      renderAnnot();

      titleAnnot.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      titleAnnot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (titleAnnot.querySelector("input")) return;
        enterEditMode();
      });

      return {
        dom: wrapper,
        contentDOM: listEl,
        stopEvent(event: any) {
          return (
            titleAnnot === event.target || titleAnnot.contains(event.target as Node)
          );
        },
        ignoreMutation(mutation: any) {
          if (mutation.target && titleAnnot.contains(mutation.target)) return true;
          if (mutation.target === wrapper) return true;
          return false;
        },
        update(updatedNode: any) {
          if (updatedNode.type.name !== typeName) return false;
          currentNode = updatedNode;
          if (!titleAnnot.querySelector("input")) renderAnnot();
          return true;
        },
      };
    };
  }

  const BulletListWithTitle = BulletList.extend({
    group: "block list textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ul", "bulletList");
    },
  });

  const OrderedListWithTitle = OrderedList.extend({
    group: "block list textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ol", "orderedList");
    },
  });

  const BlockquoteWithUuid = Blockquote.extend({
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });

  const ListItemWithUuid = ListItem.extend({
    // Sub-object: lives only inside bulletList/orderedList. Widen content
    // so the FIRST child may be a graphicsBlock (e.g. an item that's just
    // `\includegraphics{...}`), not only a paragraph. Subsequent children
    // were already free via `block*` since graphicsBlock is in the block
    // group. Adding another inner kind (tables, etc.) is a one-token
    // edit to the union.
    content: "(paragraph | graphicsBlock) block*",
    group: "textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });

  const CodeBlockWithUuid = CodeBlock.extend({
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });

  const HeadingWithLabel = Heading.extend({
    group: "block textObject",
    // TipTap's default markdown-style heading input rules (`#`/`##`/… + space)
    // are dead surface area in this LaTeX-first editor (slash popup + the
    // heading type menu cover heading creation). They also produce a real
    // bug at level 0: with `levels: [0..6]`, the level-0 rule becomes
    // `^(#{0,0})\s$`, i.e. `^\s$`. TipTap's input-rules plugin reruns rules
    // on Enter with `text="\n"`, so Enter at parentOffset 0 of any paragraph
    // matches that rule and `setBlockType`s the paragraph into a \part —
    // the paragraph's text becomes the heading's title. Disabling the rules
    // outright kills the bug and the unused markdown shortcuts in one shot.
    addInputRules() {
      return [];
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        label: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        numbered: { default: true, rendered: false },
        sectionNumber: { default: null, rendered: false },
      };
    },
    parseHTML() {
      const tagLevels: Array<{ tag: string; level: number }> = [
        { tag: "h1", level: 1 },
        { tag: "h2", level: 2 },
        { tag: "h3", level: 3 },
        { tag: "h4", level: 4 },
        { tag: "h5", level: 5 },
        { tag: "h6", level: 6 },
      ];
      return tagLevels.map(({ tag, level }) => ({
        tag,
        getAttrs: (el: HTMLElement | string) => {
          if (typeof el === "string") return { level };
          const dataLevel = el.getAttribute("data-heading-level");
          const parsed = dataLevel != null ? Number.parseInt(dataLevel, 10) : NaN;
          return { level: Number.isFinite(parsed) ? parsed : level };
        },
      }));
    },
    renderHTML({ HTMLAttributes, node }) {
      const level = (node.attrs.level as number) ?? 1;
      // h0 isn't valid HTML; clamp the emitted tag and round-trip the real
      // level via data-heading-level. The in-editor visual is driven by the
      // node view's wrapper class, so this only matters for HTML serialization.
      const safeLevel = Math.max(1, Math.min(level || 1, 6));
      return [`h${safeLevel}`, mergeAttributes(HTMLAttributes, { "data-heading-level": String(level) }), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        let currentNode = node;

        const wrapper = document.createElement("div");
        wrapper.className = `heading-wrapper heading-wrapper-l${node.attrs.level}`;

        // Left-margin hover sensor — extends the heading's hover hit area into
        // the gutter so the drag handle / fold chevron / popout button reveal
        // when the mouse is anywhere on the heading row, not only over the
        // text itself. Mirrors the paragraph pattern.
        const headingLeftZone = document.createElement("div");
        headingLeftZone.className = "par-left-margin-zone";
        headingLeftZone.contentEditable = "false";
        wrapper.appendChild(headingLeftZone);

        // Folding chevron — positioned in the left margin gutter at the same
        // horizontal offset as the paragraph drag handles. Clicking toggles
        // the fold state for this heading's section.
        const foldBtn = document.createElement("button");
        foldBtn.type = "button";
        foldBtn.className = "heading-fold-chevron";
        foldBtn.contentEditable = "false";
        foldBtn.setAttribute("aria-label", "Toggle section fold");
        const SVG_NS_FOLD = "http://www.w3.org/2000/svg";
        const foldSvg = document.createElementNS(SVG_NS_FOLD, "svg");
        foldSvg.setAttribute("width", "12");
        foldSvg.setAttribute("height", "12");
        foldSvg.setAttribute("viewBox", "0 0 12 12");
        foldSvg.setAttribute("fill", "none");
        foldSvg.setAttribute("stroke", "currentColor");
        foldSvg.setAttribute("stroke-width", "1.5");
        foldSvg.setAttribute("stroke-linecap", "round");
        foldSvg.setAttribute("stroke-linejoin", "round");
        const foldPath = document.createElementNS(SVG_NS_FOLD, "path");
        foldPath.setAttribute("d", "M4.5 2l4 4-4 4");
        foldSvg.appendChild(foldPath);
        foldBtn.appendChild(foldSvg);
        // Prevent PM from focusing the editor / moving the selection.
        foldBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        foldBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          // Ensure the heading has a UUID we can key the fold state to.
          let uuid = currentNode.attrs?.uuid as string | null;
          if (!uuid) {
            uuid = ensureAnchorUuid(nodeEditor.view, p + 1);
          }
          if (!uuid) return;
          const tr = nodeEditor.view.state.tr.setMeta(sectionFoldingPluginKey, {
            action: "toggle",
            uuid,
          });
          tr.setMeta("addToHistory", false);
          nodeEditor.view.dispatch(tr);
        });
        wrapper.appendChild(foldBtn);

        function refreshFoldBtn() {
          const uuid = currentNode.attrs?.uuid as string | null;
          const folded = uuid
            ? getSectionFoldingState(nodeEditor.state).folded.has(uuid)
            : false;
          foldBtn.classList.toggle("is-folded", folded);
          foldBtn.title = folded ? "Unfold section" : "Fold section";
        }
        refreshFoldBtn();

        // Decorations applied to sibling blocks don't trigger this node's
        // update(), so subscribe to all transactions to keep the chevron in
        // sync with the folding plugin state.
        const onTransaction = () => refreshFoldBtn();
        nodeEditor.on("transaction", onTransaction);

        const h = document.createElement(`h${node.attrs.level}`) as HTMLHeadingElement;
        if (node.attrs.numbered !== false && node.attrs.sectionNumber) {
          h.dataset.sectionNumber = node.attrs.sectionNumber;
        }
        wrapper.appendChild(h);

        const annot = document.createElement("div");
        annot.className = "heading-annotation";
        annot.contentEditable = "false";
        wrapper.appendChild(annot);

        // The grip is gone — the editor-mounted TextObjectGrabHandle
        // (src/text-objects/TextObjectGrabHandle.tsx) handles heading
        // lift + click-to-menu via the registry-driven, cursor/hover-
        // following handle. HTML5 drag stays disabled at the wrapper
        // level; cross-editor drops route through drop-mode.

        function getTypeName(n: typeof node) {
          return headingTypeName(n.attrs.level as number);
        }

        function enterEditMode(targetSpan: HTMLElement) {
          if (annot.querySelector("input")) return;

          const input = document.createElement("input");
          input.type = "text";
          input.className = "heading-label-input";
          input.value = (currentNode.attrs.label as string) || "";
          input.placeholder = "label key";

          // Replace the target span with the input inline
          targetSpan.replaceWith(input);

          // Auto-size to content (must be in DOM first for font measurement)
          const cleanupSizer = autoSizeInput(input);

          input.addEventListener("mousedown", (ev) => ev.stopPropagation());

          // Live "label already in use" warning — consults the central
          // predicate from @/lib/labels via the isLabelTakenRef mirror.
          const warning = document.createElement("div");
          warning.className = "heading-label-warning";
          warning.textContent = "⚠ label already in use";
          warning.style.display = "none";
          annot.appendChild(warning);

          const refreshWarning = () => {
            const candidate = input.value.trim();
            const own = (currentNode.attrs.label as string | null) || null;
            const taken =
              candidate && isLabelTakenRef.current
                ? isLabelTakenRef.current(candidate, own)
                : false;
            warning.style.display = taken ? "" : "none";
            input.classList.toggle("has-conflict", !!taken);
          };
          input.addEventListener("input", refreshWarning);
          refreshWarning();

          let committed = false;
          const commit = async () => {
            if (committed) return;
            committed = true;
            cleanupSizer();
            const newLabel = input.value.trim() || null;
            const oldLabel = (currentNode.attrs.label as string | null) || null;

            if (oldLabel === newLabel) {
              renderAnnot();
              return;
            }

            const p = typeof getPos === "function" ? getPos() : null;
            if (p == null) {
              renderAnnot();
              return;
            }

            // Restore the annotation display before awaiting a modal so
            // the user isn't staring at a stale editable input behind it.
            renderAnnot();

            // Only prompt when renaming between two non-empty keys.
            // Add/remove cases either have no refs (add) or can't point
            // the refs anywhere meaningful (remove).
            const refPositions: number[] = [];
            if (oldLabel && newLabel) {
              nodeEditor.state.doc.descendants((nd, pos) => {
                if (nd.type.name === "labelRef" && nd.attrs.label === oldLabel) {
                  refPositions.push(pos);
                }
              });
            }

            let updateRefs = false;
            const handler = onConfirmLabelRenameRef.current;
            if (refPositions.length > 0 && handler && oldLabel && newLabel) {
              updateRefs = await handler(oldLabel, newLabel, refPositions.length);
            }

            // Re-resolve the heading position after the modal in case
            // the doc shifted (shouldn't happen while modal is open, but
            // cheap insurance).
            const headingPos = typeof getPos === "function" ? getPos() : p;
            if (headingPos == null) return;
            const headingNode = nodeEditor.state.doc.nodeAt(headingPos);
            if (!headingNode || headingNode.type.name !== "heading") return;

            const tr = nodeEditor.state.tr;
            tr.setNodeMarkup(headingPos, undefined, {
              ...headingNode.attrs,
              label: newLabel,
            });

            if (updateRefs) {
              const display =
                (headingNode.attrs.sectionNumber as string | null) || "??";
              // labelRef is an inline atom of fixed size — updating attrs
              // keeps existing positions valid within the same transaction.
              for (const rPos of refPositions) {
                const rNode = nodeEditor.state.doc.nodeAt(rPos);
                if (
                  rNode &&
                  rNode.type.name === "labelRef" &&
                  rNode.attrs.label === oldLabel
                ) {
                  tr.setNodeMarkup(rPos, undefined, {
                    ...rNode.attrs,
                    label: newLabel,
                    displayText: display,
                  });
                }
              }
            }

            nodeEditor.view.dispatch(tr);
            nodeEditor.commands.focus();
          };

          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); committed = true; cleanupSizer(); renderAnnot(); }
          });

          let armed = false;
          input.addEventListener("blur", () => { if (armed) commit(); });
          setTimeout(() => { armed = true; }, 200);

          requestAnimationFrame(() => {
            input.focus();
            if (currentNode.attrs.label) {
              // Place cursor at end for existing labels
              input.selectionStart = input.selectionEnd = input.value.length;
            } else {
              input.select();
            }
          });
          const refocusId = setInterval(() => {
            if (document.activeElement !== input && annot.contains(input)) {
              input.focus();
            }
          }, 30);
          setTimeout(() => clearInterval(refocusId), 250);
        }

        function renderAnnot() {
          const typeName = getTypeName(currentNode);
          const isNumbered = currentNode.attrs.numbered !== false;
          const label = currentNode.attrs.label as string | null;
          annot.innerHTML = "";

          // 1. Type chip — clickable dropdown trigger.
          const typeChip = document.createElement("span");
          typeChip.className = "heading-annotation-type-chip";
          typeChip.dataset.action = "type-menu";
          typeChip.setAttribute("role", "button");
          typeChip.setAttribute("aria-haspopup", "menu");
          typeChip.title = "Change heading type";
          const typeText = document.createElement("span");
          typeText.textContent = typeName;
          typeChip.appendChild(typeText);
          const caret = document.createElement("span");
          caret.className = "heading-annotation-caret";
          caret.textContent = "▾";
          typeChip.appendChild(caret);
          annot.appendChild(typeChip);

          // 2. Numbered on/off toggle — drives \section{} vs \section*{}
          // and the CSS-rendered section number on the heading itself.
          const numToggle = document.createElement("span");
          numToggle.className = "heading-annotation-numbered-toggle";
          if (!isNumbered) numToggle.classList.add("is-off");
          numToggle.dataset.action = "toggle-numbered";
          numToggle.setAttribute("role", "button");
          numToggle.setAttribute("aria-pressed", isNumbered ? "true" : "false");
          numToggle.title = isNumbered ? "Hide section number" : "Show section number";
          numToggle.textContent = "#";
          annot.appendChild(numToggle);

          // 3. Label slot (unchanged behaviour).
          if (label) {
            const sep = document.createElement("span");
            sep.className = "heading-annotation-sep";
            sep.textContent = "  ·  label: ";
            annot.appendChild(sep);

            const labelSpan = document.createElement("span");
            labelSpan.textContent = label;
            labelSpan.className = "heading-label-text";
            annot.appendChild(labelSpan);
          } else {
            const addBtn = document.createElement("span");
            addBtn.className = "heading-label-add";
            addBtn.textContent = "Label +";
            annot.appendChild(addBtn);
          }

          // 4. Trailing × delete button.
          const deleteBtn = document.createElement("span");
          deleteBtn.className = "heading-annotation-delete";
          deleteBtn.dataset.action = "delete";
          deleteBtn.setAttribute("role", "button");
          deleteBtn.title = "Delete heading";
          deleteBtn.textContent = "×";
          annot.appendChild(deleteBtn);
        }

        renderAnnot();

        function toggleNumbered() {
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          const tr = nodeEditor.state.tr.setNodeMarkup(p, undefined, {
            ...headingNode.attrs,
            numbered: !(headingNode.attrs.numbered !== false),
          });
          nodeEditor.view.dispatch(tr);
        }

        function applyLevelChange(newLevel: number) {
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          if (headingNode.attrs.level === newLevel) return;
          const tr = nodeEditor.state.tr.setNodeMarkup(p, undefined, {
            ...headingNode.attrs,
            level: newLevel,
          });
          nodeEditor.view.dispatch(tr);
        }

        function demoteToParagraph() {
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          const paragraphType = nodeEditor.state.schema.nodes.paragraph;
          if (!paragraphType) return;
          const tr = nodeEditor.state.tr.setBlockType(p, p + 1, paragraphType);
          nodeEditor.view.dispatch(tr);
        }

        async function requestDelete() {
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          const typeName = headingTypeName(headingNode.attrs.level as number);
          const confirmFn = onConfirmHeadingDeleteRef.current;
          const ok = confirmFn ? await confirmFn(typeName) : true;
          if (!ok) return;
          // Re-resolve after the modal — the doc shouldn't have shifted
          // while the user was deciding, but cheap insurance.
          const pos2 = typeof getPos === "function" ? getPos() : null;
          if (pos2 == null) return;
          const hn = nodeEditor.state.doc.nodeAt(pos2);
          if (!hn || hn.type.name !== "heading") return;
          const tr = nodeEditor.state.tr.delete(pos2, pos2 + hn.nodeSize);
          nodeEditor.view.dispatch(tr);
        }

        function openTypeMenu(target: HTMLElement) {
          const opener = onOpenHeadingTypeMenuRef.current;
          if (!opener) return;
          const rect = target.getBoundingClientRect();
          opener({
            anchorRect: rect,
            currentLevel: currentNode.attrs.level as number,
            onPick: (pick) => {
              if (pick.kind === "no-heading") {
                demoteToParagraph();
              } else {
                applyLevelChange(pick.level);
              }
            },
          });
        }

        // Phase 1: prevent browser default on mousedown so the contenteditable
        // doesn't receive focus (which would let PM steal it back later).
        annot.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        // Phase 2: dispatch on click. Walks up from the click target so a
        // click on the type chip's text or caret still resolves to the
        // chip's `data-action`.
        annot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const start = e.target as HTMLElement;
          let cursor: HTMLElement | null = start;
          while (cursor && cursor !== annot) {
            const action = cursor.dataset?.action;
            if (action === "type-menu") {
              openTypeMenu(cursor);
              return;
            }
            if (action === "toggle-numbered") {
              toggleNumbered();
              return;
            }
            if (action === "delete") {
              void requestDelete();
              return;
            }
            cursor = cursor.parentElement;
          }
          if (start.classList.contains("heading-label-text")) {
            enterEditMode(start);
          } else if (start.classList.contains("heading-label-add")) {
            // Materialize the label slot, then enter edit mode on the
            // freshly-inserted empty label span.
            const labelSpan = document.createElement("span");
            labelSpan.className = "heading-label-text";
            const sep = document.createElement("span");
            sep.className = "heading-annotation-sep";
            sep.textContent = "  ·  label: ";
            start.replaceWith(sep);
            sep.after(labelSpan);
            enterEditMode(labelSpan);
          }
        });

        return {
          dom: wrapper,
          contentDOM: h,
          // Tell ProseMirror to ignore all events originating from the annotation
          // area so it cannot steal focus from our label input.
          stopEvent(event) {
            if (annot === event.target || annot.contains(event.target as Node)) return true;
            if (foldBtn === event.target || foldBtn.contains(event.target as Node)) return true;
            return false;
          },
          ignoreMutation(mutation) {
            // Ignore all mutations in the annotation area (label editing, etc.)
            if (annot.contains(mutation.target)) return true;
            // Mutations inside the fold chevron (contentEditable=false) should
            // also be ignored.
            if (foldBtn.contains(mutation.target)) return true;
            return false;
          },
          destroy() {
            nodeEditor.off("transaction", onTransaction);
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "heading") return false;
            if (updatedNode.attrs.level !== currentNode.attrs.level) return false;
            currentNode = updatedNode;
            // Keep section number in sync for CSS ::before
            if (updatedNode.attrs.numbered !== false && updatedNode.attrs.sectionNumber) {
              h.dataset.sectionNumber = updatedNode.attrs.sectionNumber;
            } else {
              delete h.dataset.sectionNumber;
            }
            // Don't overwrite annot if an input is active
            if (!annot.querySelector("input")) renderAnnot();
            refreshFoldBtn();
            return true;
          },
        };
      };
    },
    addProseMirrorPlugins() {
      return [
        ...(this.parent?.() || []),
        sectionFoldingPlugin(),
        new Plugin({
          key: new PluginKey("sectionNumbers"),
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;

            // Gate: skip the entire numberer (3 doc walks) unless the
            // observer says headings / figures / examples / labels
            // actually changed. Pure text edits inside a paragraph
            // produce contentChangedUuids only — the numberer's output
            // can't change in that case, so we bail immediately.
            //
            // Trade-off (memo §5): manually editing a labelRef's
            // `label` attribute via the popover doesn't trigger this
            // gate, so the labelRef's displayText may stay stale until
            // the next structural change. The labelRef-insert flow
            // (`\ref{x}` + Enter) sets displayText at insertion, so
            // the common case still works.
            const pending = readPendingDiff(newState);
            if (pending) {
              const structuralChange =
                pending.addedHeadings.length > 0 ||
                pending.removedHeadings.length > 0 ||
                pending.changedHeadings.length > 0 ||
                pending.addedFigures.length > 0 ||
                pending.removedFigures.length > 0 ||
                pending.changedFigures.length > 0 ||
                pending.addedExamples.length > 0 ||
                pending.removedExamples.length > 0 ||
                pending.exampleStructureChanged ||
                pending.addedLabels.length > 0 ||
                pending.removedLabels.length > 0;
              if (!structuralChange) return null;
            }

            // Collect heading positions & attrs
            const headings: { pos: number; level: number; numbered: boolean; cur: string | null }[] = [];
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name === "heading") {
                headings.push({
                  pos,
                  level: nd.attrs.level,
                  numbered: nd.attrs.numbered !== false,
                  cur: nd.attrs.sectionNumber,
                });
              }
            });
            // Don't bail when there are no headings — figures still need
            // numbering and label-ref resolution.

            // Find top-level among numbered headings (levels 0..6 — 7 sentinels "above all")
            let topLevel = 7;
            for (const h of headings) {
              if (h.numbered && h.level < topLevel) topLevel = h.level;
            }

            const counters = [0, 0, 0, 0, 0, 0, 0];
            const updates: { pos: number; num: string | null }[] = [];

            for (const h of headings) {
              if (h.numbered && topLevel <= 6) {
                const idx = h.level;
                counters[idx]++;
                for (let i = idx + 1; i < 7; i++) counters[i] = 0;
                const parts: number[] = [];
                for (let i = topLevel; i <= idx; i++) parts.push(counters[i]);
                const num = parts.join(".");
                if (num !== h.cur) updates.push({ pos: h.pos, num });
              } else if (h.cur !== null) {
                updates.push({ pos: h.pos, num: null });
              }
            }

            // Build label→section-number map from headings
            const headingMap = new Map<string, string>();
            for (const h of headings) {
              if (h.numbered && topLevel <= 6) {
                const nd = newState.doc.nodeAt(h.pos);
                const label = nd?.attrs.label as string | null;
                // Use the computed number (from updates or current)
                const upd = updates.find((u) => u.pos === h.pos);
                const num = upd ? upd.num : h.cur;
                if (label && num) headingMap.set(label, num);
              }
            }

            // Build tag/label → example-number map from exampleBlocks.
            // parentKey → { number: "3", items: Map<subKey, "a"> }
            const exampleMap = new Map<
              string,
              { number: string; items: Map<string, string> }
            >();
            newState.doc.descendants((nd) => {
              if (nd.type.name !== "exampleBlock") return true;
              const parentNum = nd.attrs.number ? String(nd.attrs.number) : "";
              if (!parentNum) return false;
              const entry = { number: parentNum, items: new Map<string, string>() };
              if (nd.attrs.tag) exampleMap.set(nd.attrs.tag, entry);
              if (nd.attrs.label) exampleMap.set(nd.attrs.label, entry);
              nd.descendants((child) => {
                if (child.type.name === "exampleItem") {
                  const sub = child.attrs.subLabel || "";
                  if (!sub) return false;
                  if (child.attrs.tag) entry.items.set(child.attrs.tag, sub);
                  if (child.attrs.label) entry.items.set(child.attrs.label, sub);
                  return false;
                }
                return true;
              });
              return false;
            });

            // Walk figureBlocks in document order. Numbered figures get
            // sequential 1-based numbers; unnumbered figures get
            // `figureNumber: null` and are skipped by the counter.
            const figureUpdates: { pos: number; figureNumber: number | null }[] = [];
            const figureMap = new Map<string, string>();
            let figureCounter = 0;
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name !== "figureBlock") return true;
              const isNumbered = nd.attrs.numbered !== false;
              let next: number | null = null;
              if (isNumbered) {
                figureCounter += 1;
                next = figureCounter;
              }
              const cur = nd.attrs.figureNumber as number | string | null;
              const curNorm =
                typeof cur === "string" && cur !== ""
                  ? parseInt(cur, 10)
                  : (cur as number | null);
              if (next !== curNorm) {
                figureUpdates.push({ pos, figureNumber: next });
              }
              const label = nd.attrs.label as string | undefined;
              if (label && next != null) {
                figureMap.set(label, String(next));
              }
              return false; // figureCaption child has no nested figures
            });

            // Resolve a label + refCommand → display text.
            const resolveRef = (label: string, refCommand: string): string => {
              if (!label) return "??";
              const heading = headingMap.get(label);
              if (heading) {
                return refCommand === "ref" ? heading : `(${heading})`;
              }
              // Example — parent form first
              const ex = exampleMap.get(label);
              if (ex) {
                return refCommand === "ref" ? ex.number : `(${ex.number})`;
              }
              const fig = figureMap.get(label);
              if (fig) {
                return refCommand === "ref" ? fig : `(${fig})`;
              }
              // Dotted "parent.sub" form for \getfullref (and \ref if the user
              // typed the dotted form)
              const dot = label.lastIndexOf(".");
              if (dot > 0) {
                const parentKey = label.slice(0, dot);
                const subKey = label.slice(dot + 1);
                const parent = exampleMap.get(parentKey);
                if (parent) {
                  const sub = parent.items.get(subKey) || subKey;
                  const full = `${parent.number}${sub}`;
                  return refCommand === "ref" ? full : `(${full})`;
                }
              }
              return "??";
            };

            // Check labelRef nodes for stale displayText
            const refUpdates: { pos: number; display: string }[] = [];
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name === "labelRef") {
                const resolved = resolveRef(
                  nd.attrs.label as string,
                  (nd.attrs.refCommand as string) || "ref",
                );
                if (nd.attrs.displayText !== resolved) {
                  refUpdates.push({ pos, display: resolved });
                }
              }
            });

            if (
              updates.length === 0 &&
              refUpdates.length === 0 &&
              figureUpdates.length === 0
            )
              return null;
            const tr = newState.tr;
            for (const { pos, num } of updates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, sectionNumber: num });
            }
            for (const { pos, figureNumber } of figureUpdates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, figureNumber });
            }
            for (const { pos, display } of refUpdates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, displayText: display });
            }
            return tr;
          },
        }),
      ];
    },
    // TipTap's Level type is 1..6; we widen to 0..6 because \part is
    // level 0 in our scheme. The schema attribute already accepts any
    // integer; configure() only uses `levels` for input rules and
    // keyboard shortcuts, both of which tolerate the wider range.
  }).configure({ levels: [0, 1, 2, 3, 4, 5, 6] as unknown as import("@tiptap/extension-heading").Level[] });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: { color: "var(--drag-highlight)", width: 2 },
      }),
      // Position 0 (after StarterKit). The observer must run first so
      // any appendTransaction plugin that wants to read the diff via
      // `readPendingDiff(state)` can do so. See
      // `docs/perf/keystroke-sanctity-findings.md` and
      // `src/lib/tiptap/doc-structure/`.
      DocStructureObserver,
      ParagraphWithTitle,
      HeadingWithLabel,
      BulletListWithTitle,
      OrderedListWithTitle,
      ListItemWithUuid,
      BlockquoteWithUuid,
      CodeBlockWithUuid,
      TexBlock.configure({
        isPoppedRef: texBlockIsPoppedPredicateRef,
      }),
      FigureBlock.configure({
        docIdRef,
        onConfirmLabelRenameRef,
        onConfirmFigureDeleteRef,
      }),
      FigureCaption,
      GraphicsBlock.configure({ docIdRef }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Highlight.configure({
        multicolor: true,
      }),
      TextColor,
      InlineMath,
      DisplayMath,
      Footnote,
      LatexComment,
      Citation,
      LabelRef,
      ExampleBlock,
      ExampleItemList,
      ExampleItem,
      ExampleGloss,
      AlignedGlossRow,
      ProseGlossRow,
      GlossCell,
      ExpexNumbering,
      AiRequestMarker,
      LatexCommandMark,
      SlashPopupExtension,
      SmartQuotes,
      LinkedAnchor,
      LinkedAnchorGuard,
      TitleField,
      MaketitleMarker,
      LabelHandler,
      EmptyParagraphTitleCleaner,
      ...(anchoredUuidsRef
        ? [MarginaliaAnchorGuard.configure({ anchoredUuidsRef })]
        : []),
      TabIndent,
      PgMarkChip,
      // Emits `data-uuid` decorations on every anchorable block's outer
      // DOM element. The marginalia registry + drag hit-test depend on
      // these attributes being present in the live DOM. See uuid-attr.ts
      // for why this needs to be a decoration and not renderHTML.
      UuidAttrDecorator,
      // Read-only enforcement plugin: rejects any transaction that
      // mutates the document when the React `editable` prop is false.
      // See the `readOnlyRef` comment near the top of this component
      // for why we keep `view.editable = true` instead of toggling it.
      Extension.create({
        name: "readOnlyEnforcer",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: new PluginKey("readOnlyEnforcer"),
              filterTransaction(tr) {
                if (!readOnlyRef.current) return true;
                if (!tr.docChanged) return true;
                // Programmatic citation attribute syncs (panel-driven
                // type changes refreshing the inline citation's command
                // / displayText) tag their transactions with this meta
                // so they pass through even in collaborator read-only
                // mode. They don't touch document text, just node attrs.
                if (tr.getMeta("ignoreReadOnly")) return true;
                return false;
              },
            }),
          ];
        },
      }),
    ],
    content: initialContent,
    // Always mount PM with `editable: true` so the DOM stays
    // `contenteditable="true"` and the browser/PM duo continues to sync
    // native drag-to-select to `view.state.selection`. The user-facing
    // read-only flag is enforced by the `readOnlyEnforcer` plugin above
    // (rejects doc-modifying transactions) and the `readOnlyRef` guards
    // on the imperative drop / drag paths.
    editable: true,
    editorProps: {
      attributes: {
        // Page padding driven by --editor-pl / --editor-pr / --editor-pt
        // / --editor-pb (set on the editor column from the persisted
        // user prefs `editor{Left,Right,Top,Bottom}Margin`, defaults
        // 88/72/40/40). The left default 88 = 72px marginalia gutter
        // + 8px breathing strip for heading fold-chevron + extra.
        // Right 72 sits flush against the 72px right gutter.
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
          "prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] pl-[var(--editor-pl,88px)] pr-[var(--editor-pr,72px)] pt-[var(--editor-pt,40px)] pb-[var(--editor-pb,40px)]",
        // PM keeps the DOM at `contenteditable="true"` even in Reader
        // mode (so native drag-to-select reaches `view.state.selection`,
        // and the unified TextObjectGrabHandle / linkedRange-float flow
        // inherits from the main editor). Suppress the spellcheck
        // underlines that would otherwise appear under prose in
        // read-only docs.
        ...(editable ? {} : { spellcheck: "false" }),
      },
      handleDOMEvents: {
        // The only two canonical text moves are drag-to-pop-out (custom
        // mousedown lift on the 6-dot grip) and drop-mode (shift-drag on a
        // float header). Both bypass HTML5 drag. Anything else — browser-
        // native text-selection drag from contenteditable, an accidental
        // node drag — is suppressed here. The surviving inline-atom native
        // drags (footnote and aiRequestMarker) opt in via `draggable="true"`
        // on their own NodeView DOM and are allowed through.
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
        // --- AI request marker drop (from any panel's AiRequestCard) ---
        const aiReqData = event.dataTransfer?.getData(MIME_AI_REQUEST);
        if (aiReqData) {
          event.preventDefault();
          try {
            const { requestId, kind, text } = JSON.parse(aiReqData) as {
              requestId?: string;
              kind?: string;
              text?: string;
            };
            if (!requestId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;
            const node = view.state.schema.nodes.aiRequestMarker.create({
              requestId,
              kind: kind || "footnote",
              text: text || "",
            });
            const tr = view.state.tr.insert(pos.pos, node);
            view.dispatch(tr);
          } catch { /* ignore bad data */ }
          return true;
        }

        // All paragraph-level anchor drags (notes, quotations, todos,
        // marginalia moves) are handled exclusively by Marginalia.tsx,
        // which uses the visible drop indicator to determine the target.
        // Returning false tells ProseMirror to ignore the drop, letting
        // the event bubble to the Marginalia scroll-container handler.
        if (isAnchorDrag(event.dataTransfer)) return false;

        // --- Marginalia move (drag a gutter icon to a new paragraph) ---
        const margData = event.dataTransfer?.getData(MIME_MARGINALIA_MOVE);
        if (margData) {
          try {
            const { type, entityId, currentParagraphId } = JSON.parse(margData);
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true; // no preventDefault → Marginalia handles
            event.preventDefault();
            const paragraphId = ensureAnchorUuid(view, posResult.pos);
            if (paragraphId && paragraphId !== currentParagraphId) {
              window.dispatchEvent(
                new CustomEvent("virgil-marginalia-reanchor", {
                  detail: { type, entityId, oldParagraphId: currentParagraphId, newParagraphId: paragraphId },
                })
              );
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Quotation drop (from QuotationsPanel) ---
        const quotData = event.dataTransfer?.getData(MIME_QUOTATION);
        if (quotData) {
          try {
            const { groupId } = JSON.parse(quotData);
            if (!groupId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true; // no preventDefault → Marginalia handles
            event.preventDefault();
            const paragraphId = ensureAnchorUuid(view, posResult.pos);
            if (paragraphId) {
              window.dispatchEvent(
                new CustomEvent("virgil-quotation-drop", {
                  detail: { groupId, paragraphId },
                })
              );
            }
          } catch { /* ignore bad data */ }
          return true;
        }

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

        // --- Quote drop (from QuotationsPanel — individual quote pod) ---
        // Inserts the quoted text wrapped in curly quotes followed by a
        // citation node for the quote's cite key + page number. Uses the
        // same onCitationDrop callback to register the citation in the
        // side panel store.
        const quoteData = event.dataTransfer?.getData(MIME_QUOTE);
        if (quoteData) {
          event.preventDefault();
          try {
            const { quoteText, command } = JSON.parse(quoteData) as {
              quoteText?: string;
              command?: string;
            };
            const text = (quoteText ?? "").trim();
            if (!text) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;

            const schema = view.state.schema;
            const opening = `\u201C${text}`;
            const closing = `\u201D`;

            // Build the nodes array in insertion order so a single
            // tr.insert call can place everything atomically — avoids
            // position-tracking bugs when combining text + atoms.
            const nodes: PMNode[] = [];
            nodes.push(schema.text(opening));

            if (command && onCitationDropRef.current) {
              const result = onCitationDropRef.current(command);
              if (result) {
                // Text up through the closing quote, followed by a
                // space, then the citation atom.
                nodes.push(schema.text(`${closing} `));
                nodes.push(
                  schema.nodes.citation.create({
                    citationId: result.id,
                    command,
                    displayText: result.displayText,
                  }),
                );
              } else {
                nodes.push(schema.text(closing));
              }
            } else {
              nodes.push(schema.text(closing));
            }

            const tr = view.state.tr.insert(pos.pos, nodes);
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

        // --- Note drop (from NotesPanel) ---
        // Anchors the note to the paragraph at the drop point.
        const noteData = event.dataTransfer?.getData(MIME_NOTE);
        if (noteData) {
          try {
            const { noteId } = JSON.parse(noteData);
            if (!noteId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true; // no preventDefault → Marginalia handles
            event.preventDefault();
            const paragraphId = ensureAnchorUuid(view, posResult.pos);
            if (paragraphId) {
              window.dispatchEvent(
                new CustomEvent("virgil-note-drop", {
                  detail: { noteId, paragraphId },
                })
              );
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Cutter card drop (from CutterPanel — comment or suggestion) ---
        const cutData = event.dataTransfer?.getData(MIME_CUT);
        if (cutData) {
          try {
            const parsed = JSON.parse(cutData);
            // Payload shape evolved from { cutId } to { cardId, kind }.
            // Accept both for forward compat.
            const cardId: string | undefined = parsed.cardId ?? parsed.cutId;
            if (!cardId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true; // no preventDefault → Marginalia handles
            event.preventDefault();
            const paragraphId = ensureAnchorUuid(view, posResult.pos);
            if (paragraphId) {
              window.dispatchEvent(
                new CustomEvent("virgil-cut-drop", {
                  detail: { cardId, paragraphId },
                })
              );
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Todo drop (from TodoPanel) ---
        const todoData = event.dataTransfer?.getData(MIME_TODO);
        if (todoData) {
          try {
            const { todoId } = JSON.parse(todoData);
            if (!todoId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true; // no preventDefault → Marginalia handles
            event.preventDefault();
            const paragraphId = ensureAnchorUuid(view, posResult.pos);
            if (paragraphId) {
              window.dispatchEvent(
                new CustomEvent("virgil-todo-drop", {
                  detail: { todoId, paragraphId },
                })
              );
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

              setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("virgil-footnote-panel-dropped", {
                    detail: { footnoteId, isOrphan },
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
    onUpdate: ({ editor }) => {
      onUpdate(editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // No `setEditable` sync: PM stays `editable: true` for the entire
  // lifetime of the view so native selection always works. Read-only
  // is enforced by the `readOnlyEnforcer` plugin's `filterTransaction`
  // (gated on `readOnlyRef`), and external callers (collab, the prop)
  // flip that ref by re-rendering with a new `editable` value.

  // Paragraph drag-handle hover: detect via Y coordinate against each
  // wrapper's bounding rect, scoped to the editor's scroll container.
  // Why not CSS :hover or mouseover-on-dom? The grab handle and popout
  // button sit in the marginalia gutter, which is OUTSIDE the
  // contenteditable element. Once the cursor leaves the contenteditable
  // (e.g. moving from text into the gutter to grab the handle), a
  // mouseover-on-dom listener fires mouseleave and the .hovered class
  // is dropped — so the handle disappears mid-reach. Y-based detection
  // on the scroll container keeps the band lit for the full row the
  // paragraph occupies, regardless of where horizontally the cursor
  // sits (text, left gutter, right gutter).
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

      editor.chain().selectAll().unsetHighlight().run();

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
        // Scroll into view
        const domAtPos = editor.view.domAtPos(pos);
        const el = domAtPos.node instanceof HTMLElement
          ? domAtPos.node
          : domAtPos.node.parentElement;
        el?.scrollIntoView({ behavior: "instant", block: "center" });
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
          editor.chain().focus().insertContent({
            type: "latexComment",
            attrs: { text: content.slice(2) },
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
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: "footnote",
          attrs: { footnoteId, content, number: 0, title: opts?.title ?? "" },
        })
        .run();
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
      editor
        .chain()
        .focus()
        .insertContent({
          type: "footnote",
          attrs: { footnoteId, content, number: 0, title: opts?.title ?? "" },
        })
        .run();
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
        node.forEach((child) => {
          if (child.type.name === "paragraph") {
            bodyParagraphs.push(child.textContent);
          }
        });
        const bodyText = bodyParagraphs.join("\n").trim();
        // Top-level sub-items: walk the first exampleItemList only, so
        // nested xlists don't get inlined into the flat list (they
        // remain accessible via the .tex source editor).
        const items: ExampleSubItem[] = [];
        node.forEach((child) => {
          if (child.type.name === "exampleItemList" && items.length === 0) {
            child.forEach((it) => {
              if (it.type.name !== "exampleItem") return;
              items.push({
                subLabel: (it.attrs.subLabel as string) || "",
                label: (it.attrs.label as string) || "",
                tag: (it.attrs.tag as string) || "",
                text: it.textContent.trim(),
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
          items,
          latex,
        });
        return false;
      });
      return out;
    },

    replaceExampleLatex(exampleId: string, latex: string): boolean {
      if (!editor) return false;
      let parsed: JSONContent;
      try {
        parsed = parseLatex(latex);
      } catch {
        return false;
      }
      // Find the first exampleBlock in the parsed result. The user's input
      // may include surrounding whitespace or stray paragraphs — we ignore
      // those and only adopt the first \ex…\xe block we encounter.
      let newJson: JSONContent | null = null;
      const walk = (n: JSONContent): boolean => {
        if (n.type === "exampleBlock") { newJson = n; return true; }
        if (n.content) for (const c of n.content) if (walk(c)) return true;
        return false;
      };
      walk(parsed);
      if (!newJson) return false;
      // Force the uuid to match the original so any links/references that
      // point at this example remain valid across the edit.
      const existingAttrs = (newJson as JSONContent).attrs ?? {};
      (newJson as JSONContent).attrs = { ...existingAttrs, uuid: exampleId };
      // Locate target in the editor's doc.
      let target = -1;
      let oldNodeSize = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "exampleBlock" && node.attrs.uuid === exampleId) {
          target = pos;
          oldNodeSize = node.nodeSize;
          return false;
        }
        return true;
      });
      if (target < 0) return false;
      let newNode;
      try {
        newNode = editor.schema.nodeFromJSON(newJson);
      } catch {
        return false;
      }
      const tr = editor.state.tr.replaceWith(target, target + oldNodeSize, newNode);
      editor.view.dispatch(tr);
      return true;
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

    insertExample(kind: "single" | "multi"): { exampleId: string } | null {
      if (!editor) return null;
      const existing = new Set<string>();
      editor.state.doc.descendants((n) => {
        if (n.type.name === "exampleBlock" && n.attrs.uuid) {
          existing.add(n.attrs.uuid as string);
        }
        return true;
      });
      const exampleId = generateShortId(existing);
      const single: any = {
        type: "exampleBlock",
        attrs: {
          uuid: exampleId,
          tag: "",
          label: "",
          kind: "single",
          exnoOverride: null,
          suppressSpace: false,
          number: 0,
        },
        content: [{ type: "paragraph" }],
      };
      const multi: any = {
        type: "exampleBlock",
        attrs: {
          uuid: exampleId,
          tag: "",
          label: "",
          kind: "multi",
          exnoOverride: null,
          suppressSpace: false,
          number: 0,
        },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { tag: "", label: "", subLabel: "" },
                content: [{ type: "paragraph" }],
              },
              {
                type: "exampleItem",
                attrs: { tag: "", label: "", subLabel: "" },
                content: [{ type: "paragraph" }],
              },
            ],
          },
          {
            type: "exampleGloss",
            attrs: { glossId: null, colCount: 1 },
            content: [
              {
                type: "alignedGlossRow",
                attrs: { tier: "gla" },
                content: [{ type: "glossCell", content: [] }],
              },
              {
                type: "proseGlossRow",
                attrs: { tier: "glft" },
                content: [],
              },
            ],
          },
        ],
      };
      editor.chain().focus().insertContent(kind === "multi" ? multi : single).run();
      // Place the cursor inside the first editable paragraph of the
      // newly-inserted example so the user can start typing immediately.
      // `insertContent` doesn't do this for us when the root node is
      // `isolating: true`.
      let target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (
          node.type.name === "exampleBlock" &&
          node.attrs.uuid === exampleId
        ) {
          // Walk into the block, find the first paragraph descendant.
          node.descendants((child, relPos) => {
            if (target >= 0) return false;
            if (child.type.name === "paragraph") {
              // +1 to step inside the paragraph's content
              target = pos + 1 + relPos + 1;
              return false;
            }
            return true;
          });
          return false;
        }
        return true;
      });
      if (target >= 0) {
        editor
          .chain()
          .focus()
          .setTextSelection(target)
          .scrollIntoView()
          .run();
      }
      return { exampleId };
    },

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
      editor
        .chain()
        .focus()
        .insertContent({
          type: "citation",
          attrs: { citationId, command, displayText },
        })
        .run();
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
      // Skip records whose anchor id is already present (already marked).
      const present = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (!node.isText) return true;
        for (const m of node.marks) {
          if (m.type.name === "linkedAnchor" && m.attrs.anchorId) {
            present.add(m.attrs.anchorId as string);
          }
        }
        return true;
      });
      for (const rec of records) {
        if (!rec.anchorId || !rec.text) continue;
        if (present.has(rec.anchorId)) continue;
        reanchorByText(editor, rec.kind, rec.text, rec.anchorId);
      }
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
    restoreCursorToParagraph(uuid: string): void {
      if (!editor) return;
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
        // Scroll first (moves selection to paragraph start internally),
        // then place cursor at end + take DOM focus. Focus can silently
        // no-op on the very first load if the browser blocks autofocus
        // without a user gesture — the selection still lands correctly,
        // so the cursor is ready the moment the user clicks anywhere.
        (this as EditorHandle).scrollToParagraphId(uuid);
        editor.commands.setTextSelection(endPos);
        editor.view.focus();
      } catch {
        /* position out of range — silently skip */
      }
    },
  }), [editor]);

  const applyHighlight = useCallback(() => {
    if (!editor) return;

    // Remember where the user's selection is so we can restore it after the
    // selectAll-then-unset dance. Without this, when there's nothing new to
    // highlight (e.g. clearing on click-away), the editor's selection is left
    // spanning the entire doc — the browser renders this as a grey
    // "inactive selection" ghost whenever the editor is blurred.
    const prevSelection = editor.state.selection;
    editor.chain().selectAll().unsetHighlight().setTextSelection(prevSelection.from).run();

    // Position-based highlight (from search panel) takes priority
    const range = highlightRangeRef.current;
    if (range) {
      try {
        editor
          .chain()
          .setTextSelection(range)
          .setHighlight({ color: "#fbbf2480" })
          .setTextSelection(range.from)
          .run();

        const domAtPos = editor.view.domAtPos(range.from);
        if (domAtPos.node instanceof HTMLElement || domAtPos.node.parentElement) {
          const el =
            domAtPos.node instanceof HTMLElement
              ? domAtPos.node
              : domAtPos.node.parentElement;
          el?.scrollIntoView({ behavior: "instant", block: "center" });
        }
      } catch { /* pos out of range after edit */ }
      return;
    }

    // Linked-anchor highlight — driven by hover/click of margin icon or card.
    // Does NOT scroll (avoids jumping the viewport every time the user hovers).
    const anchorId = activeAnchorIdRef.current;
    if (anchorId) {
      const anchorRange = resolveAnchorRange(editor, anchorId);
      if (anchorRange) {
        try {
          editor
            .chain()
            .setTextSelection(anchorRange)
            .setHighlight({ color: activeAnchorColorRef.current || "#fbbf2480" })
            .setTextSelection(anchorRange.from)
            .run();
        } catch { /* pos out of range */ }
        return;
      }
    }

    // Text-based highlight (from revisions/suggestions)
    if (!highlightTextRef.current) return;

    const textRange = findTextRange(editor, highlightTextRef.current);
    if (!textRange) return;

    editor
      .chain()
      .setTextSelection(textRange)
      .setHighlight({ color: "#fbbf2480" })
      .setTextSelection(textRange.from)
      .run();

    const domAtPos = editor.view.domAtPos(textRange.from);
    if (domAtPos.node instanceof HTMLElement || domAtPos.node.parentElement) {
      const el =
        domAtPos.node instanceof HTMLElement
          ? domAtPos.node
          : domAtPos.node.parentElement;
      el?.scrollIntoView({ behavior: "instant", block: "center" });
    }
  }, [editor]);

  useEffect(() => {
    highlightTextRef.current = highlightText;
    highlightRangeRef.current = highlightRange;
    activeAnchorIdRef.current = activeAnchorId;
    activeAnchorColorRef.current = activeAnchorColor;
    applyHighlight();
  }, [highlightText, highlightRange, activeAnchorId, activeAnchorColor, applyHighlight]);

  // Keep the stable editor ref in sync for SelectionDragHandle and
  // anything else that needs a non-rerendering handle.
  useEffect(() => {
    editorInstanceRef.current = editor;
    return () => {
      if (editorInstanceRef.current === editor) {
        editorInstanceRef.current = null;
      }
    };
  }, [editor]);

  // Verification hook: expose the DocStructureObserver's emit counter
  // on `window.__virgilBusStats` so the keystroke-sanctity success
  // criteria can be checked live in the dev preview. The getter reads
  // the bus on demand — no RAF polling, zero per-keystroke cost.
  // See `docs/perf/keystroke-sanctity-findings.md` §9.
  useEffect(() => {
    if (typeof window === "undefined" || !editor) return;
    type BusStats = { emitCount: number; version: number };
    type StatsHost = {
      __virgilBusStats?: BusStats | (() => BusStats | null) | null;
    };
    const w = window as unknown as StatsHost;
    let cancelled = false;
    void import("@/lib/tiptap/doc-structure").then(({ getBus }) => {
      if (cancelled) return;
      w.__virgilBusStats = (): BusStats | null => {
        const bus = getBus(editor);
        if (!bus) return null;
        return { emitCount: bus.emitCount, version: bus.structure.version };
      };
    });
    return () => {
      cancelled = true;
      w.__virgilBusStats = null;
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
  // registry, so shift-drag hit-testing can find this editor under the
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
