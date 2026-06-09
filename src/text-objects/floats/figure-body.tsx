"use client";

/**
 * Figure float body (L3n — the FINAL bodyless-kind migration) — a TipTap
 * embed rendering a single `figureBlock` or `graphicsBlock` node in its OWN
 * lifted-overlay float. Modeled wholesale on `example-block-body.tsx`'s
 * atom-in-float path; ONE body serves both kinds (it branches on the kind
 * parsed from the cardKey, like `ListBody` serves bullet + ordered lists).
 *
 * Decision B (editable caption): the figure NodeView, built with
 * `figureFloat: true`, renders its third mode `FigureFloatView` — the shared
 * `FigureVisual` (L3m) with an EDITABLE caption (`NodeViewContent`) but a
 * read-only image, no chrome, and no click-to-edit. So:
 *  - `figureBlock` → the caption round-trips here (whole-node write-back); the
 *    image's source/width are edited on the PAGE (like displayMath's
 *    "edit-in-main"), never in the float.
 *  - `graphicsBlock` (atom, no caption) → effectively read-only ("view &
 *    move", ≈ displayMath).
 *
 * The real docId is threaded via `useDocWriteHandleOrNull()` (NOT a null
 * docIdRef) so `FigurePanel` resolves the actual image and reuses the
 * refcounted object-URL (Issue-7b) for a flicker-free decode-cache hit on
 * open — copying example-block-body, NOT paragraph-body's `docIdRef: null`.
 *
 * Extension stack: the shared `buildEditorExtensions` factory with
 * `surface: "float"`, `figureFloat: true`, `cardContext: false`. The float
 * OMITS the doc-wide `sectionNumbers` numberer (which carries figure
 * numbering), so it never renumbers its lone figure to "1": the "Figure N"
 * number rides in via the synced `figureNumber` attr (`toJSON`) and is
 * rendered directly by FigureVisual (the same attr-read mechanism heading
 * uses for `sectionNumber`).
 */

import { type RefObject, useCallback, useMemo, useRef } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { parseAnyKey } from "@/floats/float-key";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";

type FigureKind = "figureBlock" | "graphicsBlock";

interface FigureSource {
  start: number;
  end: number;
  node: PMNode;
}

function findFigureByUuid(
  doc: PMNode,
  uuid: string,
  kind: FigureKind,
): FigureSource | null {
  let result: FigureSource | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === kind && node.attrs?.uuid === uuid) {
      result = { start: pos, end: pos + node.nodeSize, node };
      return false;
    }
    return true;
  });
  return result;
}

// Kind-appropriate empty seed/fallback. figureBlock keeps its optional
// `figureCaption` child so PM has the editable caption slot; graphicsBlock is
// an atom (no content).
function emptyFigureFor(kind: FigureKind): JSONContent {
  return kind === "figureBlock"
    ? { type: "figureBlock", content: [{ type: "figureCaption" }] }
    : { type: "graphicsBlock" };
}

export function FigureBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  // One body, two kinds: the kind is fixed for this float's lifetime, parsed
  // from the cardKey via `parseAnyKey` (handles both the AF `float:textobject:
  // <kind>:<uuid>` grammar and the legacy `textobject:<kind>:<uuid>` shape).
  // Resolving the source node by (kind, uuid) — not uuid alone — is collision-
  // proof, since figureBlock and graphicsBlock uuids are minted from separate
  // id sets. No colon-slice fallback (slicing a `float:` key gives the wrong
  // segment); an unparseable key → "" → no source node matched.
  const kind = (parseAnyKey(cardKey)?.kind ?? "") as FigureKind;

  const initial = useMemo(() => {
    let blockJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findFigureByUuid(mainEditor.state.doc, uuid, kind);
      if (src) blockJson = src.node.toJSON() as JSONContent;
    }
    return {
      doc: {
        type: "doc",
        content: [blockJson ?? emptyFigureFor(kind)],
      } as JSONContent,
    };
    // Matches every sibling float body: the `react-hooks/*` disable also opts
    // this component out of the React Compiler's `refs` analysis, which would
    // otherwise flag the deliberate read-the-live-main-editor-during-render
    // pattern these bodies are built on (`ref.current?.getEditor()`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, kind, mainEditor]);

  const floatId = cardKey;

  // The real docId so FigurePanel resolves the image (read-only) and reuses
  // the Issue-7b refcounted object-URL — flicker-free on open. Read by
  // FigureBlockNodeView via extension.options.docIdRef.
  const docId = useDocWriteHandleOrNull()?.docId ?? null;
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;

  const floatEditor = useEditor({
    extensions: buildEditorExtensions({
      surface: "float",
      editable: true,
      cardContext: false,
      // The figure NodeView's third mode: editable caption + read-only image,
      // no chrome, no click-to-edit (so virgil-figure-click can't misfire from
      // the float — the L3h.1 class).
      figureFloat: true,
      // The figure float's lozenge is readOnly (no rename/delete prompts) and
      // its doc holds only a figure (no heading/list/paragraph-with-title), so
      // NONE of the structural callbacks are read here — pass an empty set.
      callbacks: {},
      docIdRef,
      // Threaded for factory parity; the figure float proxies no structural
      // writes (no heading/list title), so it stays inert.
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
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

  // Whole-node write-back by uuid (the example-block-body shape): replace the
  // source figure with the float's edited node, preserving MAIN's attrs. Only
  // the figureCaption child (riding in `first.content`) actually changes — the
  // float has no chrome, so the image attrs (source/width/label/extras/
  // figureNumber) are byte-identical to what was seeded and survive the merge.
  function writeBackToMain(doc: JSONContent) {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    const src = findFigureByUuid(ed.state.doc, uuid, kind);
    if (!src) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    const first = incoming[0];
    if (!first || first.type !== kind) return;
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
      const src = findFigureByUuid(doc, uuid, kind);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [emptyFigureFor(kind)],
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
    [uuid, kind],
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
          kind={kind}
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div
        className={`par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative ${viewToggleClasses(chrome.menuBar)}`}
      >
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
