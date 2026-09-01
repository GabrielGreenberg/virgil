"use client";

/**
 * List-item float body — the FIRST SUB-OBJECT lift float (L3k, Chip 5).
 *
 * A `listItem` is `group:"textObject"`, NOT `block`, and `Document` is
 * `content:"block+"` — so a bare item CANNOT be a top-level float-doc child.
 * The float therefore seeds the item WRAPPED in a minimal parent list
 * (`doc > bulletList|orderedList > listItem`, matching the item's REAL parent
 * type in main) via `wrapItemForFloat`, the float-side builder that — for an
 * orderedList parent — sets the wrapper's `start` to the item's ordinal in its
 * source list (so a popped 2nd item renders "2.", not "1."). The wrapper list
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
import { useSpellcheckPortRef } from "@/lib/spell/spellcheck-context";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
  type SourceRange,
} from "@/lib/float-sync";
import { generateShortId } from "@/lib/uuid";
import type { TextObjectFloatBodyProps } from "../types";

type ListKind = "bulletList" | "orderedList";

/** The numbering context an orderedList wrapper inherits so the float marker
 *  matches the page. `bulletList` items are unnumbered (disc), so this rides
 *  along as `{ ordinal: 1, listType: null }` and `wrapItemForFloat` ignores it
 *  for the bullet branch. */
export interface ListNumbering {
  /** The item's 1-based ordinal in its source list = `(sourceList.start ?? 1)`
   *  + count of preceding siblings. Becomes the wrapper orderedList's `start`
   *  so a popped 2nd item renders "2.", not "1.". */
  ordinal: number;
  /** The source orderedList's `type` (a/A/i/I; null = decimal), copied onto
   *  the wrapper so the marker STYLE matches too. */
  listType: string | null;
}

export interface ListItemSource {
  start: number;
  end: number;
  node: PMNode;
  /** The item's REAL immediate parent list kind (bullet vs ordered),
   *  resolved from the `parent` arg of `descendants`. Drives the wrapper
   *  the float seeds so the rendered marker matches the page. */
  parentKind: ListKind;
  /** Numbering inherited by the wrapper (orderedList only; inert for bullet). */
  numbering: ListNumbering;
  /** The enclosing list's OWN range — this float's source region (task 140).
   *  The item's own range is not enough: the wrapper's `start`/`type` come from
   *  the parent list's attrs and the ordinal from the item's index in it, so a
   *  sibling inserted ABOVE the item (or a change to the list's own attrs)
   *  renumbers the float without touching the item itself. Null only if the
   *  item somehow resolves at the doc root. */
  containerRange: SourceRange | null;
}

/** Find a listItem by uuid AND report its immediate parent list kind + the
 *  numbering the float wrapper inherits. The parent comes from `descendants`'
 *  3rd callback arg (the enclosing bulletList/orderedList — a listItem is
 *  always a child of one by schema); the 4th arg is the item's index in that
 *  parent, which (offset by the list's `start`) gives the 1-based ordinal. */
export function findListItemByUuid(
  doc: PMNode,
  uuid: string,
  hint?: SourceRange | null,
): ListItemSource | null {
  const src = findSourceNodeByUuid(doc, uuid, "listItem", hint);
  if (!src) return null;
  const { node, parent, index } = src;
  const isOrdered = parent?.type.name === "orderedList";
  return {
    start: src.start,
    end: src.end,
    node,
    parentKind: isOrdered ? "orderedList" : "bulletList",
    numbering: {
      ordinal: isOrdered ? ((parent?.attrs.start ?? 1) as number) + index : 1,
      listType: isOrdered
        ? ((parent?.attrs.type ?? null) as string | null)
        : null,
    },
    containerRange: src.parentRange,
  };
}

/** Build the float-doc wrapper for an item — the `list > item` envelope, and
 *  the SOLE builder for both the seed AND every `readSource` re-wrap so they
 *  serialize byte-identically. Two things keep that byte-identity (and so keep
 *  `useFloatMainSync`'s `sameDoc` check from firing a spurious, float-resetting
 *  `setContent` on every foreign main transaction):
 *    - an EXPLICIT wrapper `uuid`, minted once at seed and threaded back here;
 *    - the `numbering` inherited from the source list, applied IDENTICALLY in
 *      both paths. For an orderedList parent the wrapper's `start` = the item's
 *      ordinal (so a popped 2nd item renders "2.", not "1.") and `type` copies
 *      the source's a/A/i/I style; bulletList items are unnumbered, so the
 *      numbering is inert there.
 *  The DROP path keeps using `buildWrap` (drop-adapters), which DEFAULTS the
 *  `start` on purpose — a dropped item must renumber to its new context.
 *  Returns the wrapper node JSON; callers nest it in a `doc`. */
export function wrapItemForFloat(
  schema: Schema,
  itemNode: PMNode,
  parentKind: ListKind,
  wrapperUuid: string | null,
  numbering: ListNumbering,
): JSONContent {
  const parent = schema.nodes[parentKind];
  const attrs =
    parentKind === "orderedList"
      ? { uuid: wrapperUuid, start: numbering.ordinal, type: numbering.listType }
      : { uuid: wrapperUuid };
  return parent.create(attrs, [itemNode]).toJSON() as JSONContent;
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
  hint?: SourceRange | null,
): InnerWriteback | null {
  const src = findListItemByUuid(doc, uuid, hint);
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

  // Stable wrapper uuid, minted EXACTLY once (lazy-init here, NOT inside the
  // seed memo). The seed memo re-runs on foreign re-renders; minting there would
  // hand `readSource` a fresh id each time, so its re-wrap would differ from the
  // float's current content and `useFloatMainSync` would fire a spurious,
  // float-resetting `setContent` on every foreign main edit. Minting once and
  // reusing it in the seed AND every `readSource` re-wrap keeps the synced
  // wrapper JSON byte-identical (anti-thrash — see `wrapItemForFloat`).
  const wrapperUuidRef = useRef<string | null>(null);
  if (wrapperUuidRef.current === null) wrapperUuidRef.current = generateShortId();

  // Seed once from main on mount: find the source item by uuid, detect its
  // REAL parent list kind, and seed the float doc WRAPPED in that parent via
  // `wrapItemForFloat`, which inherits the source list's numbering (so a popped
  // orderedList item renders its real ordinal). A bare listItem
  // (group:"textObject") can't be a top-level doc child; the wrapper provides
  // the list context that renders the marker. Thereafter `useFloatMainSync`
  // drives main→float and `onUpdate` drives the inner-targeted float→main
  // write-back.
  const initial = useMemo(() => {
    let parentKind: ListKind = "bulletList";
    let wrapperJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findListItemByUuid(mainEditor.state.doc, uuid);
      if (src) {
        parentKind = src.parentKind;
        // Build via `wrapItemForFloat` (NOT `buildWrap`) so the seed inherits the
        // source list's numbering identically to the `readSource` sync path —
        // byte-identical JSON, no `sameDoc` thrash. The wrapper uuid is the
        // stable, mint-once `wrapperUuidRef` (above), so re-running this memo
        // never changes it.
        wrapperJson = wrapItemForFloat(
          mainEditor.state.schema,
          src.node,
          parentKind,
          wrapperUuidRef.current,
          src.numbering,
        );
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

  const spellcheckPortRef = useSpellcheckPortRef();
  const floatEditor = useEditor({
    extensions: buildEditorExtensions({
      // Virgil's own spellchecker (task 518) — see `EditorExtensionsCtx`.
      spellcheckPortRef,
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
    // The live source range doubles as this write's position hint (task 140),
    // so the float→main direction stops walking the doc per float keystroke.
    const wb = resolveInnerWriteback(
      ed.state.doc,
      uuid,
      floatDoc,
      sourceRangeRef.current,
    );
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
    (doc: PMNode, hint: SourceRange | null) => {
      const src = findListItemByUuid(doc, uuid, hint);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [{ type: "bulletList", content: [EMPTY_ITEM] }],
          } as JSONContent,
          missing: true,
        };
      }
      // Re-wrap the live item, reusing the seed's wrapper uuid AND re-reading
      // the source list's numbering so the synced JSON matches the seed
      // byte-for-byte (no spurious setContent). If main reorders the list, the
      // new ordinal flows in here and the float marker updates to match.
      return {
        doc: {
          type: "doc",
          content: [
            wrapItemForFloat(
              src.node.type.schema,
              src.node,
              src.parentKind,
              wrapperUuidRef.current,
              src.numbering,
            ),
          ],
        } as JSONContent,
        missing: false,
        // The whole enclosing list, not just the item — see `containerRange`.
        range: src.containerRange ?? { from: src.start, to: src.end },
      };
    },
    [uuid],
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
          kind="listItem"
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
