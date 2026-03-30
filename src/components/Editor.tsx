"use client";

import { useEditor, EditorContent, JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { InlineMath, DisplayMath, Footnote, LatexComment, ArchiveMarker, Citation } from "@/lib/tiptap-extensions";
import MenuBar from "./MenuBar";

interface EditorProps {
  initialContent: JSONContent;
  onUpdate: (doc: JSONContent) => void;
  highlightText: string | null;
  onAddComment?: () => void;
  onArchive?: () => void;
  onEditorReady?: (editor: Editor) => void;
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
  { initialContent, onUpdate, highlightText, onAddComment, onArchive, onEditorReady },
  ref
) {
  const highlightTextRef = useRef(highlightText);
  highlightTextRef.current = highlightText;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
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
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-stone max-w-none focus:outline-none min-h-[calc(100vh-8rem)] px-16 py-10",
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
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
        el.scrollIntoView({ behavior: "smooth", block: "center" });
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
        el.scrollIntoView({ behavior: "smooth", block: "center" });
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
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
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
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [editor]);

  useEffect(() => {
    highlightTextRef.current = highlightText;
    applyHighlight();
  }, [highlightText, applyHighlight]);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex-1 overflow-y-auto bg-white">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default VirgilEditor;
