"use client";

import { useEditor, EditorContent, JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import { mergeAttributes } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { InlineMath, DisplayMath, Footnote, LatexComment, ArchiveMarker, Citation, LatexCommandMark, LabelHandler, TitleField, EmptyParagraphTitleCleaner } from "@/lib/tiptap-extensions";
import MenuBar from "./MenuBar";

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
  onAddComment?: () => void;
  onArchive?: () => void;
  onEditorReady?: (editor: Editor) => void;
  onCitationDrop?: (command: string, citationId?: string) => { id: string; displayText: string } | null;
}

export interface FootnoteInfo {
  footnoteId: string;
  content: string;
  number: number;
  pos: number;
}

export interface EditorHandle {
  replaceText: (oldText: string, newText: string) => boolean;
  getEditor: () => Editor | null;
  getSelectedText: () => string;
  scrollToHeading: (blockIndex: number) => void;
  archiveSelection: (archiveId: string) => string | null;
  restoreArchive: (archiveId: string, text: string) => void;
  removeArchiveMarker: (archiveId: string) => void;
  scrollToArchiveMarker: (archiveId: string) => void;
  getMarkerIds: () => Set<string>;
  getMarkerOrder: () => string[];
  getFootnotes: () => FootnoteInfo[];
  scrollToFootnote: (footnoteId: string) => void;
  updateFootnoteContent: (footnoteId: string, newContent: string) => void;
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
  { initialContent, onUpdate, highlightText, onAddComment, onArchive, onEditorReady, onCitationDrop },
  ref
) {
  const highlightTextRef = useRef(highlightText);
  highlightTextRef.current = highlightText;

  const onCitationDropRef = useRef(onCitationDrop);
  onCitationDropRef.current = onCitationDrop;

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

        // Controls in left margin (inline styles — CSS classes purged by Tailwind v4)
        const controls = document.createElement("div");
        controls.className = "par-title-controls";
        controls.contentEditable = "false";
        Object.assign(controls.style, {
          position: "absolute", left: "-42px", display: "flex",
          alignItems: "center", gap: "2px", opacity: "0", transition: "opacity 0.15s",
        });
        wrapper.appendChild(controls);

        // Hover show/hide for controls
        wrapper.addEventListener("mouseenter", () => { if (!wrapper.classList.contains("has-title")) controls.style.opacity = "1"; });
        wrapper.addEventListener("mouseleave", () => { controls.style.opacity = "0"; });

        // Title annotation (above paragraph)
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
                attrs.uuid = Math.random().toString(16).slice(2, 6);
              }
              const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
              nodeEditor.view.dispatch(tr);
            }
          }
        }

        function enterEditMode() {
          // Create overlay input outside ProseMirror's DOM tree
          const rect = titleAnnot.getBoundingClientRect();
          const wrapperRect = wrapper.getBoundingClientRect();

          titleAnnot.style.display = "block";
          titleAnnot.textContent = "\u00A0"; // nbsp placeholder for height

          const input = document.createElement("input");
          input.type = "text";
          input.className = "par-title-input";
          input.value = (currentNode.attrs.parTitle as string) || "";
          input.placeholder = "Paragraph title…";
          input.style.position = "fixed";
          input.style.left = `${wrapperRect.left}px`;
          input.style.top = `${titleAnnot.getBoundingClientRect().top}px`;
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
          controls.innerHTML = "";
          titleAnnot.innerHTML = "";

          if (title) {
            wrapper.classList.add("has-title");
            controls.style.display = "none";

            // Show title text with × delete button inside annotation
            titleAnnot.style.display = "block";
            const xBtn = document.createElement("button");
            xBtn.className = "par-title-delete";
            xBtn.textContent = "×";
            xBtn.title = "Remove title";
            xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
            xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
            titleAnnot.appendChild(xBtn);
            const span = document.createElement("span");
            span.className = "par-title-text";
            span.textContent = title;
            titleAnnot.appendChild(span);
          } else {
            wrapper.classList.remove("has-title");

            // Only show controls if paragraph has real text content
            const hasText = currentNode.textContent.trim().length > 0;
            if (hasText) {
              controls.style.display = "flex";

              // + button (add) — inline styles since CSS purged by Tailwind v4
              const plusBtn = document.createElement("button");
              plusBtn.textContent = "+";
              plusBtn.title = "Add title";
              Object.assign(plusBtn.style, {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "16px", height: "16px", fontSize: "9px", fontWeight: "700",
                fontFamily: "var(--font-sans), system-ui, sans-serif",
                color: "#c45a5a", background: "#fef5f5",
                border: "1px solid #e8b4b4", borderRadius: "3px",
                cursor: "pointer", lineHeight: "1", userSelect: "none", padding: "0",
              });
              plusBtn.addEventListener("mouseenter", () => { plusBtn.style.background = "#fde8e8"; plusBtn.style.borderColor = "#c45a5a"; });
              plusBtn.addEventListener("mouseleave", () => { plusBtn.style.background = "#fef5f5"; plusBtn.style.borderColor = "#e8b4b4"; });
              plusBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
              plusBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
              controls.appendChild(plusBtn);

              // T label
              const tLabel = document.createElement("span");
              tLabel.textContent = "T";
              Object.assign(tLabel.style, {
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "16px", height: "16px", fontSize: "9px", fontWeight: "700",
                fontFamily: "var(--font-sans), system-ui, sans-serif",
                color: "#c45a5a", userSelect: "none", lineHeight: "1",
              });
              controls.appendChild(tLabel);
            } else {
              controls.style.display = "none";
            }

            // Hide annotation area
            titleAnnot.style.display = "none";
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
              controls === event.target || controls.contains(event.target as Node) ||
              titleAnnot === event.target || titleAnnot.contains(event.target as Node)
            );
          },
          ignoreMutation(mutation) {
            // Prevent ProseMirror from reacting to DOM changes in controls/annotation
            if (controls.contains(mutation.target) || titleAnnot.contains(mutation.target)) return true;
            if (mutation.target === wrapper && mutation.type === "childList") return true;
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

      const controls = document.createElement("div");
      controls.className = "par-title-controls";
      controls.contentEditable = "false";
      Object.assign(controls.style, {
        position: "absolute", left: "-42px", display: "flex",
        alignItems: "center", gap: "2px", opacity: "0", transition: "opacity 0.15s",
      });
      wrapper.appendChild(controls);

      wrapper.addEventListener("mouseenter", () => { if (!wrapper.classList.contains("has-title")) controls.style.opacity = "1"; });
      wrapper.addEventListener("mouseleave", () => { controls.style.opacity = "0"; });

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
              attrs.uuid = Math.random().toString(16).slice(2, 6);
            }
            const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
            nodeEditor.view.dispatch(tr);
          }
        }
      }

      function enterEditMode() {
        const wrapperRect = wrapper.getBoundingClientRect();
        // Position input just above the list element
        const listRect = listEl.getBoundingClientRect();
        const topPos = listRect.top - 20;

        const overlay = document.createElement("div");
        overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;`;
        document.body.appendChild(overlay);

        const input = document.createElement("input");
        input.type = "text";
        input.className = "par-title-input";
        input.value = currentNode.attrs.parTitle || "";
        input.placeholder = "Title…";
        input.style.cssText = `position:fixed;z-index:9999;left:${wrapperRect.left}px;top:${topPos}px;`;
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
        controls.innerHTML = "";
        titleAnnot.innerHTML = "";

        if (title) {
          wrapper.classList.add("has-title");
          controls.style.display = "none";
          titleAnnot.style.display = "block";
          const xBtn = document.createElement("button");
          xBtn.className = "par-title-delete";
          xBtn.textContent = "×";
          xBtn.title = "Remove title";
          xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
          xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
          titleAnnot.appendChild(xBtn);
          const span = document.createElement("span");
          span.className = "par-title-text";
          span.textContent = title;
          titleAnnot.appendChild(span);
        } else {
          wrapper.classList.remove("has-title");
          controls.style.display = "flex";
          titleAnnot.style.display = "none";
          // Show + button to add title (inline styles — CSS purged by Tailwind v4)
          const plusBtn = document.createElement("button");
          plusBtn.textContent = "+";
          plusBtn.title = "Add title";
          Object.assign(plusBtn.style, {
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "16px", height: "16px", fontSize: "9px", fontWeight: "700",
            fontFamily: "var(--font-sans), system-ui, sans-serif",
            color: "#c45a5a", background: "#fef5f5",
            border: "1px solid #e8b4b4", borderRadius: "3px",
            cursor: "pointer", lineHeight: "1", userSelect: "none", padding: "0",
          });
          plusBtn.addEventListener("mouseenter", () => { plusBtn.style.background = "#fde8e8"; plusBtn.style.borderColor = "#c45a5a"; });
          plusBtn.addEventListener("mouseleave", () => { plusBtn.style.background = "#fef5f5"; plusBtn.style.borderColor = "#e8b4b4"; });
          plusBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
          plusBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
          controls.appendChild(plusBtn);
          const tLabel = document.createElement("span");
          tLabel.textContent = "T";
          Object.assign(tLabel.style, {
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "16px", height: "16px", fontSize: "9px", fontWeight: "700",
            fontFamily: "var(--font-sans), system-ui, sans-serif",
            color: "#c45a5a", userSelect: "none", lineHeight: "1",
          });
          controls.appendChild(tLabel);
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
            controls === event.target || controls.contains(event.target as Node) ||
            titleAnnot === event.target || titleAnnot.contains(event.target as Node)
          );
        },
        ignoreMutation(mutation: any) {
          if (mutation.target && (controls.contains(mutation.target) || titleAnnot.contains(mutation.target))) return true;
          if (mutation.target === wrapper && mutation.type === "childList") return true;
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
      };
    },
    addNodeView() {
      return createListTitleNodeView("ol", "orderedList");
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
      }),
      ParagraphWithTitle,
      HeadingWithLabel,
      BulletListWithTitle,
      OrderedListWithTitle,
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      InlineMath,
      DisplayMath,
      Footnote,
      LatexComment,
      ArchiveMarker,
      Citation,
      LatexCommandMark,
      TitleField,
      LabelHandler,
      EmptyParagraphTitleCleaner,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] px-16 py-10",
      },
      handleDrop(view, event) {
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

        // --- Footnote drop (from panel) ---
        const fnData = event.dataTransfer?.getData("application/x-virgil-footnote");
        if (fnData) {
          event.preventDefault();
          try {
            const { footnoteId, content, isOrphan } = JSON.parse(fnData);
            if (!isOrphan) {
              const confirmed = window.confirm(
                "This will move the footnote from its current position in the document. Continue?"
              );
              if (!confirmed) return true;
            }

            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;

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

            const mappedPos = tr.mapping.map(pos.pos);
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
    archiveSelection(archiveId: string): string | null {
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
        return text;
      }

      const { from, to } = sel;
      if (from === to) return null;
      const text = editor.state.doc.textBetween(from, to, " ");
      if (!text.trim()) return null;
      const preview = text.slice(0, 30);
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: "archiveMarker",
          attrs: { archiveId, preview },
        })
        .run();
      return text;
    },
    restoreArchive(archiveId: string, text: string): void {
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

      if (text.startsWith("% ")) {
        // Restore as a latexComment block node
        editor.chain().focus().deleteSelection().insertContent({
          type: "latexComment",
          attrs: { text: text.slice(2) },
        }).run();
      } else {
        // Regular text
        editor.chain().focus().insertContent(text).run();
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
            content: node.attrs.content || "",
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
    updateFootnoteContent(footnoteId: string, newContent: string): void {
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
      const footnoteId = crypto.randomUUID();
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: "footnote",
          attrs: { footnoteId, content: text, number: 0 },
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

      // Helper: get the UUID of a node (paragraph, bulletList, orderedList)
      const getUuid = (node: any): string | null => node.attrs?.uuid || null;
      const hasParagraphUuid = (node: any): boolean => {
        const name = node.type.name;
        return (name === "paragraph" || name === "heading" || name === "bulletList" || name === "orderedList") && !!node.attrs?.uuid;
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
  }), [editor]);

  const applyHighlight = useCallback(() => {
    if (!editor) return;

    editor.chain().selectAll().unsetHighlight().run();

    if (!highlightTextRef.current) return;

    const range = findTextRange(editor, highlightTextRef.current);
    if (!range) return;

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
  }, [editor]);

  useEffect(() => {
    highlightTextRef.current = highlightText;
    applyHighlight();
  }, [highlightText, applyHighlight]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex-1 overflow-y-auto bg-white min-h-0">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default VirgilEditor;
