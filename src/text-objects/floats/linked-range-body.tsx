"use client";

/**
 * LinkedRange float body — TipTap embed rendering the text covered by a
 * `linkedAnchor` mark with a given `anchorId`. Edits in the float
 * round-trip into the same range in the main doc.
 *
 * Replaces the deleted session-only `SelectionFloat` + `selection-floats.ts`
 * registry. The source range is read from the live `linkedAnchor` mark
 * each time, so reload and undo cleanly recover.
 *
 * Range resolution: `findLinkedAnchorRange` walks the main doc for text
 * nodes carrying `linkedAnchor` with the matching `anchorId` and
 * returns `[firstMarkedStart, lastMarkedEnd)`. The range may span
 * multiple paragraphs.
 *
 * Paste policy: `LinkedAnchorGuard.transformPasted`
 * (src/lib/tiptap/linked-anchor.ts:134) strips `linkedAnchor` marks on
 * paste. AnchorIds mint exactly once at hydration; copies do not
 * propagate identity. Copying from this body and pasting elsewhere
 * drops the mark cleanly.
 */

import { type RefObject, useCallback, useMemo, useRef } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
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
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { TextObjectFloatBodyProps } from "../types";

/**
 * Walk the doc for text nodes whose marks include a `linkedAnchor` with
 * the matching `anchorId`. Returns the bounding range
 * `[firstMarkedStart, lastMarkedEnd)`, which may include unmarked gaps
 * inside (e.g. a paragraph break between two marked spans).
 *
 * Returns null when no text carries the mark — typically because the
 * range was deleted or the doc was reloaded before sidecar reanchoring
 * restored it.
 */
function findLinkedAnchorRange(
  doc: PMNode,
  anchorId: string,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const hasMark = node.marks.some(
      (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
    );
    if (hasMark) {
      if (from === -1) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  if (from === -1) return null;
  return { from, to };
}

export function LinkedRangeBody({
  cardKey,
  id: anchorId,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const mainEditor = ref.current?.getEditor() ?? null;
  const floatId = `lrange:${anchorId}`;

  // Live range tracked across main transactions. Initialized once from
  // the current doc; re-derived if the mark vanishes and reappears.
  const rangeRef = useRef<{ from: number; to: number } | null>(null);

  const seed = useMemo(() => {
    if (!mainEditor) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        missing: true,
      };
    }
    const range = findLinkedAnchorRange(mainEditor.state.doc, anchorId);
    if (!range) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        missing: true,
      };
    }
    rangeRef.current = range;
    return { doc: sliceAsDoc(mainEditor.state.doc, range), missing: false };
    // Seed once on mount; thereafter useFloatMainSync drives main→float.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId]);

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
    content: seed.doc,
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

  function writeBackToMain(floatDoc: JSONContent) {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    const r = rangeRef.current;
    if (!r) return;
    try {
      // Build a fragment from the float doc's paragraphs. For a
      // multi-paragraph range, the float's doc carries multiple
      // paragraph nodes; concatenating them into a flat replacement
      // preserves the inter-paragraph breaks in the main doc.
      const blocks: PMNode[] = [];
      for (const c of floatDoc.content ?? []) {
        try {
          blocks.push(ed.state.schema.nodeFromJSON(c));
        } catch {
          /* skip invalid children */
        }
      }
      if (blocks.length === 0) return;
      const tr = ed.state.tr.replaceWith(r.from, r.to, blocks);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (!tr.docChanged) return;
      ed.view.dispatch(tr);
      // Update the tracked range to span the newly inserted content.
      const newSize = blocks.reduce((acc, n) => acc + n.nodeSize, 0);
      rangeRef.current = { from: r.from, to: r.from + newSize };
    } catch {
      /* schema mismatch / stale range — swallow */
    }
  }

  // Track the range across main transactions: any non-float change in
  // the main doc may shift the range or invalidate it (mark vanished).
  // Re-derive from the live mark on every read for correctness.
  const readSource = useCallback(
    (doc: PMNode) => {
      const range = findLinkedAnchorRange(doc, anchorId);
      if (!range) {
        rangeRef.current = null;
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      rangeRef.current = range;
      return { doc: sliceAsDoc(doc, range), missing: false };
    },
    [anchorId],
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
          kind="selection"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div className="par-float-body flex-1 overflow-auto px-8 py-4">
        <div className="par-title-wrapper has-text par-float-paragraph">
          <div className="par-body-container">
            <EditorContent editor={floatEditor} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Build a TipTap doc that wraps the main-doc slice at `[from, to)`. The
 * slice may carry partial-paragraph open depths; we unwrap them so the
 * float's flat paragraph schema accepts the content.
 */
function sliceAsDoc(
  doc: PMNode,
  range: { from: number; to: number },
): JSONContent {
  try {
    const slice = doc.slice(range.from, range.to);
    const fragJson = slice.content.toJSON();
    const children = Array.isArray(fragJson) ? fragJson : [];
    // If the slice starts inside a paragraph and ends inside one, the
    // top-level children are the inline runs — wrap them in a paragraph.
    // Otherwise they're already block-level (paragraph / etc.).
    const hasInlineLeaves = children.some(
      (c: JSONContent) => c.type === "text" || c.type === "inlineMath",
    );
    const docContent: JSONContent[] = hasInlineLeaves
      ? [{ type: "paragraph", content: children }]
      : children.length > 0
        ? children
        : [{ type: "paragraph" }];
    return { type: "doc", content: docContent };
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}
