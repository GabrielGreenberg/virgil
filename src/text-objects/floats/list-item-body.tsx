"use client";

/**
 * List-item float body — the FIRST SUB-OBJECT lift float (L3k, Chip 5).
 *
 * A `listItem` is `group:"textObject"`, NOT `block`, and `Document` is
 * `content:"block+"` — so a bare item CANNOT be a top-level float-doc child.
 * The float therefore seeds the item WRAPPED in a minimal parent list
 * (`doc > bulletList|orderedList > listItem`, matching the item's REAL parent
 * type in main) via the canonical `buildWrap` envelope. The wrapper list
 * provides the list context, so the float renders the item's marker (disc /
 * number) for free through the same `buildEditorExtensions({surface:"float"})`
 * factory the other prose bodies use — no marker plumbing here.
 *
 * Write-back is INNER-TARGETED (the key difference from the whole-container
 * bodies like `list-body.tsx`): on `onUpdate` we find the source listItem by
 * uuid in main, take the float wrapper list's CHILDREN (`incoming[0].content`
 * = the edited item(s)), and `replaceWith` over ONLY the source item's own
 * range — never the whole list. Siblings + the parent list (and its uuid)
 * stay intact. An in-float Enter-split can yield >1 item; the parent list
 * accepts the siblings, so the range-replace handles it (main's block-uuid
 * backfill re-mints any split clone that copied the source uuid).
 *
 * Modeled on `list-body.tsx` (factory float editor + `useFloatMainSync` +
 * `docIdRef` threaded so a graphicsBlock-as-first-child resolves its image +
 * the 3 proxied callback refs + host). exampleItem (next chip) mirrors this
 * shape with one more wrap level — so the seed/write-back helpers below are
 * factored as pure, exported functions (also the seam for the round-trip
 * lock in `__tests__/list-item-inner-writeback.test.ts`).
 */

import { type RefObject, useCallback, useMemo, useRef } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import { buildWrap } from "../drop-adapters";
import type { TextObjectFloatBodyProps } from "../types";

type ListKind = "bulletList" | "orderedList";

export interface ListItemSource {
  start: number;
  end: number;
  node: PMNode;
  /** The item's REAL immediate parent list kind (bullet vs ordered),
   *  resolved from the `parent` arg of `descendants`. Drives the wrapper
   *  the float seeds so the rendered marker matches the page. */
  parentKind: ListKind;
}

/** Find a listItem by uuid AND report its immediate parent list kind. The
 *  parent comes from `descendants`' 3rd callback arg — the enclosing
 *  bulletList/orderedList (listItem is always a child of one by schema). */
export function findListItemByUuid(
  doc: PMNode,
  uuid: string,
): ListItemSource | null {
  let result: ListItemSource | null = null;
  doc.descendants((node, pos, parent) => {
    if (result) return false;
    if (node.type.name === "listItem" && node.attrs?.uuid === uuid) {
      result = {
        start: pos,
        end: pos + node.nodeSize,
        node,
        parentKind:
          parent?.type.name === "orderedList" ? "orderedList" : "bulletList",
      };
      return false;
    }
    return true;
  });
  return result;
}

/** Build the float-doc wrapper for an item — the SAME `doc > list > item`
 *  envelope `buildWrap` produces, but with an EXPLICIT wrapper uuid so the
 *  seed and every `readSource` re-wrap serialize byte-identically. (Without a
 *  fixed uuid the seed's `buildWrap`-minted wrapper id would differ from
 *  readSource's, so `useFloatMainSync`'s `sameDoc` check would fire a
 *  spurious `setContent` — resetting the float — on every foreign main
 *  transaction.) Returns the wrapper node JSON; callers nest it in a `doc`. */
export function wrapItemForFloat(
  schema: Schema,
  itemNode: PMNode,
  parentKind: ListKind,
  wrapperUuid: string | null,
): JSONContent {
  const parent = schema.nodes[parentKind];
  return parent.create({ uuid: wrapperUuid }, [itemNode]).toJSON() as JSONContent;
}

export interface InnerWriteback {
  /** Source item's own range in main — the replace target. */
  from: number;
  to: number;
  /** The edited item(s) rebuilt as main-schema nodes; the primary preserves
   *  the source item's uuid. */
  items: PMNode[];
}

/** Pure inner-targeted write-back transform: resolve the source item by uuid,
 *  unwrap the float's `list > item(s)`, and rebuild each item as a main-schema
 *  node — the primary (index 0) keeps the source item's uuid (and any attrs
 *  the float doesn't model), split-off siblings pass through (main's backfill
 *  re-mints a clone that copied the uuid). Returns the range + nodes to
 *  `replaceWith`, or null when nothing should be written. Exported as the
 *  testable seam for the round-trip lock. */
export function resolveInnerWriteback(
  doc: PMNode,
  uuid: string,
  floatDoc: JSONContent,
): InnerWriteback | null {
  const src = findListItemByUuid(doc, uuid);
  if (!src) return null;
  const wrapper = (floatDoc.content ?? [])[0];
  if (
    !wrapper ||
    (wrapper.type !== "bulletList" && wrapper.type !== "orderedList")
  ) {
    return null;
  }
  const itemsJson = wrapper.content ?? [];
  if (itemsJson.length === 0) return null;
  const schema = src.node.type.schema;
  try {
    const items = itemsJson.map((item, i) =>
      schema.nodeFromJSON(
        i === 0
          ? {
              ...item,
              attrs: {
                ...src.node.attrs,
                ...(item.attrs ?? {}),
                uuid: src.node.attrs.uuid,
              },
            }
          : item,
      ),
    );
    return { from: src.start, to: src.end, items };
  } catch {
    return null;
  }
}

const EMPTY_ITEM: JSONContent = {
  type: "listItem",
  content: [{ type: "paragraph", content: [] }],
};

export function ListItemBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  // Stable wrapper uuid captured from the seed's `buildWrap`, reused by every
  // `readSource` re-wrap so the synced wrapper JSON stays byte-identical to
  // the seed (anti-thrash — see `wrapItemForFloat`).
  const wrapperUuidRef = useRef<string | null>(null);

  // Seed once from main on mount: find the source item by uuid, detect its
  // REAL parent list kind, and seed the float doc WRAPPED in that parent via
  // the canonical `buildWrap`. A bare listItem (group:"textObject") can't be a
  // top-level doc child; the wrapper provides the list context that renders
  // the marker. Thereafter `useFloatMainSync` drives main→float and `onUpdate`
  // drives the inner-targeted float→main write-back.
  const initial = useMemo(() => {
    let parentKind: ListKind = "bulletList";
    let wrapperJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findListItemByUuid(mainEditor.state.doc, uuid);
      if (src) {
        parentKind = src.parentKind;
        const wrapped = buildWrap(mainEditor.state.schema, src.node, parentKind);
        wrapperUuidRef.current = (wrapped.attrs?.uuid as string | null) ?? null;
        wrapperJson = wrapped.toJSON() as JSONContent;
      }
    }
    const fallback: JSONContent = { type: parentKind, content: [EMPTY_ITEM] };
    return {
      doc: {
        type: "doc",
        content: [wrapperJson ?? fallback],
      } as JSONContent,
      parentKind,
    };
    // `mainEditor` (a `ref.current` read) is intentionally omitted, like the
    // sibling float bodies: the seed is a one-shot and `useFloatMainSync`
    // re-reads the real source on attach. (Also keeps the body on the
    // established float-body ref pattern — reassigning the proxied callback
    // refs during render — that the react-hooks compiler otherwise flags.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const floatId = `listItem:${uuid}`;

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as `list-body.tsx`. A list item's
  // doc holds only a one-item list, so the heading NodeView never instantiates
  // (these stay inert); a graphicsBlock as the item's first child renders as a
  // compact card preview (docIdRef threaded below so its image resolves).
  // `.current` is reassigned each render so the closures see the live handle.
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

  // Issue-4: thread the real docId so a figure/graphics atom in the item
  // resolves and renders its actual image (read-only) — like list-body.
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
      docIdRef,
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

  function writeBackToMain(floatDoc: JSONContent) {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    const wb = resolveInnerWriteback(ed.state.doc, uuid, floatDoc);
    if (!wb) return;
    try {
      const tr = ed.state.tr.replaceWith(wb.from, wb.to, wb.items);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      const src = findListItemByUuid(doc, uuid);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [{ type: "bulletList", content: [EMPTY_ITEM] }],
          } as JSONContent,
          missing: true,
        };
      }
      // Re-wrap the live item, reusing the seed's wrapper uuid so the synced
      // JSON matches the seed byte-for-byte (no spurious setContent).
      return {
        doc: {
          type: "doc",
          content: [
            wrapItemForFloat(
              src.node.type.schema,
              src.node,
              src.parentKind,
              wrapperUuidRef.current,
            ),
          ],
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
          kind="listItem"
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
