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
 * Covers (today): `blockquote`, `codeBlock` (editable, content-bearing),
 * `displayMath` (READ-ONLY atom — decision D, "view & move only": pop out to
 * see the rendered KaTeX large + drag it; the formula is edited on the PAGE
 * via the existing math popover, never in the float), `latexComment`
 * (EDITABLE atom — decision A, "fully editable, first-class": pop out the
 * `%comment`, edit it in the float, it round-trips to the source) and
 * `titleField` (EDITABLE, content-bearing like blockquote — the title/author/
 * date fields; decision C). All but `titleField` were already in the float
 * schema; `titleField` was the lone bodyless kind that was main-only, so its
 * node was PROMOTED into the float stack (L3j — see editor-extensions.ts).
 * The synced node renders itself (blockquote/codeBlock as plain nodes,
 * displayMath via its KaTeX NodeView, latexComment via its `editableAtomView`,
 * titleField via its `.title-field-wrapper` NodeView with the
 * "Title"/"Author"/"Date" annotation).
 *
 * Per-kind config carries `editable` (read-only kinds skip `onUpdate` /
 * write-back and sync main→float only) and `emptyAttrs` (atom kinds seed an
 * attr-based empty fallback, not a content-bearing placeholder). The EDITABLE
 * `latexComment` atom (L3i) is the cross-product of both: one more config row
 * (`editable:true` + `emptyAttrs:{text:""}`) — the whole-node write-back below
 * is already atom-compatible.
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
  /** Editable kinds (blockquote/codeBlock prose, latexComment atom) seed →
   *  sync → write back on `onUpdate`. Read-only kinds
   *  (displayMath: "view & move only" — decision D; the equation is edited on
   *  the PAGE via the KaTeX popover, never in the float) seed + sync
   *  main→float only, with NO `onUpdate` / write-back. */
  editable: boolean;
  /** Atom kinds (displayMath, latexComment) carry no child content, so their
   *  empty seed / missing fallback is attr-based (`{type, attrs}`) — a
   *  content-bearing placeholder would be schema-invalid. Absent → the kind is
   *  a content block whose empty fallback `emptyBlockFor` builds with children. */
  emptyAttrs?: Record<string, unknown>;
}

// Exported for the deterministic wiring lock (single-block-lift-wiring.test.ts):
// the read-only contract (displayMath `editable:false`, blockquote/codeBlock
// `editable:true`) is pinned without rendering the body.
export const SINGLE_BLOCK_CONFIG: Partial<
  Record<TextObjectKind, SingleBlockKindConfig>
> = {
  blockquote: {
    schemaType: "blockquote",
    floatIdPrefix: "bq",
    sourceKind: "blockquote",
    editable: true,
  },
  codeBlock: {
    schemaType: "codeBlock",
    floatIdPrefix: "code",
    sourceKind: "codeBlock",
    editable: true,
  },
  // L3h (bodyless kinds, Chip 2): displayMath is the first READ-ONLY / first
  // ATOM kind on this shared body. Same seed-by-uuid + useFloatMainSync
  // scaffold as the prose kinds, minus write-back (editable:false → no
  // onUpdate); the empty fallback is the attr-based atom `{displayMath,{latex}}`.
  displayMath: {
    schemaType: "displayMath",
    floatIdPrefix: "math",
    sourceKind: "displayMath",
    editable: false,
    emptyAttrs: { latex: "" },
  },
  // L3i (bodyless kinds, Chip 3): latexComment is the first EDITABLE ATOM kind
  // — decision A, "fully editable, first-class." One more config row: an atom
  // (attr-based `emptyAttrs:{text:""}`, like displayMath) that's also editable
  // (write-back on onUpdate, like the prose kinds). It renders editable with NO
  // cardContext flag because the factory adds `LatexComment` BARE (default
  // cardContext:false → `editableAtomView`) in main AND float; edits round-trip
  // because that view commits (on blur) via `setNodeMarkup` on the FLOAT editor
  // → the float's onUpdate → writeBackToMain (whole-atom replace by uuid). No
  // surface-gate risk (the commit is in-place on its own editor, not a global
  // main-targeted event like math's click bridge).
  latexComment: {
    schemaType: "latexComment",
    floatIdPrefix: "cmt",
    sourceKind: "latexComment",
    editable: true,
    emptyAttrs: { text: "" },
  },
  // L3j (bodyless kinds, Chip 4): titleField — the paper's title/author/date
  // fields; the LAST prose-shaped bodyless kind (decision C: include). One more
  // config row, content-bearing + editable like blockquote — NO `emptyAttrs`,
  // because its `content:"inline*"` makes `emptyBlockFor`'s
  // `{type:"titleField", content:[]}` schema-valid. The one new wrinkle lives
  // OUTSIDE this body: titleField was the only bodyless kind NOT in the float
  // schema, so its node was PROMOTED into the float stack (editor-extensions.ts);
  // here it's just another kind. The seed carries the full node (attrs incl.
  // `field`) so the NodeView renders the right "Title"/"Author"/"Date"
  // annotation; the whole-node write-back preserves main's attrs
  // (field/rawPrefix/isToday/uuid).
  titleField: {
    schemaType: "titleField",
    floatIdPrefix: "title",
    sourceKind: "titleField",
    editable: true,
  },
};

const DEFAULT_CONFIG: SingleBlockKindConfig = {
  schemaType: "blockquote",
  floatIdPrefix: "bq",
  sourceKind: "blockquote",
  editable: true,
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
 *  schema accepts). An atom kind (`emptyAttrs` set) has no children, so its
 *  fallback is attr-based (`{displayMath, {latex:""}}`). A blockquote needs at
 *  least one child block; a codeBlock is `text*`, so empty is valid. */
function emptyBlockFor(config: SingleBlockKindConfig): JSONContent {
  if (config.emptyAttrs) {
    return { type: config.schemaType, attrs: config.emptyAttrs };
  }
  if (config.schemaType === "blockquote") {
    return { type: "blockquote", content: [{ type: "paragraph", content: [] }] };
  }
  return { type: config.schemaType, content: [] };
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
        content: [blockJson ?? emptyBlockFor(config)],
      } as JSONContent,
    };
    // `mainEditor` (a `ref.current` read) is intentionally omitted, like
    // paragraph-body: the seed is a one-shot and `useFloatMainSync` re-reads
    // the real source on attach. (This disable also keeps the whole component
    // on the established float-body ref pattern — reassigning the proxied
    // callback refs during render — that the react-hooks compiler otherwise
    // flags, same as every sibling body.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, uuid]);

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
      // Read-only kinds (displayMath) build the float editor non-editable;
      // floats gate editability via TipTap's own `editable` flag (the main
      // surface uses the readOnlyEnforcer plugin instead — see editor-extensions).
      editable: config.editable,
      cardContext: true,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // None of these kinds holds a figure (blockquote content is prose,
      // codeBlock is text, displayMath is an atom), so — like paragraph-body —
      // pass no docId.
      docIdRef: null,
      // A blockquote paragraph's inline `+T` title write proxies to MAIN
      // through this; the float's own doc is never mutated by it, so
      // useFloatMainSync re-reads idempotently. Inert for codeBlock/displayMath.
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: initial.doc,
    editable: config.editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap ProseMirror prose prose-stone max-w-none focus:outline-none",
      },
    },
    // Read-only kinds (displayMath, decision D) have no write-back — the
    // equation is edited on the page, not in the float — so wire `onUpdate`
    // (and thus `writeBackToMain`) only for editable kinds.
    onUpdate: config.editable
      ? ({ editor }) => {
          writeBackToMain(editor.getJSON());
        }
      : undefined,
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
            content: [emptyBlockFor(config)],
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
    [config, uuid],
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
