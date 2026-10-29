"use client";

/**
 * List float body — TipTap embed rendering a whole bullet or ordered
 * list (every `<li>`, including nested sub-lists). Edits round-trip back
 * to the main editor's list node, keyed by the list's `uuid`.
 *
 * Migrated from the deleted `src/components/ListFloat.tsx`. The outer
 * FloatCard wrapper and header chrome now live in `FloatWindow` +
 * `FloatChrome`; this module is body-only. (The intermediate unified
 * `TextObjectFloat` that used to own them is itself deleted.)
 *
 * Two TextObject kinds — `bulletList` and `orderedList` — share this
 * body. The dynamic header label ("BULLET LIST" / "ORDERED LIST") comes
 * from inspecting the live node and is pushed up via `setHeaderLabel`.
 *
 * Extension stack: built by the shared `buildEditorExtensions` factory
 * with `surface: "float"` (FCU Chip C2) — the SAME chrome NodeViews as the
 * main editor, so the popped list renders faithful markers (disc /
 * 1.2.3.) and, if the list has a title, the very same inline `+T`
 * `*ListWithTitle` NodeView that main uses. The list's `parTitle`/`uuid`
 * ride in via the synced node attrs; the inline `+T` write PROXIES to the
 * MAIN editor via `host.getMainEditor()` (resolved by uuid), so editing
 * the title in the popout updates the source list. Colored text renders
 * too (TextColor is in the shared core). Block atoms nested in list items
 * (`TexBlock`, `FigureBlock`, `GraphicsBlock`) get `cardContext: true` —
 * compact static previews; the user edits the atoms in the main doc.
 */

import type { LabelRenameConfirm } from "@/lib/tiptap/label-rename";
import {
  type RefObject,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { useSpellcheckPortRef } from "@/lib/spell/spellcheck-context";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import {
  useFloatMainSync,
  type SourceRange,
} from "@/lib/float-sync";
import { soleRoot } from "@/lib/tiptap/bound-root";
import { landFloatWrite, refuseWrite, wrongRootReason } from "@/lib/float-write-back";
import type { TextObjectFloatBodyProps } from "../types";
import {
  FLOAT_PROSE_EDITOR_CLASS,
  FloatBodyFrame,
  useRegistryHeaderLabel,
} from "./float-body-frame";

interface ListSource {
  start: number;
  end: number;
  node: PMNode;
  typeName: "bulletList" | "orderedList";
}

const LIST_TYPES = ["bulletList", "orderedList"] as const;

function findListByUuid(
  doc: PMNode,
  uuid: string,
  hint?: SourceRange | null,
): ListSource | null {
  const src = findSourceNodeByUuid(doc, uuid, LIST_TYPES, hint);
  if (!src) return null;
  return {
    start: src.start,
    end: src.end,
    node: src.node,
    typeName: src.node.type.name as "bulletList" | "orderedList",
  };
}

export function ListBody({
  cardKey,
  id: uuid,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
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

  // The bullet-vs-ordered label — the registry's `computeLabel` for the
  // list's own kind, the same one the lifted overlay's popout-mode header
  // reads, so the two can't drift (task 1346).
  useRegistryHeaderLabel(initial.typeName, uuid, mainEditor, setHeaderLabel);

  const floatId = `list:${uuid}`;

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the heading/paragraph floats
  // (Chips B/C1). A list float's doc holds only a list, so the heading
  // NodeView never instantiates and these stay inert; a deeply-nested figure
  // inside a list item renders as a compact card preview that doesn't use
  // them either. Threaded for parity with the factory contract and to stay
  // structurally identical to the other prose bodies. `.current` is
  // reassigned each render so the closures see the live main handle.

  const onConfirmLabelRenameRef = useRef<LabelRenameConfirm | undefined>(undefined);
  onConfirmLabelRenameRef.current = (oldLabel, newLabel, refCount) =>
    ref.current?.onConfirmLabelRename(oldLabel, newLabel, refCount) ??
    Promise.resolve("confirm");

  const onConfirmHeadingDeleteRef = useRef<
    ((typeName: string) => Promise<boolean>) | undefined
  >(undefined);
  onConfirmHeadingDeleteRef.current = (typeName) =>
    ref.current?.onConfirmHeadingDelete(typeName) ?? Promise.resolve(true);

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
      cardContext: true,
      // Task 1170: the doc is exactly one list (either kind — the list-type
      // toggle swaps it) — no edit can leave the float without it.
      boundRoot: soleRoot("bulletList", "orderedList"),
      callbacks: {
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // Issue-4: thread the real docId so figure/graphics atoms resolve and
      // render their actual image (read-only) in the popped list instead of a
      // compact pill. Read by FigureBlockNodeView via extension.options.docIdRef.
      docIdRef,
      // The inline `+T` list-title write proxies to MAIN through this; the
      // float's own doc is never mutated by it, so useFloatMainSync re-reads
      // idempotently (FCU Chip C2).
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: initial.doc,
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          FLOAT_PROSE_EDITOR_CLASS,
      },
    },
    onUpdate({ editor }) {
      writeBackToMain(editor.getJSON());
    },
  });

  function writeBackToMain(doc: JSONContent) {
    // One door (task 1170): a refusal reaches `WriteRefusedBanner`, never a
    // bare return / swallowed catch.
    const outcome = landFloatWrite(ref.current?.getEditor(), floatId, (ed) => {
      // The live source range doubles as this write's position hint (task
      // 140), so the float→main direction stops walking the doc per keystroke.
      const src = findListByUuid(ed.state.doc, uuid, sourceRangeRef.current);
      if (!src) return null;
      const first = (doc.content ?? [])[0];
      if (
        !first ||
        (first.type !== "bulletList" && first.type !== "orderedList")
      ) {
        return refuseWrite(wrongRootReason("list"));
      }
      const newNode = ed.state.schema.nodeFromJSON({
        ...first,
        attrs: {
          ...src.node.attrs,
          ...(first.attrs ?? {}),
          uuid: src.node.attrs.uuid,
        },
      });
      return { from: src.start, to: src.end, content: newNode };
    });
    reportWrite(outcome);
  }

  const readSource = useCallback(
    (doc: PMNode, hint: SourceRange | null) => {
      const src = findListByUuid(doc, uuid, hint);
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
        range: { from: src.start, to: src.end },
      };
    },
    [uuid],
  );

  const { sourceMissing, sourceRangeRef, writeRefusal, reportWrite } = useFloatMainSync({
    mainEditor,
    floatEditor,
    floatId,
    readSource,
  });

  return (
    <FloatBodyFrame
      cardKey={cardKey}
      sourceKind="list"
      sourceMissing={sourceMissing}
      writeRefusal={writeRefusal}
    >
      <EditorContent editor={floatEditor} />
    </FloatBodyFrame>
  );
}
