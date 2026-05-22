"use client";

/**
 * Paragraph float body — TipTap embed mirroring the main editor's
 * paragraph schema. Edits round-trip to the source paragraph in the
 * main doc (identified by `uuid`) via `useFloatMainSync`.
 *
 * Migrated from the deleted `src/components/ParagraphFloat.tsx`. The
 * outer FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat` — this module is body-only.
 *
 * Schema is StarterKit minus block kinds: a paragraph is one node, so
 * Doc > Paragraph is the whole tree. All inline atoms (citation,
 * footnote, math, …) come through the same extension list the main
 * editor uses, so content round-trips losslessly.
 *
 * The editable `parTitle` field lives above the embedded editor; the
 * shared `FloatTitleField` carries the input chrome.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  InlineMath,
  Footnote,
  LatexComment,
  Citation,
  LabelRef,
  LatexCommandMark,
  AiRequestMarker,
  LinkedAnchor,
  LinkedAnchorGuard,
  TabIndent,
} from "@/lib/tiptap-extensions";
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";
import { FloatTitleField } from "./float-title-field";

export function ParagraphBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;
  const [title, setTitle] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  // Seed once from main on mount; thereafter useFloatMainSync drives
  // main→float and our onUpdate drives float→main.
  const initial = useMemo(() => {
    let paragraphContent: JSONContent[] = [];
    let initTitle: string | null = null;
    if (mainEditor) {
      mainEditor.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.attrs?.uuid === uuid) {
          const json = node.toJSON() as JSONContent;
          paragraphContent = json.content ?? [];
          initTitle = (node.attrs?.parTitle as string | null) ?? null;
          return false;
        }
        return true;
      });
    }
    return {
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: paragraphContent }],
      } as JSONContent,
      title: initTitle,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  useEffect(() => {
    setTitle(initial.title);
  }, [initial.title]);

  const floatId = `par:${uuid}`;

  const floatEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        listItem: false,
        dropcursor: false,
      }),
      Highlight.configure({ multicolor: true }),
      InlineMath,
      Footnote,
      LatexComment,
      Citation,
      LabelRef,
      LatexCommandMark,
      AiRequestMarker,
      LinkedAnchor,
      LinkedAnchorGuard,
      TabIndent,
    ],
    content: initial.doc,
    editable: chrome.showParagraphFloatTitleEdit,
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
    const firstPar = doc.content?.[0];
    if (!firstPar || firstPar.type !== "paragraph") return;
    let pos: number | null = null;
    let targetNode: PMNode | null = null;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.attrs?.uuid === uuid) {
        pos = p;
        targetNode = n;
        return false;
      }
      return true;
    });
    if (pos == null || !targetNode) return;
    const found: PMNode = targetNode;
    try {
      const fragment = (firstPar.content ?? []).map((c) =>
        ed.state.schema.nodeFromJSON(c),
      );
      const newPar = ed.state.schema.nodes.paragraph.create(
        found.attrs,
        fragment,
        found.marks,
      );
      const tr = ed.state.tr.replaceWith(pos, pos + found.nodeSize, newPar);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  function commitTitle(newTitle: string | null) {
    setTitle(newTitle);
    setEditingTitle(false);
    const ed = ref.current?.getEditor();
    if (!ed) return;
    let foundPos: number | null = null;
    let foundAttrs: Record<string, unknown> | null = null;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.attrs?.uuid === uuid) {
        foundPos = p;
        foundAttrs = { ...n.attrs };
        return false;
      }
      return true;
    });
    if (foundPos == null || foundAttrs == null) return;
    const tr = ed.state.tr.setNodeMarkup(foundPos, undefined, {
      ...(foundAttrs as Record<string, unknown>),
      parTitle: newTitle,
    });
    ed.view.dispatch(tr);
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      let found: PMNode | null = null;
      let nextTitle: string | null = null;
      doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.attrs?.uuid === uuid) {
          found = node;
          nextTitle = (node.attrs?.parTitle as string | null) ?? null;
          return false;
        }
        return true;
      });
      if (!found) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      setTitle((prev) => (prev === nextTitle ? prev : nextTitle));
      const node = found as PMNode;
      const json = node.toJSON() as JSONContent;
      return {
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: json.content ?? [] }],
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
          kind="paragraph"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div className="par-float-body flex-1 overflow-auto px-8 py-4">
        <div
          className={`par-title-wrapper has-text par-float-paragraph${
            title ? " has-title" : " has-add-btn"
          }`}
        >
          <FloatTitleField
            title={title}
            editing={chrome.showParagraphFloatTitleEdit && editingTitle}
            canEdit={chrome.showParagraphFloatTitleEdit}
            onStartEdit={() => setEditingTitle(true)}
            onCommit={commitTitle}
            onCancel={() => setEditingTitle(false)}
            onClear={() => commitTitle(null)}
            placeholder="Paragraph title…"
          />
          <div className="par-body-container">
            <EditorContent editor={floatEditor} />
          </div>
        </div>
      </div>
    </>
  );
}
