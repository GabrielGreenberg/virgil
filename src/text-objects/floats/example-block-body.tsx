"use client";

/**
 * Example-block float body — TipTap embed rendering the entire
 * `exampleBlock` node (with its example items and any glosses). Edits
 * round-trip back to the main doc's exampleBlock, keyed by `uuid`.
 *
 * This is NEW in Phase D5 — pre-D5, the in-editor exampleBlock popout
 * dispatched to the Examples panel-card preview (`ExampleCard`), which
 * is a compact one-line summary, NOT a true block editor. The new body
 * here is the proper full-block float, modeled after `heading-body.tsx`.
 *
 * The Examples *panel* popout (`example:<id>` key, an entry in the same
 * family as `note:`, `todo:`, `bib:`) remains a separate card and is
 * unchanged — see the `case "example"` branch in `floating-cards.tsx`.
 */

import { type RefObject, useCallback, useMemo } from "react";
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
  TexBlock,
  FigureBlock,
  FigureCaption,
  GraphicsBlock,
} from "@/lib/tiptap-extensions";
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";

interface ExampleBlockSource {
  start: number;
  end: number;
  node: PMNode;
}

function findExampleBlockByUuid(
  doc: PMNode,
  uuid: string,
): ExampleBlockSource | null {
  let result: ExampleBlockSource | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "exampleBlock" && node.attrs?.uuid === uuid) {
      result = { start: pos, end: pos + node.nodeSize, node };
      return false;
    }
    return true;
  });
  return result;
}

export function ExampleBlockBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let blockJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findExampleBlockByUuid(mainEditor.state.doc, uuid);
      if (src) blockJson = src.node.toJSON() as JSONContent;
    }
    const fallback: JSONContent = {
      type: "exampleBlock",
      content: [
        {
          type: "exampleItemList",
          content: [
            {
              type: "exampleItem",
              content: [{ type: "paragraph", content: [] }],
            },
          ],
        },
      ],
    };
    return {
      doc: { type: "doc", content: [blockJson ?? fallback] } as JSONContent,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, mainEditor]);

  const floatId = `example:${uuid}`;

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
      // Atom blocks inside the example render as compact previews — same
      // pattern as heading-body. The user edits atoms in the main doc.
      TexBlock.configure({ cardContext: true }),
      FigureBlock.configure({ cardContext: true }),
      FigureCaption,
      GraphicsBlock.configure({ cardContext: true }),
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
    const src = findExampleBlockByUuid(ed.state.doc, uuid);
    if (!src) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    const first = incoming[0];
    if (!first || first.type !== "exampleBlock") return;
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
      const src = findExampleBlockByUuid(doc, uuid);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [
              {
                type: "exampleBlock",
                content: [
                  {
                    type: "exampleItemList",
                    content: [
                      {
                        type: "exampleItem",
                        content: [{ type: "paragraph", content: [] }],
                      },
                    ],
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
          kind="example"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div className="par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative">
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
