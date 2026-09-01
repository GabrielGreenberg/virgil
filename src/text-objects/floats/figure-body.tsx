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
 * read-only image and no chrome. Click-to-edit fires (EX-F4-02): the figure
 * click carries THIS float's editor, so the tex-mode popover's save targets the
 * float (`onUpdate` → `writeBackToMain`), not MAIN by absolute pos. So:
 *  - `figureBlock` → the caption round-trips here, and clicking the image opens
 *    the popover to edit the env body (source/width/label), which writes back
 *    via the whole-node merge below.
 *  - `graphicsBlock` (atom, no caption) → the image is read-only but clicking it
 *    opens the popover on its `\includegraphics` command, round-tripping the
 *    same way.
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
import { useSpellcheckPortRef } from "@/lib/spell/spellcheck-context";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { parseAnyKey } from "@/floats/float-key";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
  type SourceRange,
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
  hint?: SourceRange | null,
): FigureSource | null {
  const src = findSourceNodeByUuid(doc, uuid, kind, hint);
  return src ? { start: src.start, end: src.end, node: src.node } : null;
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

  const spellcheckPortRef = useSpellcheckPortRef();
  const floatEditor = useEditor({
    extensions: buildEditorExtensions({
      // Virgil's own spellchecker (task 518) — see `EditorExtensionsCtx`.
      spellcheckPortRef,
      surface: "float",
      editable: true,
      cardContext: false,
      // The figure NodeView's third mode: editable caption + read-only image,
      // no chrome. Click-to-edit DOES fire and routes the save back into THIS
      // float editor (EX-F4-02) — the editor is editable, so the popover save
      // round-trips through `writeBackToMain` rather than mis-targeting MAIN.
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
  // source figure with the float's edited node. The attr merge below layers the
  // float's attrs OVER MAIN's, so whatever the float changed wins: typing in the
  // caption changes the figureCaption child (riding in `first.content`), and —
  // since EX-F4-02 wired click-to-edit in the float — the tex-mode popover save
  // can now also change the image attrs (source/width/label/extras), which ride
  // in via `first.attrs` and round-trip here. `figureNumber` is seeded from MAIN
  // (the float omits the numberer) and the popover never rewrites it, so it
  // stays in lockstep; `uuid` is always pinned to MAIN's below.
  function writeBackToMain(doc: JSONContent) {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    // The live source range doubles as this write's position hint (task 140),
    // so the float→main direction stops walking the doc per float keystroke.
    const src = findFigureByUuid(ed.state.doc, uuid, kind, sourceRangeRef.current);
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
    (doc: PMNode, hint: SourceRange | null) => {
      const src = findFigureByUuid(doc, uuid, kind, hint);
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
        range: { from: src.start, to: src.end },
      };
    },
    [uuid, kind],
  );

  const { sourceMissing, sourceRangeRef } = useFloatMainSync({
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
        className={`par-float-body heading-float-body flex-1 overflow-auto ${TEXT_FLOAT_BODY_PAD_CLASS} relative ${viewToggleClasses(chrome.menuBar)}`}
      >
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
