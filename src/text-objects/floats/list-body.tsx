"use client";

/**
 * List float body — TipTap embed rendering a whole bullet or ordered
 * list (every `<li>`, including nested sub-lists). Edits round-trip back
 * to the main editor's list node, keyed by the list's `uuid`.
 *
 * Migrated from the deleted `src/components/ListFloat.tsx`. The outer
 * FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Two TextObject kinds — `bulletList` and `orderedList` — share this
 * body. The dynamic header label ("BULLET LIST" / "ORDERED LIST") comes
 * from inspecting the live node and is pushed up via `setHeaderLabel`.
 */

import { type RefObject, useCallback, useEffect, useMemo } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import type { Node as PMNode } from "@tiptap/pm/model";
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
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";

interface ListSource {
  start: number;
  end: number;
  node: PMNode;
  typeName: "bulletList" | "orderedList";
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
        typeName: node.type.name as "bulletList" | "orderedList",
      };
      return false;
    }
    return true;
  });
  return result;
}

export function ListBody({
  cardKey,
  id: uuid,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let typeName: "bulletList" | "orderedList" = "bulletList";
    let listJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findListByUuid(mainEditor.state.doc, uuid);
      if (src) {
        typeName = src.typeName;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, mainEditor]);

  // Push the bullet-vs-ordered label up to the chrome.
  useEffect(() => {
    setHeaderLabel(
      initial.typeName === "orderedList" ? "Ordered list" : "Bullet list",
    );
    return () => setHeaderLabel(null);
  }, [initial.typeName, setHeaderLabel]);

  const floatId = `list:${uuid}`;

  const floatEditor = useEditor({
    extensions: [
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

  function writeBackToMain(doc: JSONContent) {
    const ed = ref.current?.getEditor();
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
      return;
    }
    try {
      const newNode = ed.state.schema.nodeFromJSON({
        ...first,
        attrs: {
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

  return (
    <>
      {sourceMissing ? (
        <SourceMissingBanner
          kind="list"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div className="par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative">
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
