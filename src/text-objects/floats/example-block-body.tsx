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
 *
 * Extension stack: built by the shared `buildEditorExtensions` factory
 * with `surface: "float"` (FCU Chip C2) — the SAME chrome NodeViews as the
 * main editor. The float OMITS the doc-wide `ExpexNumbering` extension
 * (symmetric with the heading float omitting `sectionNumbers`), so it can
 * never renumber its lone example to `(1)`: the example number `(N)` and
 * the sub-item letters `a./b./c.` ride in via the synced node attrs
 * (`number` / `subLabel`, carried by `toJSON`) and are rendered directly
 * by the `ExampleBlock` / `ExampleItem` NodeViews (the same attr-read
 * mechanism heading uses for `sectionNumber`). Colored text renders too
 * (TextColor is in the shared core). Block atoms inside the example
 * (`TexBlock`, `FigureBlock`, `GraphicsBlock`) get `cardContext: true` —
 * compact static previews; the user edits the atoms in the main doc.
 */

import { type RefObject, useCallback, useMemo, useRef } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { buildEditorExtensions } from "@/lib/editor-extensions";
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

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the heading/paragraph floats
  // (Chips B/C1). An example float's doc holds only an exampleBlock, so the
  // heading NodeView never instantiates and these stay inert; a nested figure
  // inside an example item renders as a compact card preview that doesn't use
  // them either. Threaded for parity with the factory contract and to stay
  // structurally identical to the other prose bodies. `.current` is
  // reassigned each render so the closures see the live main handle.
  const isLabelTakenRef = useRef<
    ((candidate: string, excludeLabel: string | null) => boolean) | undefined
  >(undefined);
  isLabelTakenRef.current = (candidate, excludeLabel) =>
    ref.current?.isLabelTaken(candidate, excludeLabel) ?? false;

  const onConfirmLabelRenameRef = useRef<
    | ((
        oldLabel: string,
        newLabel: string,
        refCount: number,
      ) => Promise<boolean>)
    | undefined
  >(undefined);
  onConfirmLabelRenameRef.current = (oldLabel, newLabel, refCount) =>
    ref.current?.onConfirmLabelRename(oldLabel, newLabel, refCount) ??
    Promise.resolve(false);

  const onConfirmHeadingDeleteRef = useRef<
    ((typeName: string) => Promise<boolean>) | undefined
  >(undefined);
  onConfirmHeadingDeleteRef.current = (typeName) =>
    ref.current?.onConfirmHeadingDelete(typeName) ?? Promise.resolve(true);

  const floatEditor = useEditor({
    extensions: buildEditorExtensions({
      surface: "float",
      editable: true,
      cardContext: true,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // cardContext figure/graphics previews render compact pills and don't
      // resolve images via docId; an example float passes none (matches the
      // pre-FCU float, which configured those atoms with cardContext only).
      docIdRef: null,
      // No structural write proxies here (examples carry no title), but the
      // host is threaded for parity with the other prose bodies; the float
      // omits ExpexNumbering, so the example number + sub-item letters ride
      // in purely via the synced node attrs (FCU Chip C2 / decision 8).
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
