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
import { NodeSelection } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { InlineMath, DisplayMath, Footnote, LatexComment, ArchiveMarker, Citation, LatexCommandMark, LabelHandler, TitleField, EmptyParagraphTitleCleaner, AiRequestMarker, MarginaliaAnchorGuard } from "@/lib/tiptap-extensions";
import { ANCHORABLE_NODES, ANCHORABLE_ATOMS } from "@/lib/marginalia";
import { generateNodeUuid, generateEntityId } from "@/lib/uuid";
import { normalizeRichContent } from "@/lib/footnote-content";
import type { JSONContent as TipJSON } from "@tiptap/react";
import MenuBar from "./MenuBar";

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
  // Walk up ancestors (works for container nodes)
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (ANCHORABLE_NODES.has(node.type.name)) {
      const nodePos = depth === 0 ? 0 : $pos.before(depth);
      return { node, nodePos };
    }
  }
  // For atom blocks: posAtCoords lands before/after the atom
  if ($pos.nodeAfter && ANCHORABLE_ATOMS.has($pos.nodeAfter.type.name)) {
    return { node: $pos.nodeAfter, nodePos: pos };
  }
  if ($pos.nodeBefore && ANCHORABLE_ATOMS.has($pos.nodeBefore.type.name)) {
    return { node: $pos.nodeBefore, nodePos: pos - $pos.nodeBefore.nodeSize };
  }
  return null;
}

/**
 * Ensure the anchorable node at `pos` has a UUID. Assigns one if missing.
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
  const newUuid = generateNodeUuid();
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

/**
 * Auto-sizes an <input> to its content by measuring text in a hidden <span>.
 * Returns a cleanup function that removes the sizer and listener.
 */
function autoSizeInput(input: HTMLInputElement, minCh = 2): () => void {
  const sizer = document.createElement("span");
  sizer.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;pointer-events:none;";
  document.body.appendChild(sizer);

  function sync() {
    // Copy font from input so measurement matches
    const cs = getComputedStyle(input);
    sizer.style.font = cs.font;
    sizer.style.letterSpacing = cs.letterSpacing;
    sizer.textContent = input.value || input.placeholder || "";
    input.style.width = Math.max(sizer.offsetWidth + 2, minCh * 8) + "px";
  }

  input.addEventListener("input", sync);
  // Initial size — schedule after the input is rendered
  requestAnimationFrame(sync);

  return () => {
    input.removeEventListener("input", sync);
    if (document.body.contains(sizer)) sizer.remove();
  };
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
  /** Ref to a Set of paragraph UUIDs that have marginalia anchored to them */
  anchoredUuidsRef?: React.RefObject<Set<string>>;
}

export interface FootnoteInfo {
  footnoteId: string;
  content: TipJSON;
  number: number;
  pos: number;
}

export interface EditorHandle {
  replaceText: (oldText: string, newText: string) => boolean;
  getEditor: () => Editor | null;
  getSelectedText: () => string;
  scrollToHeading: (blockIndex: number) => void;
  archiveSelection: (archiveId: string) => unknown | null;
  restoreArchive: (archiveId: string, content: unknown) => void;
  removeArchiveMarker: (archiveId: string) => void;
  scrollToArchiveMarker: (archiveId: string) => void;
  getMarkerIds: () => Set<string>;
  getMarkerOrder: () => string[];
  getFootnotes: () => FootnoteInfo[];
  scrollToFootnote: (footnoteId: string) => void;
  updateFootnoteContent: (footnoteId: string, newContent: TipJSON) => void;
  deleteFootnote: (footnoteId: string) => void;
  createFootnoteFromSelection: () => { footnoteId: string } | null;
  renumberFootnotes: () => void;
  getCitations: () => { citationId: string; command: string; displayText: string; pos: number }[];
  scrollToCitation: (citationId: string) => void;
  updateCitationDisplay: (citationId: string, displayText: string) => void;
  getCitationIds: () => Set<string>;
  getCitationOrder: () => string[];
  insertCitation: (command: string, citationId: string, displayText: string) => void;
  getActiveParagraphId: () => string | null;
  scrollToParagraphId: (uuid: string) => void;
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
  { initialContent, onUpdate, highlightText, highlightRange, onAddComment, onArchive, onEditorReady, onCitationDrop, onConfirmFootnoteMove, anchoredUuidsRef },
  ref
) {
  const highlightTextRef = useRef(highlightText);
  highlightTextRef.current = highlightText;
  const highlightRangeRef = useRef(highlightRange);
  highlightRangeRef.current = highlightRange;

  const onCitationDropRef = useRef(onCitationDrop);
  onCitationDropRef.current = onCitationDrop;
  // Mirror onConfirmFootnoteMove into a ref so the ProseMirror handleDrop
  // closure always sees the current value without needing to reattach.
  const onConfirmFootnoteMoveRef = useRef(onConfirmFootnoteMove);
  onConfirmFootnoteMoveRef.current = onConfirmFootnoteMove;

  const ParagraphWithTitle = Paragraph.extend({
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

        // Detect if this paragraph is inside a list item — skip title controls
        const pos = typeof getPos === "function" ? getPos() : null;
        let insideList = false;
        if (pos != null) {
          const resolved = nodeEditor.state.doc.resolve(pos);
          for (let d = resolved.depth; d >= 0; d--) {
            if (resolved.node(d).type.name === "listItem") { insideList = true; break; }
          }
        }

        if (insideList) {
          const p = document.createElement("p");
          return { dom: p, contentDOM: p };
        }

        const wrapper = document.createElement("div");
        wrapper.className = "par-title-wrapper";

        // Title annotation area (above paragraph — holds +T or title)
        const titleAnnot = document.createElement("div");
        titleAnnot.className = "par-title-annotation";
        titleAnnot.contentEditable = "false";
        wrapper.appendChild(titleAnnot);

        // Paragraph content
        const p = document.createElement("p");
        wrapper.appendChild(p);

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
            cleanup();
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

          if (title) {
            wrapper.classList.add("has-title");
            wrapper.classList.remove("has-add-btn");
            titleAnnot.style.display = "block";

            // Title text first, then × delete button to its right
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

            // Only show +T if paragraph has real text content
            const hasText = currentNode.textContent.trim().length > 0;
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
    addAttributes() {
      return {
        ...this.parent?.(),
        label: { default: null },
        uuid: { default: null, rendered: false },
      };
    },
    renderHTML({ HTMLAttributes, node }) {
      const level = node.attrs.level as number;
      return [`h${level}`, mergeAttributes(HTMLAttributes), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        const TYPE_NAMES = ["Section", "Subsection", "Subsubsection"];
        let currentNode = node;

        const wrapper = document.createElement("div");
        wrapper.className = "heading-wrapper";

        const h = document.createElement(`h${node.attrs.level}`) as HTMLHeadingElement;
        wrapper.appendChild(h);

        const annot = document.createElement("div");
        annot.className = "heading-annotation";
        annot.contentEditable = "false";
        wrapper.appendChild(annot);

        function getTypeName(n: typeof node) {
          return TYPE_NAMES[Math.min((n.attrs.level as number) - 1, 2)];
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

          let committed = false;
          const commit = () => {
            if (committed) return;
            committed = true;
            cleanupSizer();
            const newLabel = input.value.trim() || null;
            const p = typeof getPos === "function" ? getPos() : null;
            if (p != null) {
              nodeEditor.chain().setNodeSelection(p).updateAttributes("heading", { label: newLabel }).run();
              nodeEditor.commands.focus();
            }
            renderAnnot();
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
          const label = currentNode.attrs.label as string | null;
          annot.innerHTML = "";

          const typeSpan = document.createElement("span");
          typeSpan.textContent = typeName;
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
            return annot === event.target || annot.contains(event.target as Node);
          },
          ignoreMutation(mutation) {
            // Ignore all mutations in the annotation area (label editing, etc.)
            if (annot.contains(mutation.target)) return true;
            return false;
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "heading") return false;
            if (updatedNode.attrs.level !== currentNode.attrs.level) return false;
            currentNode = updatedNode;
            // Don't overwrite annot if an input is active
            if (!annot.querySelector("input")) renderAnnot();
            return true;
          },
        };
      };
    },
  }).configure({ levels: [1, 2, 3] });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
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
      AiRequestMarker,
      LatexCommandMark,
      TitleField,
      LabelHandler,
      EmptyParagraphTitleCleaner,
      ...(anchoredUuidsRef
        ? [MarginaliaAnchorGuard.configure({ anchoredUuidsRef })]
        : []),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        // px-20 (80px) leaves room for the 72px marginalia gutter plus a
        // small breathing gap. Must stay >= MARGINALIA_GUTTER_WIDTH so
        // gutter icons don't overlap the text column.
        class:
          "prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] px-20 py-10",
      },
      handleDrop(view, event) {
        // --- AI request marker drop (from any panel's AiRequestCard) ---
        const aiReqData = event.dataTransfer?.getData("application/x-virgil-ai-request");
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

        // --- Marginalia move (drag a gutter icon to a new paragraph) ---
        const margData = event.dataTransfer?.getData("application/x-virgil-marginalia-move");
        if (margData) {
          event.preventDefault();
          try {
            const { type, entityId, currentParagraphId } = JSON.parse(margData);
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true;
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
        const quotData = event.dataTransfer?.getData("application/x-virgil-quotation");
        if (quotData) {
          event.preventDefault();
          try {
            const { groupId } = JSON.parse(quotData);
            if (!groupId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true;
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
        const citData = event.dataTransfer?.getData("application/x-virgil-citation");
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
        const quoteData = event.dataTransfer?.getData("application/x-virgil-quote");
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

        // --- Note drop (from NotesPanel) ---
        // Inserts the note's body inline at the drop point. The note still
        // exists in the side panel — this is a "stamp it into the text" copy.
        // Holding Shift while dropping preserves the legacy "re-anchor only"
        // behavior for users who relied on it.
        const noteData = event.dataTransfer?.getData("application/x-virgil-note");
        if (noteData) {
          event.preventDefault();
          try {
            const parsed = JSON.parse(noteData);
            const { noteId, content } = parsed;
            if (!noteId) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true;

            // Ensure the drop target has a UUID for marginalia anchoring
            ensureAnchorUuid(view, posResult.pos);

            const reanchorOnly = event.shiftKey;
            if (!reanchorOnly && content) {
              // Insert the note body inline. The content is a JSONContent doc;
              // pull out its inline children so we don't drop a fresh paragraph
              // boundary in the middle of the target paragraph. Paragraphs in
              // the source become space-separated runs.
              try {
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
                    const tr = view.state.tr.insert(posResult.pos, pmNodes);
                    view.dispatch(tr);
                  }
                }
              } catch { /* fall through to anchor-only */ }
            }

            window.dispatchEvent(
              new CustomEvent("virgil-note-drop", {
                detail: { noteId, anchorPos: posResult.pos, inserted: !reanchorOnly && !!content },
              })
            );
          } catch { /* ignore bad data */ }
          return true;
        }

        // --- Footnote drop (from panel) ---
        const fnData = event.dataTransfer?.getData("application/x-virgil-footnote");
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
              if (requestConfirm) {
                // Fire-and-forget: the drop event is already prevented,
                // so we can safely do async work and dispatch the move
                // when the user resolves the dialog.
                requestConfirm().then((ok) => {
                  if (ok) performMove();
                }).catch(() => { /* swallow: user cancelled */ });
              } else if (
                window.confirm(
                  "This will move the footnote from its current position in the document. Continue?",
                )
              ) {
                performMove();
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
    archiveSelection(archiveId: string): unknown | null {
      if (!editor) return null;
      const sel = editor.state.selection;

      // Handle NodeSelection on block atom nodes (e.g. latexComment)
      if (sel instanceof NodeSelection && sel.node.type.spec.atom && sel.node.type.isBlock) {
        const node = sel.node;
        const text = node.type.name === "latexComment"
          ? `% ${node.attrs.text || ""}`
          : node.textContent || "";
        if (!text.trim()) return null;
        const preview = text.slice(0, 30);
        // Replace the block node with a paragraph containing the archive marker
        editor
          .chain()
          .focus()
          .deleteSelection()
          .insertContent({
            type: "paragraph",
            content: [{
              type: "archiveMarker",
              attrs: { archiveId, preview },
            }],
          })
          .run();
        // Return as JSONContent doc wrapping the plain text
        return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
      }

      const { from, to } = sel;
      if (from === to) return null;
      const text = editor.state.doc.textBetween(from, to, " ");
      if (!text.trim()) return null;
      const preview = text.slice(0, 30);
      // Capture rich content before deleting
      const slice = editor.state.doc.slice(from, to);
      const richContent = { type: "doc", content: slice.content.toJSON() };
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: "archiveMarker",
          attrs: { archiveId, preview },
        })
        .run();
      return richContent;
    },
    restoreArchive(archiveId: string, content: unknown): void {
      if (!editor) return;
      // Find the archive marker node
      let markerPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "archiveMarker" && node.attrs.archiveId === archiveId) {
          markerPos = pos;
          return false;
        }
        return true;
      });
      if (markerPos === null) return;

      // Select the marker (it's an inline atom, size 1)
      editor.chain().focus().setTextSelection({ from: markerPos, to: markerPos + 1 }).run();

      // Handle legacy plain-text content or rich JSONContent
      if (typeof content === "string") {
        if (content.startsWith("% ")) {
          editor.chain().focus().deleteSelection().insertContent({
            type: "latexComment",
            attrs: { text: content.slice(2) },
          }).run();
        } else {
          editor.chain().focus().insertContent(content).run();
        }
      } else {
        // Rich content — insert the doc's children
        const doc = content as { type?: string; content?: unknown[] };
        const nodes = doc?.content ?? [];
        editor.chain().focus().deleteSelection().insertContent(nodes).run();
      }
    },
    removeArchiveMarker(archiveId: string): void {
      if (!editor) return;
      let markerPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "archiveMarker" && node.attrs.archiveId === archiveId) {
          markerPos = pos;
          return false;
        }
        return true;
      });
      if (markerPos === null) return;
      const tr = editor.state.tr.delete(markerPos, markerPos + 1);
      editor.view.dispatch(tr);
    },
    scrollToArchiveMarker(archiveId: string): void {
      if (!editor) return;
      // Query the DOM directly for the marker element
      const el = editor.view.dom.querySelector(
        `[data-archive-id="${archiveId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
    },
    getMarkerIds(): Set<string> {
      const ids = new Set<string>();
      if (!editor) return ids;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "archiveMarker" && node.attrs.archiveId) {
          ids.add(node.attrs.archiveId);
        }
        return true;
      });
      return ids;
    },
    getMarkerOrder(): string[] {
      const order: string[] = [];
      if (!editor) return order;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "archiveMarker" && node.attrs.archiveId) {
          order.push(node.attrs.archiveId);
        }
        return true;
      });
      return order;
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
          });
        }
        return true;
      });
      return footnotes;
    },
    scrollToFootnote(footnoteId: string): void {
      if (!editor) return;
      const el = editor.view.dom.querySelector(
        `[data-footnote-id="${footnoteId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
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
    deleteFootnote(footnoteId: string): void {
      if (!editor) return;
      let fnPos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote" && node.attrs.footnoteId === footnoteId) {
          fnPos = pos;
          return false;
        }
        return true;
      });
      if (fnPos != null) {
        const tr = editor.state.tr.delete(fnPos, fnPos + 1);
        editor.view.dispatch(tr);
      }
    },
    createFootnoteFromSelection(): { footnoteId: string } | null {
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
          attrs: { footnoteId, content, number: 0 },
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

    scrollToCitation(citationId: string): void {
      if (!editor) return;
      const el = editor.view.dom.querySelector(`[data-citation-id="${citationId}"]`);
      if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
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
        return ANCHORABLE_NODES.has(node.type.name) && !!node.attrs?.uuid;
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
        if (id && ANCHORABLE_NODES.has(name)) {
          try {
            let top: number;
            if (ANCHORABLE_ATOMS.has(name)) {
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
  }), [editor]);

  const applyHighlight = useCallback(() => {
    if (!editor) return;

    editor.chain().selectAll().unsetHighlight().run();

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
    applyHighlight();
  }, [highlightText, highlightRange, applyHighlight]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-transparent min-h-0">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default VirgilEditor;
