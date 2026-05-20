"use client";

/**
 * Floating list editor.
 *
 * Counterpart of ParagraphFloat / HeadingFloat for bullet and ordered
 * lists. Opens when the user lifts a list's gutter drag handle in the
 * main editor. Renders the WHOLE list — every `<li>` and any nested
 * sub-lists — in a dedicated Tiptap editor. Edits round-trip back to
 * the main editor's list, keyed by the list's uuid.
 *
 * Schema mirrors the main editor closely enough for list content to
 * round-trip losslessly: lists, list items, nested paragraphs, plus
 * the inline atoms (citation, footnote, inline math, etc.) and the
 * marks (linkedAnchor, latexCommandMark, etc.). The list node attrs
 * the float's schema doesn't reproduce (parTitle, uuid, listPreamble)
 * are preserved on the source's first node during write-back.
 */

import { type RefObject, useCallback, useMemo } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import {
  InlineMath,
  DisplayMath,
  Footnote,
  LatexComment,
  Citation,
  LabelRef,
  LatexCommandMark,
  AiRequestMarker,
  LinkedAnchor,
  LinkedAnchorGuard,
  ExampleBlock,
  ExampleItem,
  ExampleItemList,
  ExampleGloss,
  AlignedGlossRow,
  ProseGlossRow,
  GlossCell,
  TabIndent,
} from "@/lib/tiptap-extensions";

import { FloatCard } from "./FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "./panel-primitives";
import type { EditorHandle } from "./Editor";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FLOAT_WRITE_META, SourceMissingBanner, useFloatMainSync } from "@/lib/float-sync";

interface ListSource {
  /** Position of the list node's start in the main doc. */
  start: number;
  /** Position of the list node's end (exclusive). */
  end: number;
  /** The list node itself. */
  node: PMNode;
  /** "bulletList" or "orderedList". */
  typeName: string;
}

function findListByUuid(doc: PMNode, uuid: string): ListSource | null {
  let result: ListSource | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (
      (node.type.name === "bulletList" || node.type.name === "orderedList") &&
      node.attrs?.uuid === uuid
    ) {
      result = {
        start: pos,
        end: pos + node.nodeSize,
        node,
        typeName: node.type.name,
      };
      return false;
    }
    return true;
  });
  return result;
}

export function ListFloat({
  cardKey,
  uuid,
  editorRef,
}: {
  cardKey: string;
  uuid: string;
  editorRef: RefObject<EditorHandle | null>;
}) {
  const popped = usePoppedCards();
  const mainEditor = editorRef.current?.getEditor() ?? null;

  // Read the list once to seed the float editor. After mount, the float
  // is the source of truth; edits write back to the main doc's list
  // node identified by uuid.
  const initial = useMemo(() => {
    let typeName: "bulletList" | "orderedList" = "bulletList";
    let listJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findListByUuid(mainEditor.state.doc, uuid);
      if (src) {
        typeName = src.typeName as "bulletList" | "orderedList";
        listJson = src.node.toJSON() as JSONContent;
      }
    }
    const fallback: JSONContent = {
      type: typeName,
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [] }],
        },
      ],
    };
    return {
      doc: {
        type: "doc",
        content: [listJson ?? fallback],
      } as JSONContent,
      typeName,
    };
    // mainEditor is a ref-derived value (`editorRef.current?.getEditor()`),
    // not React state — but it can flip null → editor between the first
    // render (popout opens before EditorPane has populated the handle)
    // and the second. Without `mainEditor` in deps, `initial` stays on
    // the empty fallback even after the real editor is available, and
    // the float's label + initial content lock to the wrong values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, mainEditor]);

  const floatEditor = useEditor({
    extensions: [
      // Lists + their children come from StarterKit. The float schema
      // doesn't carry the main editor's custom attrs on bulletList/
      // orderedList (uuid, parTitle, listPreamble) — those are re-
      // attached from the original source node during writeBackToMain.
      StarterKit.configure({ dropcursor: false }),
      Highlight.configure({ multicolor: true }),
      InlineMath,
      DisplayMath,
      Footnote,
      LatexComment,
          Citation,
      LabelRef,
      LatexCommandMark,
      AiRequestMarker,
      LinkedAnchor,
      LinkedAnchorGuard,
      ExampleBlock,
      ExampleItem,
      ExampleItemList,
      ExampleGloss,
      AlignedGlossRow,
      ProseGlossRow,
      GlossCell,
      TabIndent,
    ],
    content: initial.doc,
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap ProseMirror prose prose-stone max-w-none focus:outline-none",
      },
    },
    onUpdate({ editor }) {
      writeBackToMain(editor.getJSON());
    },
  });

  const floatId = `list:${uuid}`;

  function writeBackToMain(doc: JSONContent) {
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    const src = findListByUuid(ed.state.doc, uuid);
    if (!src) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    const first = incoming[0];
    if (
      !first ||
      (first.type !== "bulletList" && first.type !== "orderedList")
    ) {
      // Float's top-level no longer a list — refuse to write back rather
      // than corrupting the doc.
      return;
    }
    try {
      const newNode = ed.state.schema.nodeFromJSON({
        ...first,
        attrs: {
          // Preserve the source list's attrs (uuid, parTitle, listPreamble).
          // Float schema's lists don't carry these, so merging from source
          // keeps them intact across edits.
          ...src.node.attrs,
          ...(first.attrs ?? {}),
          uuid: src.node.attrs.uuid,
        },
      });
      const tr = ed.state.tr.replaceWith(src.start, src.end, newNode);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      const src = findListByUuid(doc, uuid);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [{ type: "paragraph", content: [] }],
                  },
                ],
              },
            ],
          } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: {
          type: "doc",
          content: [src.node.toJSON() as JSONContent],
        } as JSONContent,
        missing: false,
      };
    },
    [uuid],
  );

  const { sourceMissing } = useFloatMainSync({
    mainEditor,
    floatEditor,
    floatId,
    readSource,
  });

  const label = initial.typeName === "orderedList" ? "ORDERED LIST" : "BULLET LIST";

  return (
    <FloatCard cardKey={cardKey} surface="card">
      <div className="flex-1 min-h-0 flex flex-col bg-surface overflow-hidden">
        <div className="flex items-center gap-1 px-2 h-6 border-b border-edge-subtle bg-[var(--surface-muted-strong)]">
          <span className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate">
            {label}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.scrollToParagraphId(uuid)}
            className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
            title="Jump to list"
            aria-label="Jump to list"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun="list"
            className="iconbtn-xs"
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        {sourceMissing ? (
          <SourceMissingBanner kind="list" onClose={() => popped?.close(cardKey)} />
        ) : null}
        <div className="par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative">
          <EditorContent editor={floatEditor} />
        </div>
      </div>
    </FloatCard>
  );
}
