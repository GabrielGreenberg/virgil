"use client";

import { useEditor, EditorContent, JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import { mergeAttributes } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import { useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { InlineMath, DisplayMath, Footnote, LatexComment, ArchiveMarker, Citation, LabelRef, LatexCommandMark, LabelHandler, TitleField, MaketitleMarker, EmptyParagraphTitleCleaner, AiRequestMarker, MarginaliaAnchorGuard, LinkedAnchor, LinkedAnchorGuard, ExampleBlock, ExampleItemList, ExampleItem, ExampleGloss, AlignedGlossRow, ProseGlossRow, GlossCell, ExpexNumbering } from "@/lib/tiptap-extensions";
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
import { alignEntryToY } from "@/components/editor-layout/layout-scroll";
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
  MIME_SELECTION_ANCHOR,
  isAnchorDrag,
} from "@/lib/marginalia";
import { MIME_PAR_CAPTURE, MIME_TEXT_CAPTURE } from "@/hooks/usePanelCapture";
import { generateNodeUuid, generateEntityId } from "@/lib/uuid";
import { autoSizeInput } from "@/lib/autoSizeInput";
import { normalizeRichContent } from "@/lib/footnote-content";
import type { JSONContent as TipJSON } from "@tiptap/react";
import MenuBar from "./MenuBar";
import { createPopoutButtonEl } from "./panel-primitives";
import {
  sectionFoldingPlugin,
  sectionFoldingPluginKey,
  getSectionFoldingState,
} from "@/lib/section-folding";
import { getSectionRangeByUuid } from "@/lib/section-range";

/**
 * Resolve a ProseMirror position to the nearest anchorable node, handling
 * both container nodes (paragraph, heading, list) and atom blocks
 * (displayMath, latexComment) where posAtCoords lands before/after the atom.
 */
function resolveAnchorableNode(
  view: import("@tiptap/pm/view").EditorView,
  pos: number,
): { node: PMNode; nodePos: number } | null {
  const $pos = view.state.doc.resolve(pos);
  // Walk up ancestors (works when cursor is inside an anchorable node)
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (isAnchorableNode(node.type)) {
      const nodePos = depth === 0 ? 0 : $pos.before(depth);
      return { node, nodePos };
    }
  }
  // Fallback: check adjacent nodes (e.g. pos 0 is before the first heading)
  if ($pos.nodeAfter && isAnchorableNode($pos.nodeAfter.type)) {
    return { node: $pos.nodeAfter, nodePos: pos };
  }
  if ($pos.nodeBefore && isAnchorableNode($pos.nodeBefore.type)) {
    return { node: $pos.nodeBefore, nodePos: pos - $pos.nodeBefore.nodeSize };
  }
  return null;
}

/**
 * Ensure the anchorable node at `pos` has a UUID. Assigns one if missing.
 * Collects all existing UUIDs in the document to avoid collisions.
 * Returns the UUID or null if no anchorable node was found.
 */
function ensureAnchorUuid(
  view: import("@tiptap/pm/view").EditorView,
  pos: number,
): string | null {
  const result = resolveAnchorableNode(view, pos);
  if (!result) return null;
  const { node, nodePos } = result;
  if (node.attrs?.uuid) return node.attrs.uuid as string;
  // Collect existing UUIDs to guarantee uniqueness
  const existing = new Set<string>();
  view.state.doc.descendants((n) => {
    if (n.attrs?.uuid) existing.add(n.attrs.uuid as string);
  });
  const newUuid = generateNodeUuid(existing);
  try {
    const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
      ...node.attrs,
      uuid: newUuid,
    });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
    return newUuid;
  } catch {
    return null;
  }
}

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
  /**
   * Click handler for the gutter popout button on each paragraph. Called
   * with the paragraph's UUID (generated if missing). When omitted, the
   * button still renders but is a no-op — wire it up via EditorLayout to
   * actually open/close the floating paragraph card.
   */
  onToggleParagraphPopout?: (uuid: string, anchor?: DOMRect | null) => void;
  /**
   * Ref to a predicate that reports whether a given paragraph UUID is
   * currently popped out. The node view consults this on each render to
   * swap the popout button's glyph (up arrow ↔ down arrow). When omitted,
   * the button always renders as "docked".
   */
  paragraphIsPoppedRef?: React.RefObject<(uuid: string) => boolean>;
  /** Same as onToggleParagraphPopout, but for headings (chapters/sections/etc.). */
  onToggleHeadingPopout?: (uuid: string) => void;
  /** Same as paragraphIsPoppedRef, but for headings. */
  headingIsPoppedRef?: React.RefObject<(uuid: string) => boolean>;
  /** Same as onToggleParagraphPopout, but for `\ex` / `\pex` example blocks. */
  onToggleExamplePopout?: (uuid: string, anchor?: DOMRect | null) => void;
  /** Same as paragraphIsPoppedRef, but for example blocks. */
  exampleIsPoppedRef?: React.RefObject<(uuid: string) => boolean>;
}

export interface FootnoteInfo {
  footnoteId: string;
  content: TipJSON;
  number: number;
  pos: number;
  title?: string;
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
  getCitations: () => { citationId: string; command: string; displayText: string; pos: number }[];
  scrollToCitation: (citationId: string, sourceEl?: HTMLElement | null) => void;
  updateCitationDisplay: (citationId: string, displayText: string) => void;
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
  /** Tell every paragraph node view to re-read the popped predicate.
   *  Called by EditorLayout whenever the popped-cards list changes so
   *  the gutter popout-button glyph (arrow ↔ X) stays in sync when the
   *  float is closed via its own X button. */
  refreshParagraphPopouts: () => void;
  /** Same as refreshParagraphPopouts, but for heading node views. */
  refreshHeadingPopouts: () => void;
  /** Same as refreshParagraphPopouts, but for `\ex` / `\pex` example blocks. */
  refreshExamplePopouts: () => void;
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
  { initialContent, onUpdate, highlightText, highlightRange, onAddComment, onArchive, onEditorReady, onCitationDrop, onConfirmFootnoteMove, onConfirmLabelRename, isLabelTaken, anchoredUuidsRef, activeAnchorId, activeAnchorColor, onToggleParagraphPopout, paragraphIsPoppedRef, onToggleHeadingPopout, headingIsPoppedRef, onToggleExamplePopout, exampleIsPoppedRef },
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
  const onToggleParagraphPopoutRef = useRef(onToggleParagraphPopout);
  onToggleParagraphPopoutRef.current = onToggleParagraphPopout;
  const paragraphIsPoppedPredicateRef = useRef(paragraphIsPoppedRef);
  paragraphIsPoppedPredicateRef.current = paragraphIsPoppedRef;
  // Registry of live paragraph node views. Each node view adds itself on
  // create and removes itself on destroy; EditorLayout triggers a refresh
  // through this when the popped-cards list changes (e.g. the float's own
  // close button runs, or state is restored from localStorage).
  const paragraphPopoutRefreshersRef = useRef<Set<() => void>>(new Set());
  // Same triplet for headings (chapters/sections/subsections etc.).
  const onToggleHeadingPopoutRef = useRef(onToggleHeadingPopout);
  onToggleHeadingPopoutRef.current = onToggleHeadingPopout;
  const headingIsPoppedPredicateRef = useRef(headingIsPoppedRef);
  headingIsPoppedPredicateRef.current = headingIsPoppedRef;
  const headingPopoutRefreshersRef = useRef<Set<() => void>>(new Set());
  // Same triplet for example blocks (`\ex` / `\pex`). Threaded into the
  // ExampleBlock extension via .configure() so its node view can dispatch
  // popout toggles and read the current popped state.
  const onToggleExamplePopoutRef = useRef(onToggleExamplePopout);
  onToggleExamplePopoutRef.current = onToggleExamplePopout;
  const exampleIsPoppedPredicateRef = useRef(exampleIsPoppedRef);
  exampleIsPoppedPredicateRef.current = exampleIsPoppedRef;
  const examplePopoutRefreshersRef = useRef<Set<() => void>>(new Set());
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

  // Stashes pending capture-drag payloads. ProseMirror's internal
  // dragstart handler rewrites DataTransfer (setting text/html +
  // text/plain) after our per-element listeners run, wiping any MIME we
  // set there. We instead apply our MIME in a window-level dragstart
  // listener (bubble phase), which fires AFTER PM's handler.
  const pendingParCaptureUuidRef = useRef<string | null>(null);
  const pendingTextCaptureRef = useRef<{ from: number; to: number; paragraphId: string | null; selectedText: string } | null>(null);

  const ParagraphWithTitle = Paragraph.extend({
    draggable: true,
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        let currentNode = node;
        let dragHandleEl: HTMLElement | null = null;

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

        // 6-dot drag grip — vertical orientation, positioned just left of paragraph text
        const SVG_NS = "http://www.w3.org/2000/svg";
        const dragHandle = document.createElement("div");
        dragHandle.className = "par-drag-handle";
        dragHandle.setAttribute("data-drag-handle", "");
        dragHandle.draggable = true;
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("width", "10");
        svg.setAttribute("height", "14");
        svg.setAttribute("viewBox", "0 0 10 14");
        svg.setAttribute("fill", "currentColor");
        for (const [cx, cy] of [[3,2],[7,2],[3,7],[7,7],[3,12],[7,12]]) {
          const c = document.createElementNS(SVG_NS, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", "1.2");
          svg.appendChild(c);
        }
        dragHandle.appendChild(svg);
        pContainer.appendChild(dragHandle);

        // Popout button — sits in the gutter directly above the grab bar,
        // hover-revealed. Wired via props so EditorLayout can open/close
        // the floating paragraph card. The popped state lives in React;
        // we mirror it locally so the glyph flips immediately on click
        // (without waiting for a ProseMirror transaction to trigger
        // update()). The authoritative predicate still overrides on any
        // node-view update so we stay in sync if the float is closed
        // from the float's own controls.
        let popoutBtnEl: HTMLButtonElement | null = null;
        let poppedState = false;
        function syncPoppedFromPredicate() {
          const uuid = currentNode.attrs?.uuid as string | null;
          const predicate = paragraphIsPoppedPredicateRef.current?.current;
          if (uuid && predicate) poppedState = predicate(uuid);
        }
        function renderPopoutBtn() {
          const next = createPopoutButtonEl({
            isPoppedOut: poppedState,
            variant: "x",
            labelNoun: "paragraph",
            extraClass: "par-popout-btn",
            onClick: (anchor) => {
              const handlePos = typeof getPos === "function" ? getPos() : null;
              if (handlePos == null) return;
              let ensuredUuid = currentNode.attrs?.uuid as string | null;
              if (!ensuredUuid) {
                ensuredUuid = ensureAnchorUuid(nodeEditor.view, handlePos + 1);
              }
              if (ensuredUuid) {
                onToggleParagraphPopoutRef.current?.(ensuredUuid, anchor);
                poppedState = !poppedState;
                renderPopoutBtn();
              }
            },
          });
          if (popoutBtnEl && popoutBtnEl.parentNode === pContainer) {
            pContainer.replaceChild(next, popoutBtnEl);
          } else {
            pContainer.appendChild(next);
          }
          popoutBtnEl = next;
        }
        syncPoppedFromPredicate();
        renderPopoutBtn();

        // Reconciler invoked by the React side when poppedCards changes
        // (e.g. float-X close). Reads the live predicate and rebuilds if
        // it disagrees with our local state.
        const refresher = () => {
          const uuid = currentNode.attrs?.uuid as string | null;
          const predicate = paragraphIsPoppedPredicateRef.current?.current;
          if (!uuid || !predicate) return;
          const actual = predicate(uuid);
          if (actual !== poppedState) {
            poppedState = actual;
            renderPopoutBtn();
          }
        };
        paragraphPopoutRefreshersRef.current.add(refresher);

        wrapper.appendChild(pContainer);
        dragHandleEl = dragHandle;

        // Button-like press feedback on the grip itself
        dragHandle.addEventListener("mousedown", () => {
          dragHandle.classList.add("is-pressed");
        });
        dragHandle.addEventListener("dragend", () => {
          dragHandle.classList.remove("is-pressed");
        });
        dragHandle.addEventListener("mouseup", () => {
          dragHandle.classList.remove("is-pressed");
        });

        // Tag the drag with a paragraph-capture MIME so side panels can
        // accept whole-paragraph drops (e.g. drop onto archive to archive
        // the paragraph, leaving an empty shell + margin marker behind).
        // We don't preventDefault — ProseMirror still sees this as a
        // normal node drag for in-editor reordering.
        // Stash the dragged paragraph's UUID so the editor-level dragstart
        // (registered in handleDOMEvents) can tag the DataTransfer with
        // MIME_PAR_CAPTURE AFTER ProseMirror's default handler clears it.
        // ProseMirror rebuilds the DataTransfer during its own dragstart
        // default (setting text/html + text/plain), wiping anything set
        // from this handle-level listener.
        dragHandle.addEventListener("dragstart", (e) => {
          const dt = (e as DragEvent).dataTransfer;
          if (dt) {
            const ghost = p.cloneNode(true) as HTMLElement;
            const cs = window.getComputedStyle(p);
            const w = p.offsetWidth;
            ghost.style.cssText =
              "position:absolute;top:-9999px;left:-9999px;" +
              (w > 0 ? `width:${w}px;` : "max-width:520px;") +
              "opacity:0.5;margin:0;padding:0;background:transparent;" +
              `color:${cs.color};` +
              `font-family:${cs.fontFamily};` +
              `font-size:${cs.fontSize};` +
              `font-weight:${cs.fontWeight};` +
              `font-style:${cs.fontStyle};` +
              `line-height:${cs.lineHeight};` +
              `letter-spacing:${cs.letterSpacing};` +
              "pointer-events:none;";
            document.body.appendChild(ghost);
            dt.setDragImage(ghost, 12, 12);
            requestAnimationFrame(() => {
              try { document.body.removeChild(ghost); } catch {}
            });
          }
          const handlePos = typeof getPos === "function" ? getPos() : null;
          if (handlePos == null) return;
          let uuid = currentNode.attrs?.uuid as string | null;
          if (!uuid) {
            uuid = ensureAnchorUuid(nodeEditor.view, handlePos + 1);
          }
          if (uuid) pendingParCaptureUuidRef.current = uuid;
        });

        // Hover detection is handled by editor-level mouseover delegation
        // (see useEffect below) — per-wrapper listeners don't work reliably
        // inside contentEditable.

        function setTitle(newTitle: string | null) {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos != null) {
            const n = nodeEditor.state.doc.nodeAt(pos);
            if (n) {
              const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
              // Assign UUID if setting a title and node doesn't have one yet
              if (newTitle && !attrs.uuid) {
                attrs.uuid = generateNodeUuid();
              }
              const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
              nodeEditor.view.dispatch(tr);
            }
          }
        }

        function enterEditMode() {
          // Show annotation area and place input over it
          wrapper.classList.add("has-add-btn");
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
            // Let ProseMirror handle events from the drag grip handle
            if (dragHandleEl && (dragHandleEl === event.target || dragHandleEl.contains(event.target as Node))) {
              return false;
            }
            if (popoutBtnEl && (popoutBtnEl === event.target || popoutBtnEl.contains(event.target as Node))) {
              return true;
            }
            return (
              titleAnnot === event.target || titleAnnot.contains(event.target as Node)
            );
          },
          ignoreMutation(mutation) {
            if (titleAnnot.contains(mutation.target)) return true;
            if (mutation.target === wrapper) return true;
            if (dragHandle.contains(mutation.target)) return true;
            if (popoutBtnEl && popoutBtnEl.contains(mutation.target as Node)) return true;
            return false;
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "paragraph") return false;
            currentNode = updatedNode;
            if (!titleAnnot.querySelector("input")) renderAnnot();
            // Intentionally NOT resyncing popped state here: the React
            // state update triggered by a gutter-button click races the
            // ensureAnchorUuid transaction that also fires update(), and
            // at the moment update() runs the predicate is still stale.
            // The optimistic flip in the click handler is our source of
            // truth; reconcile via paragraphPopoutRefreshersRef instead.
            renderPopoutBtn();
            return true;
          },
          destroy() {
            paragraphPopoutRefreshersRef.current.delete(refresher);
          },
        };
      };
    },
  });

  // --- List title node view factory (shared by bullet + ordered lists) ---
  function createListTitleNodeView(tagName: "ul" | "ol", typeName: string) {
    return ({ node, getPos, editor: nodeEditor }: { node: any; getPos: (() => number | undefined) | boolean; editor: any }) => {
      let currentNode = node;

      const wrapper = document.createElement("div");
      wrapper.className = "list-title-wrapper";

      const titleAnnot = document.createElement("div");
      titleAnnot.className = "par-title-annotation";
      titleAnnot.contentEditable = "false";
      wrapper.appendChild(titleAnnot);

      const listEl = document.createElement(tagName);
      wrapper.appendChild(listEl);

      function setTitle(newTitle: string | null) {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) {
          const n = nodeEditor.state.doc.nodeAt(pos);
          if (n) {
            const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
            if (newTitle && !attrs.uuid) {
              attrs.uuid = generateNodeUuid();
            }
            const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
            nodeEditor.view.dispatch(tr);
          }
        }
      }

      function enterEditMode() {
        // Show annotation area and place input over it
        wrapper.classList.add("has-add-btn");
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
          const val = input.value.trim();
          setTitle(val || null);
          if (document.body.contains(input)) input.remove();
          if (document.body.contains(overlay)) overlay.remove();
        }
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); committed = true; cleanupSizer(); if (document.body.contains(input)) input.remove(); if (document.body.contains(overlay)) overlay.remove(); renderAnnot(); }
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
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: { default: null, rendered: false },
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ul", "bulletList");
    },
  });

  const OrderedListWithTitle = OrderedList.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: { default: null, rendered: false },
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ol", "orderedList");
    },
  });

  const BlockquoteWithUuid = Blockquote.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: { default: null, rendered: false },
      };
    },
  });

  const CodeBlockWithUuid = CodeBlock.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: { default: null, rendered: false },
      };
    },
  });

  const HeadingWithLabel = Heading.extend({
    // NOTE: deliberately not draggable at the schema level — we want the
    // gutter drag handle to move the WHOLE section (heading + nested
    // content) via the MIME_PAR_CAPTURE drop handler, not just the
    // heading node. PM's internal node-drag would only move the
    // heading; routing through our handler lets us look up the section
    // range and move the entire span.
    addAttributes() {
      return {
        ...this.parent?.(),
        label: { default: null },
        uuid: { default: null, rendered: false },
        numbered: { default: true, rendered: false },
        sectionNumber: { default: null, rendered: false },
      };
    },
    renderHTML({ HTMLAttributes, node }) {
      const level = node.attrs.level as number;
      return [`h${level}`, mergeAttributes(HTMLAttributes), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        const TYPE_NAMES = ["Chapter", "Section", "Subsection", "Subsubsection"];
        let currentNode = node;

        const wrapper = document.createElement("div");
        wrapper.className = `heading-wrapper heading-wrapper-l${node.attrs.level}`;

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

        // 6-dot drag grip — same shape as the paragraph drag handle, but
        // absolutely positioned in the heading wrapper so it sits just
        // left of the heading text. ProseMirror picks up the drag via the
        // data-drag-handle attribute (the heading node is draggable above).
        const SVG_NS_DH = "http://www.w3.org/2000/svg";
        const headingDrag = document.createElement("div");
        headingDrag.className = "heading-drag-handle";
        // No data-drag-handle attribute — see HeadingWithLabel.draggable
        // comment above. PM stays out of this drag so our handler can
        // move the whole section.
        headingDrag.draggable = true;
        const dhSvg = document.createElementNS(SVG_NS_DH, "svg");
        dhSvg.setAttribute("width", "10");
        dhSvg.setAttribute("height", "14");
        dhSvg.setAttribute("viewBox", "0 0 10 14");
        dhSvg.setAttribute("fill", "currentColor");
        for (const [cx, cy] of [[3,2],[7,2],[3,7],[7,7],[3,12],[7,12]]) {
          const c = document.createElementNS(SVG_NS_DH, "circle");
          c.setAttribute("cx", String(cx));
          c.setAttribute("cy", String(cy));
          c.setAttribute("r", "1.2");
          dhSvg.appendChild(c);
        }
        headingDrag.appendChild(dhSvg);
        headingDrag.addEventListener("mousedown", () => {
          headingDrag.classList.add("is-pressed");
        });
        headingDrag.addEventListener("dragend", () => {
          headingDrag.classList.remove("is-pressed");
        });
        headingDrag.addEventListener("mouseup", () => {
          headingDrag.classList.remove("is-pressed");
        });
        // Tag the drag with the same paragraph-capture MIME so panels and
        // the cross-editor drop handler recognise it. Heading is identified
        // by its uuid; we ensure one before stashing.
        headingDrag.addEventListener("dragstart", () => {
          const handlePos = typeof getPos === "function" ? getPos() : null;
          if (handlePos == null) return;
          let uuid = currentNode.attrs?.uuid as string | null;
          if (!uuid) {
            uuid = ensureAnchorUuid(nodeEditor.view, handlePos + 1);
          }
          if (uuid) pendingParCaptureUuidRef.current = uuid;
        });
        wrapper.appendChild(headingDrag);

        // Popout button — sits just left of the heading drag handle, same
        // geometry as the paragraph version. Wires onToggleHeadingPopout
        // through the same ref pattern as paragraphs so EditorLayout can
        // open/close a floating heading card.
        let headingPopoutBtnEl: HTMLButtonElement | null = null;
        let headingPoppedState = false;
        function syncHeadingPoppedFromPredicate() {
          const uuid = currentNode.attrs?.uuid as string | null;
          const predicate = headingIsPoppedPredicateRef.current?.current;
          if (uuid && predicate) headingPoppedState = predicate(uuid);
        }
        function renderHeadingPopoutBtn() {
          const next = createPopoutButtonEl({
            isPoppedOut: headingPoppedState,
            variant: "x",
            labelNoun: "section",
            extraClass: "heading-popout-btn",
            onClick: () => {
              const handlePos = typeof getPos === "function" ? getPos() : null;
              if (handlePos == null) return;
              let ensuredUuid = currentNode.attrs?.uuid as string | null;
              if (!ensuredUuid) {
                ensuredUuid = ensureAnchorUuid(nodeEditor.view, handlePos + 1);
              }
              if (ensuredUuid) {
                onToggleHeadingPopoutRef.current?.(ensuredUuid);
                headingPoppedState = !headingPoppedState;
                renderHeadingPopoutBtn();
              }
            },
          });
          if (headingPopoutBtnEl && headingPopoutBtnEl.parentNode === wrapper) {
            wrapper.replaceChild(next, headingPopoutBtnEl);
          } else {
            wrapper.appendChild(next);
          }
          headingPopoutBtnEl = next;
        }
        syncHeadingPoppedFromPredicate();
        renderHeadingPopoutBtn();

        const headingRefresher = () => {
          const uuid = currentNode.attrs?.uuid as string | null;
          const predicate = headingIsPoppedPredicateRef.current?.current;
          if (!uuid || !predicate) return;
          const actual = predicate(uuid);
          if (actual !== headingPoppedState) {
            headingPoppedState = actual;
            renderHeadingPopoutBtn();
          }
        };
        headingPopoutRefreshersRef.current.add(headingRefresher);

        function getTypeName(n: typeof node) {
          return TYPE_NAMES[Math.min((n.attrs.level as number) - 1, 3)];
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
          const secNum = currentNode.attrs.sectionNumber as string | null;
          const label = currentNode.attrs.label as string | null;
          annot.innerHTML = "";

          const typeSpan = document.createElement("span");
          if (isNumbered && secNum) {
            typeSpan.textContent = `${typeName} ${secNum}`;
          } else if (!isNumbered) {
            typeSpan.textContent = `${typeName}*`;
          } else {
            typeSpan.textContent = typeName;
          }
          annot.appendChild(typeSpan);

          if (label) {
            const sep = document.createElement("span");
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
        }

        renderAnnot();

        // Phase 1: prevent browser default on mousedown so the contenteditable
        // doesn't receive focus (which would let PM steal it back later).
        annot.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        // Phase 2: on click, enter edit mode if clicking on a label or the add button.
        annot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target as HTMLElement;
          if (target.classList.contains("heading-label-text")) {
            enterEditMode(target);
          } else if (target.classList.contains("heading-label-add")) {
            // For new label, we need to insert a label area first
            const labelSpan = document.createElement("span");
            labelSpan.className = "heading-label-text";
            // Add separator before label
            const sep = document.createElement("span");
            sep.textContent = "  ·  label: ";
            target.replaceWith(sep);
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
            // Don't swallow drag-related events on the drag handle — PM
            // needs them to start the node drag.
            const t = event.target as Node | null;
            if (
              t &&
              headingPopoutBtnEl &&
              (t === headingPopoutBtnEl || headingPopoutBtnEl.contains(t))
            ) return true;
            return false;
          },
          ignoreMutation(mutation) {
            // Ignore all mutations in the annotation area (label editing, etc.)
            if (annot.contains(mutation.target)) return true;
            // Mutations inside the fold chevron (contentEditable=false) should
            // also be ignored.
            if (foldBtn.contains(mutation.target)) return true;
            if (headingDrag.contains(mutation.target)) return true;
            if (headingPopoutBtnEl && headingPopoutBtnEl.contains(mutation.target)) return true;
            return false;
          },
          destroy() {
            nodeEditor.off("transaction", onTransaction);
            headingPopoutRefreshersRef.current.delete(headingRefresher);
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
            // Keep popout glyph in sync — uuid may have just been
            // populated, or the popped predicate's underlying state
            // may have changed.
            syncHeadingPoppedFromPredicate();
            renderHeadingPopoutBtn();
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
            if (headings.length === 0) return null;

            // Find top-level among numbered headings
            let topLevel = 5;
            for (const h of headings) {
              if (h.numbered && h.level < topLevel) topLevel = h.level;
            }

            const counters = [0, 0, 0, 0];
            const updates: { pos: number; num: string | null }[] = [];

            for (const h of headings) {
              if (h.numbered && topLevel <= 4) {
                const idx = h.level - 1;
                counters[idx]++;
                for (let i = idx + 1; i < 4; i++) counters[i] = 0;
                const parts: number[] = [];
                for (let i = topLevel - 1; i <= idx; i++) parts.push(counters[i]);
                const num = parts.join(".");
                if (num !== h.cur) updates.push({ pos: h.pos, num });
              } else if (h.cur !== null) {
                updates.push({ pos: h.pos, num: null });
              }
            }

            // Build label→section-number map from headings
            const headingMap = new Map<string, string>();
            for (const h of headings) {
              if (h.numbered && topLevel <= 4) {
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

            if (updates.length === 0 && refUpdates.length === 0) return null;
            const tr = newState.tr;
            for (const { pos, num } of updates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, sectionNumber: num });
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
  }).configure({ levels: [1, 2, 3, 4] });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: { color: "var(--drag-highlight)", width: 2 },
      }),
      ParagraphWithTitle,
      HeadingWithLabel,
      BulletListWithTitle,
      OrderedListWithTitle,
      BlockquoteWithUuid,
      CodeBlockWithUuid,
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Highlight.configure({
        multicolor: true,
      }),
      InlineMath,
      DisplayMath,
      Footnote,
      LatexComment,
      ArchiveMarker,
      Citation,
      LabelRef,
      ExampleBlock.configure({
        onTogglePopoutRef: onToggleExamplePopoutRef,
        isPoppedRef: exampleIsPoppedPredicateRef,
        refresherRegistryRef: examplePopoutRefreshersRef,
      }),
      ExampleItemList,
      ExampleItem,
      ExampleGloss,
      AlignedGlossRow,
      ProseGlossRow,
      GlossCell,
      ExpexNumbering,
      AiRequestMarker,
      LatexCommandMark,
      LinkedAnchor,
      LinkedAnchorGuard,
      TitleField,
      MaketitleMarker,
      LabelHandler,
      EmptyParagraphTitleCleaner,
      ...(anchoredUuidsRef
        ? [MarginaliaAnchorGuard.configure({ anchoredUuidsRef })]
        : []),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        // Asymmetric horizontal padding: left is pl-22 (88px) to leave
        // room for the 72px left marginalia gutter plus an 8px breathing
        // strip for the heading fold-chevron. Right is pr-18 (72px),
        // flush against the 72px-wide right gutter since its outer pad
        // is squeezed. Total (88+72=160) matches the previous px-20
        // so the text column width is unchanged.
        class:
          "prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] pl-[88px] pr-[72px] py-10",
      },
      handleDOMEvents: {
        // Only allow node drags that originate from an explicit drag handle.
        // ProseMirror's `draggable: true` on paragraph nodes otherwise lets
        // drags start from margin/padding areas of the wrapper, causing
        // inadvertent paragraph moves.
        dragstart(view, event) {
          // `event.target` may be a text node (e.g., Chrome often dispatches
          // the dragstart with the deepest node under the cursor, which is
          // a text node for selection drags). Normalize to an Element so
          // `.closest()` is always callable.
          const rawTarget = event.target as Node | null;
          const target =
            rawTarget instanceof Element
              ? rawTarget
              : (rawTarget?.parentElement ?? null);
          if (!target) return false;
          if (target.closest("[data-drag-handle]")) return false; // allow
          const sel = view.state.selection;
          // If a non-empty text selection exists, this is a text-selection
          // drag — even when Chrome dispatches dragstart with target =
          // `.par-title-wrapper` (because the wrapper has `draggable: true`,
          // Chrome uses it as the drag source element regardless of where
          // the cursor clicked). Stash the range and let the drag through;
          // the window-level dragstart listener will attach MIME_SELECTION_ANCHOR.
          if (!sel.empty) {
            const paragraphId = ensureAnchorUuid(view, sel.from);
            const selectedText = view.state.doc.textBetween(sel.from, sel.to, " ");
            pendingTextCaptureRef.current = { from: sel.from, to: sel.to, paragraphId, selectedText };
            // Clear any stale paragraph-capture stash so panels don't receive
            // both MIMEs (they check MIME_PAR_CAPTURE first and would take
            // the paragraph path instead of the selection path).
            pendingParCaptureUuidRef.current = null;
            return false;
          }
          // No text selection. If the drag started on the paragraph wrapper
          // but NOT inside the content <p> or a drag handle, it's an
          // inadvertent node drag from margins/padding — cancel it.
          const nodeView = target.closest(".par-title-wrapper");
          if (nodeView && !target.closest("p")) {
            event.preventDefault();
            return true; // handled — suppress
          }
          return false;
        },
      },
      handleDrop(view, event) {
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

        // --- Paragraph / section capture drop, MOVE semantics ---
        // Heading captures: ALWAYS handle these. Headings aren't
        // schema-draggable, but PM may still set up a node-drag for
        // them (selecting the heading node when the drag starts on the
        // contenteditable child). Letting PM run its default would
        // move only the heading; we want the whole section.
        //
        // Paragraph captures: only intercept when this isn't an
        // in-editor PM-tracked drag (view.dragging set), so PM keeps
        // ownership of paragraph reorders.
        const parCapData = event.dataTransfer?.getData(MIME_PAR_CAPTURE);
        if (parCapData) {
          try {
            const { uuid } = JSON.parse(parCapData) as { uuid: string };
            if (uuid) {
              const sectionRange = getSectionRangeByUuid(view.state.doc, uuid);
              let start: number | null = null;
              let end: number | null = null;
              let movedNodes: PMNode[] = [];
              let isSection = false;
              if (sectionRange) {
                start = sectionRange.start;
                end = sectionRange.end;
                movedNodes = sectionRange.nodes;
                isSection = true;
              } else if (!view.dragging) {
                // Paragraph fallback — only when PM isn't already handling.
                let parPos: number | null = null;
                let parNode: PMNode | null = null;
                view.state.doc.descendants((n, p) => {
                  if (n.type.name === "paragraph" && n.attrs?.uuid === uuid) {
                    parPos = p;
                    parNode = n;
                    return false;
                  }
                  return true;
                });
                if (parPos != null && parNode) {
                  start = parPos;
                  end = parPos + (parNode as PMNode).nodeSize;
                  movedNodes = [parNode as PMNode];
                }
              }
              if (start != null && end != null && movedNodes.length > 0) {
                event.preventDefault();
                if (isSection) {
                  // PM may have tagged the drag as a node move of the
                  // heading. Clear it so PM's default drop handler
                  // doesn't ALSO try to insert the heading after our
                  // section move runs.
                  view.dragging = null;
                }
                const coords = { left: event.clientX, top: event.clientY };
                const posResult = view.posAtCoords(coords);
                if (!posResult) return true;
                const $drop = view.state.doc.resolve(posResult.pos);
                const blockStart = $drop.before(1);
                const blockEnd = $drop.after(1);
                const targetPos =
                  posResult.pos - blockStart < blockEnd - posResult.pos
                    ? blockStart
                    : blockEnd;
                if (targetPos >= start && targetPos <= end) return true;
                const removedSize = end - start;
                let tr = view.state.tr.delete(start, end);
                const adjusted = targetPos > end ? targetPos - removedSize : targetPos;
                tr = tr.insert(adjusted, movedNodes);
                tr.scrollIntoView();
                view.dispatch(tr);
                return true;
              }
            }
          } catch { /* fall through */ }
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
      const wrappers = dom.querySelectorAll(".par-title-wrapper.has-text");
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

  // Window-level dragstart fires in the bubble phase AFTER ProseMirror's
  // editor-level dragstart (which rewrites DataTransfer for its own node
  // drag). Apply the stashed capture MIME here so it survives.
  useEffect(() => {
    const onWindowDragStart = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const parUuid = pendingParCaptureUuidRef.current;
      if (parUuid) {
        try { dt.setData(MIME_PAR_CAPTURE, JSON.stringify({ uuid: parUuid })); } catch {}
      }
      const textPayload = pendingTextCaptureRef.current;
      if (textPayload) {
        try { dt.setData(MIME_TEXT_CAPTURE, JSON.stringify(textPayload)); } catch {}
        try {
          dt.setData(
            MIME_SELECTION_ANCHOR,
            JSON.stringify({
              from: textPayload.from,
              to: textPayload.to,
              selectedText: textPayload.selectedText,
            }),
          );
        } catch {}
      }
    };
    const onWindowDragEnd = () => {
      pendingParCaptureUuidRef.current = null;
      pendingTextCaptureRef.current = null;
    };
    window.addEventListener("dragstart", onWindowDragStart);
    window.addEventListener("dragend", onWindowDragEnd);
    window.addEventListener("drop", onWindowDragEnd);
    return () => {
      window.removeEventListener("dragstart", onWindowDragStart);
      window.removeEventListener("dragend", onWindowDragEnd);
      window.removeEventListener("drop", onWindowDragEnd);
    };
  }, []);

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
      // For NodeSelection on atom nodes (e.g. latexComment), get text from attrs
      if (sel instanceof NodeSelection && sel.node.type.spec.atom) {
        const node = sel.node;
        if (node.type.name === "latexComment") {
          return `% ${node.attrs.text || ""}`;
        }
        // Other atom nodes: try textContent or return empty
        return node.textContent || "";
      }
      const { from, to } = sel;
      return editor.state.doc.textBetween(from, to, " ");
    },
    scrollToHeading(blockIndex: number): void {
      if (!editor) return;
      // Sentinel -1 means "scroll to the very top of the document"
      if (blockIndex === -1) {
        editor.commands.setTextSelection(1);
        const scrollEl = editor.view.dom.closest(".overflow-y-auto");
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
    archiveSelection(archiveId: string): { content: unknown; paragraphId: string | null } | null {
      if (!editor) return null;
      const sel = editor.state.selection;

      // Helper: resolve paragraphId from a document position
      const getParagraphId = (pos: number): string | null => {
        const $pos = editor.state.doc.resolve(pos);
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const node = $pos.node(depth);
          if (isAnchorableNode(node.type)) {
            return (node.attrs?.uuid as string | null) ?? null;
          }
        }
        return null;
      };

      // Handle NodeSelection on block atom nodes (e.g. latexComment)
      if (sel instanceof NodeSelection && sel.node.type.spec.atom && sel.node.type.isBlock) {
        const node = sel.node;
        const text = node.type.name === "latexComment"
          ? `% ${node.attrs.text || ""}`
          : node.textContent || "";
        if (!text.trim()) return null;
        const paragraphId = getParagraphId(sel.from);
        editor.chain().focus().deleteSelection().run();
        return {
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
          paragraphId,
        };
      }

      const { from, to } = sel;
      if (from === to) return null;
      const text = editor.state.doc.textBetween(from, to, " ");
      if (!text.trim()) return null;
      const paragraphId = getParagraphId(from);
      // Capture rich content before deleting
      const slice = editor.state.doc.slice(from, to);
      const richContent = { type: "doc", content: slice.content.toJSON() };
      editor.chain().focus().deleteSelection().run();
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
      const footnoteId = generateEntityId();
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
      const footnoteId = generateEntityId();
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
        const subs: string[] = [];
        node.descendants((child) => {
          if (child.type.name === "exampleItem") {
            const s = (child.attrs.subLabel as string) || "";
            if (s) subs.push(s);
            return false;
          }
          return true;
        });
        const subLabelRange =
          subs.length > 1 ? `${subs[0]}–${subs[subs.length - 1]}` : subs[0] || "";
        out.push({
          exampleId: id,
          pos,
          number: Number(node.attrs.number) || 0,
          kind: node.attrs.kind === "multi" ? "multi" : "single",
          tag: (node.attrs.tag as string) || "",
          label: (node.attrs.label as string) || "",
          preview: (preview.trim() || "(empty example)").slice(0, 120),
          subLabelRange,
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

    insertExample(kind: "single" | "multi"): { exampleId: string } | null {
      if (!editor) return null;
      const exampleId = generateEntityId();
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

    updateCitationDisplay(citationId: string, displayText: string): void {
      if (!editor) return;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "citation" && node.attrs.citationId === citationId) {
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            displayText,
          });
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
        return true;
      });
      return ids;
    },

    getCitationOrder(): string[] {
      if (!editor) return [];
      const ids: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "citation") ids.push(node.attrs.citationId);
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
      const scrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
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
        const scrollEl = editor.view.dom.closest(".overflow-y-auto");
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
        scrollEl = view.dom.closest(".overflow-y-auto") as HTMLElement | null;
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
        const scrollEl = editor.view.dom.closest(".overflow-y-auto");
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
          const newUuid = generateNodeUuid(existing);
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
    refreshParagraphPopouts(): void {
      paragraphPopoutRefreshersRef.current.forEach((fn) => fn());
    },
    refreshHeadingPopouts(): void {
      headingPopoutRefreshersRef.current.forEach((fn) => fn());
    },
    refreshExamplePopouts(): void {
      examplePopoutRefreshersRef.current.forEach((fn) => fn());
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

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-transparent min-h-0 hide-scrollbar">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default VirgilEditor;
