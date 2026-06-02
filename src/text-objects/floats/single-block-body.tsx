"use client";

/**
 * Single-block float body — ONE generic, editable TipTap embed that
 * renders a single whole top-level block (identified by `uuid`) and
 * round-trips edits back to the source node in the main doc. Parametrized
 * by kind exactly as `ListBody` serves both list kinds: register the same
 * component for every kind it covers and resolve the per-kind config from
 * the popout `cardKey` (`textobject:<kind>:<id>`). This is the FCU endgame
 * — register a prose-shaped bodyless kind and it renders faithfully
 * through the shared `buildEditorExtensions({surface:"float"})` factory,
 * instead of hand-rolling one near-identical body per kind.
 *
 * Covers (today): `blockquote`, `codeBlock`. Both are plain TipTap block
 * nodes already in the float schema (`EXPECTED_FLOAT_ORDER`) with no
 * NodeView and no doc-wide numbering, so the synced node renders itself.
 *
 * Modeled on `paragraph-body.tsx` (the single-block template) and
 * `list-body.tsx` (the one-body-many-kinds precedent):
 *   seed the source node by uuid → `useEditor(buildEditorExtensions(
 *   {surface:"float"}))` → whole-node `replaceWith` write-back rebuilt from
 *   MAIN's own attrs → `useFloatMainSync` (main→float) → `<EditorContent>`
 *   in `.par-float-body`.
 *
 * Write-back is a WHOLE-NODE `replaceWith` over the source node's own range
 * (NOT the text-bounded-range case): find the block by uuid+type, rebuild
 * it from main's own attrs + the float's content fragment, and
 * `tr.replaceWith(start, end, newNode)`. Preserving main's attrs means a
 * body edit never clobbers attrs the float doesn't model (and lets a
 * blockquote's nested paragraph `+T` title — proxied to main via `host`
 * — coexist with body edits).
 *
 * The 3 heading/figure callbacks + `host` are threaded for parity with the
 * other prose bodies. A blockquote CONTAINS paragraphs, so the inline `+T`
 * title NodeView proxies title writes to main through `host.getMainEditor()`;
 * for codeBlock they're inert (harmless). `docIdRef: null` — neither kind
 * holds a figure (matches paragraph-body, not list/example bodies).
 */

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
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import {
  type FloatSourceKind,
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import { parseTextObjectPopoutKey } from "../text-object-registry";
import type { TextObjectFloatBodyProps, TextObjectKind } from "../types";

/**
 * Per-kind knobs that drive the otherwise-identical body. `schemaType` is
 * the node `type.name` to seed/find/write back; `floatIdPrefix` namespaces
 * the `FLOAT_WRITE_META` tag; `sourceKind` selects the SourceMissingBanner
 * label.
 */
interface SingleBlockKindConfig {
  schemaType: string;
  floatIdPrefix: string;
  sourceKind: FloatSourceKind;
}

const SINGLE_BLOCK_CONFIG: Partial<
  Record<TextObjectKind, SingleBlockKindConfig>
> = {
  blockquote: {
    schemaType: "blockquote",
    floatIdPrefix: "bq",
    sourceKind: "blockquote",
  },
  codeBlock: {
    schemaType: "codeBlock",
    floatIdPrefix: "code",
    sourceKind: "codeBlock",
  },
};

const DEFAULT_CONFIG: SingleBlockKindConfig = {
  schemaType: "blockquote",
  floatIdPrefix: "bq",
  sourceKind: "blockquote",
};

interface BlockSource {
  start: number;
  end: number;
  node: PMNode;
}

function findBlockByUuid(
  doc: PMNode,
  schemaType: string,
  uuid: string,
): BlockSource | null {
  let result: BlockSource | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === schemaType && node.attrs?.uuid === uuid) {
      result = { start: pos, end: pos + node.nodeSize, node };
      return false;
    }
    return true;
  });
  return result;
}

/** Valid empty placeholder for a kind — used as the seed/missing fallback
 *  (the sync ignores content while `missing`, but the seed wants a node the
 *  schema accepts). A blockquote needs at least one child block; a codeBlock
 *  is `text*`, so empty is valid. */
function emptyBlockFor(schemaType: string): JSONContent {
  if (schemaType === "blockquote") {
    return { type: "blockquote", content: [{ type: "paragraph", content: [] }] };
  }
  return { type: schemaType, content: [] };
}

export function SingleBlockBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  // Resolve the per-kind config from the popout key (`textobject:<kind>:<id>`),
  // the ListBody-twin pattern with no prop-contract change. Falls back to the
  // blockquote config only if the key is somehow unparseable — this body is
  // registered solely for kinds present in SINGLE_BLOCK_CONFIG, so the
  // fallback is never hit in practice (it just keeps hooks unconditional).
  const config = useMemo<SingleBlockKindConfig>(() => {
    const parsed = parseTextObjectPopoutKey(cardKey);
    return (parsed && SINGLE_BLOCK_CONFIG[parsed.kind]) || DEFAULT_CONFIG;
  }, [cardKey]);

  // Seed once from main on mount: the FULL block node (attrs incl. `uuid`),
  // so write-back can resolve the source by uuid and any nested chrome
  // NodeView (e.g. a blockquote paragraph's `+T` title) renders. Thereafter
  // useFloatMainSync drives main→float and our onUpdate drives float→main.
  const initial = useMemo(() => {
    let blockJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findBlockByUuid(mainEditor.state.doc, config.schemaType, uuid);
      if (src) blockJson = src.node.toJSON() as JSONContent;
    }
    return {
      doc: {
        type: "doc",
        content: [blockJson ?? emptyBlockFor(config.schemaType)],
      } as JSONContent,
    };
    // `mainEditor` (a `ref.current` read) is intentionally omitted, like
    // paragraph-body: the seed is a one-shot and `useFloatMainSync` re-reads
    // the real source on attach. (This disable also keeps the whole component
    // on the established float-body ref pattern — reassigning the proxied
    // callback refs during render — that the react-hooks compiler otherwise
    // flags, same as every sibling body.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.schemaType, uuid]);

  const floatId = `${config.floatIdPrefix}:${uuid}`;

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the heading/paragraph/list
  // floats. A blockquote holds paragraphs whose inline `+T` title NodeView
  // proxies title writes to main via `host` below; the heading NodeView never
  // instantiates here, so these stay inert (and wholly inert for codeBlock).
  // Threaded for parity with the factory contract. `.current` is reassigned
  // each render so the closures see the live main handle.
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
      // Neither kind holds a figure (a blockquote's content is prose, a
      // codeBlock is text), so — like paragraph-body — pass no docId.
      docIdRef: null,
      // A blockquote paragraph's inline `+T` title write proxies to MAIN
      // through this; the float's own doc is never mutated by it, so
      // useFloatMainSync re-reads idempotently. Inert for codeBlock.
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
    const src = findBlockByUuid(ed.state.doc, config.schemaType, uuid);
    if (!src) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    const first = incoming[0];
    if (!first || first.type !== config.schemaType) return;
    try {
      // Rebuild from MAIN's OWN attrs (preserving the source uuid + any attrs
      // the float doesn't model), with the float's content fragment. A
      // whole-node replaceWith over the node's own range — the open-slice
      // L3f-7 case does NOT apply (this is a single closed block boundary).
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
      const src = findBlockByUuid(doc, config.schemaType, uuid);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [emptyBlockFor(config.schemaType)],
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
    [config.schemaType, uuid],
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
          kind={config.sourceKind}
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div
        className={`par-float-body flex-1 overflow-auto px-8 py-4 ${viewToggleClasses(chrome.menuBar)}`}
      >
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
