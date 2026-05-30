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

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
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

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the heading/paragraph floats
  // (Chips B/C1). A list float's doc holds only a list, so the heading
  // NodeView never instantiates and these stay inert; a deeply-nested figure
  // inside a list item renders as a compact card preview that doesn't use
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

  const docId = useDocWriteHandleOrNull()?.docId ?? null;
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;

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
