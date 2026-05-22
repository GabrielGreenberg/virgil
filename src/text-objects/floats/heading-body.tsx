"use client";

/**
 * Heading float body — TipTap embed rendering an entire section
 * (heading + every block under it, up to the next heading of equal or
 * higher rank). Edits round-trip back to the main doc's section range,
 * keyed by the heading's `uuid`.
 *
 * Migrated from the deleted `src/components/HeadingFloat.tsx`. The
 * outer FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Per-instance label: heading bodies override the static "Heading" via
 * `setHeaderLabel` based on the underlying node's level
 * ("Chapter" / "Section" / "Subsection" / …). Other bodies don't touch
 * the callback and inherit the static `meta.label`.
 *
 * Block atom extensions (`TexBlock`, `FigureBlock`, `GraphicsBlock`) are
 * configured with `cardContext: true` — atoms inside the popped-out
 * section render as compact static previews. The user edits the atoms
 * in the main doc; the float is a section view, not an atom editor.
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
  TexBlock,
  FigureBlock,
  GraphicsBlock,
} from "@/lib/tiptap-extensions";
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { headingTypeName } from "@/lib/heading-types";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";

export function HeadingBody({
  cardKey,
  id: uuid,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let level = 1;
    const docContent: JSONContent[] = [];
    if (mainEditor) {
      const range = getSectionRangeByUuid(mainEditor.state.doc, uuid);
      if (range) {
        level = range.level;
        for (const n of range.nodes) {
          docContent.push(n.toJSON() as JSONContent);
        }
      } else {
        docContent.push({ type: "heading", attrs: { level: 1 }, content: [] });
      }
    } else {
      docContent.push({ type: "heading", attrs: { level: 1 }, content: [] });
    }
    return {
      doc: { type: "doc", content: docContent } as JSONContent,
      level,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  // Push the dynamic label up to the chrome on mount and whenever the
  // level changes. Clears on unmount so the chrome falls back to the
  // static `meta.label`.
  useEffect(() => {
    setHeaderLabel(headingTypeName(initial.level));
    return () => setHeaderLabel(null);
  }, [initial.level, setHeaderLabel]);

  const floatId = `hd:${uuid}`;

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
      TexBlock.configure({ cardContext: true }),
      FigureBlock.configure({ cardContext: true }),
      GraphicsBlock.configure({ cardContext: true }),
    ],
    content: initial.doc,
    editable: chrome.showHeadingFloatLabelEdit,
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
    const range = getSectionRangeByUuid(ed.state.doc, uuid);
    if (!range) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    try {
      const newNodes: PMNode[] = incoming
        .map((j) => {
          try {
            return ed.state.schema.nodeFromJSON(j);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as PMNode[];
      if (newNodes.length === 0) return;
      const sourceHeading = range.nodes[0];
      if (
        sourceHeading?.type.name === "heading" &&
        newNodes[0]?.type.name === "heading"
      ) {
        newNodes[0] = ed.state.schema.nodes.heading.create(
          {
            ...sourceHeading.attrs,
            level: newNodes[0].attrs.level ?? sourceHeading.attrs.level,
          },
          newNodes[0].content,
          newNodes[0].marks,
        );
      }
      const tr = ed.state.tr.replaceWith(range.start, range.end, newNodes);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      const range = getSectionRangeByUuid(doc, uuid);
      if (!range) {
        return {
          doc: {
            type: "doc",
            content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
          } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: {
          type: "doc",
          content: range.nodes.map((n) => n.toJSON() as JSONContent),
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
          kind="section"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div className="par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative">
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
