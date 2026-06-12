"use client";

/**
 * Example-item float body — the LAST SUB-OBJECT lift float (L3l, Chip 6).
 *
 * A direct mirror of `list-item-body.tsx` (L3k) one wrap level deeper. An
 * `exampleItem` is `group:"textObject"`, NOT `block`, and `Document` is
 * `content:"block+"` — so a bare item CANNOT be a top-level float-doc child.
 * Where listItem seeds `doc > bulletList|orderedList > listItem` (2 levels),
 * exampleItem seeds the FULL expex envelope `doc > exampleBlock >
 * exampleItemList > exampleItem` (3 levels) via `wrapItemForFloat` (the
 * float-side wrapper builder that inherits the source block's numbering, so
 * the float renders the real `(N)` not `(?)`). The wrapper provides the
 * example context, so the float renders the item's `subLabel` marker (a./i./…,
 * a real `.expex-item-marker` DOM element inside the item's grid) and the
 * `.expex-item-row` marker+body grid for free through the same
 * `buildEditorExtensions({surface:"float"})` factory the other prose bodies use
 * — no marker plumbing here.
 *
 * Write-back is INNER-TARGETED, unwrapping TWO levels (the key difference from
 * listItem's one): on `onUpdate` we find the source exampleItem by uuid in
 * main, take the float's `exampleBlock > exampleItemList`'s CHILDREN
 * (`incoming[0].content[0].content` = the edited item(s)), and `replaceWith`
 * over ONLY the source item's own range — never the block or the list. Sibling
 * items + the parent exampleBlock (and its uuid) stay byte-intact. An in-float
 * Enter-split can yield >1 item; the parent exampleItemList accepts the
 * siblings, so the range-replace handles it (main's block-uuid backfill
 * re-mints any split clone that copied the source uuid — the same `\vxid`
 * round-trip every exampleItem uses).
 *
 * No `renderGhost` (unlike listItem): exampleItem is the sub-object analog of
 * `exampleBlock`, which ships none. listItem needs one because a bare `<li>`'s
 * `::marker` renders via the enclosing list's padding (gone when detached);
 * exampleItem's marker is a real `.expex-item-marker` DOM child kept by the
 * default clone, the marker+body grid is self-contained on `.expex-item-row`
 * (`.expex-item-list` is `display:contents`; the `.expex-block` grid only
 * positions the `(N)` number), every expex rule is unscoped, and the overlay
 * already supplies `.tiptap` scope + reads the em-base from
 * `getComputedStyle(anchorDom).fontSize` — the L3d.2 fix written FOR
 * `.expex-item-marker`'s `0.95em`. (Wrapping in `.expex-block` without an
 * `.expex-number` sibling would squash the item into the 1.5em number column.)
 *
 * Modeled on `list-item-body.tsx` (factory float editor + `useFloatMainSync` +
 * `docIdRef` threaded so a graphicsBlock as the item's first child resolves its
 * image + the 3 proxied callback refs + host). The seed/write-back helpers
 * below are factored as pure, exported functions — also the seam for the
 * round-trip lock in `__tests__/example-item-inner-writeback.test.ts`.
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
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import { generateShortId } from "@/lib/uuid";
import type { TextObjectFloatBodyProps } from "../types";

/** The enclosing exampleBlock's render attrs — the numbering context the
 *  float wrapper inherits so it renders the real `(N)` (and the right
 *  single/multi styling + any custom tag/override), not the default `(?)`.
 *  Everything EXCEPT the synthetic wrapper `uuid`, which is minted per-float
 *  (the anti-thrash invariant — see `wrapItemForFloat`). */
export interface ExampleBlockNumbering {
  number: number;
  kind: string;
  exnoOverride: string | number | null;
  tag: string;
}

export interface ExampleItemSource {
  start: number;
  end: number;
  node: PMNode;
  /** Render attrs of the enclosing exampleBlock, copied onto the synthetic
   *  wrapper. null only if the item somehow isn't inside an exampleBlock
   *  (schema-impossible; defensive → wrapper falls back to defaults). */
  numbering: ExampleBlockNumbering | null;
}

/** Find an exampleItem by uuid AND capture its enclosing exampleBlock's
 *  numbering (so the synthetic float wrapper can render the real `(N)`). The
 *  wrapper is always the fixed `exampleBlock > exampleItemList` envelope; the
 *  numbering rides in as copied block attrs (no parent-KIND report needed,
 *  unlike listItem — the parent kind is always exampleBlock). */
export function findExampleItemByUuid(
  doc: PMNode,
  uuid: string,
): ExampleItemSource | null {
  let result: ExampleItemSource | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "exampleItem" && node.attrs?.uuid === uuid) {
      result = {
        start: pos,
        end: pos + node.nodeSize,
        node,
        numbering: enclosingBlockNumbering(doc, pos),
      };
      return false;
    }
    return true;
  });
  return result;
}

/** Walk up from the item position to its enclosing exampleBlock and read the
 *  render attrs the float wrapper inherits. The block is always an ancestor by
 *  schema (`exampleBlock > exampleItemList > exampleItem`); we resolve rather
 *  than use `descendants`' immediate-parent arg, which is the exampleItemList —
 *  one level too shallow. */
function enclosingBlockNumbering(
  doc: PMNode,
  itemPos: number,
): ExampleBlockNumbering | null {
  const $pos = doc.resolve(itemPos);
  for (let d = $pos.depth; d >= 0; d--) {
    const anc = $pos.node(d);
    if (anc.type.name === "exampleBlock") {
      return {
        number: anc.attrs.number,
        kind: anc.attrs.kind,
        exnoOverride: anc.attrs.exnoOverride,
        tag: anc.attrs.tag,
      };
    }
  }
  return null;
}

/** Build the float-doc wrapper for an item — the `exampleBlock >
 *  exampleItemList > exampleItem` envelope, and the SOLE builder for both the
 *  seed AND every `readSource` re-wrap so they serialize byte-identically. Two
 *  things keep that byte-identity (and so keep `useFloatMainSync`'s `sameDoc`
 *  check from firing a spurious, float-resetting `setContent` on every foreign
 *  main transaction):
 *    - an EXPLICIT wrapper `uuid`, minted once at seed and threaded back here;
 *    - the `numbering` inherited from the source's enclosing exampleBlock,
 *      applied IDENTICALLY in both paths — so the float renders the real `(N)`
 *      (and single/multi styling + custom tag/override) instead of the default
 *      `(?)`. The synthetic `uuid` always overrides any in `numbering`.
 *  The DROP path keeps using `buildWrap` (drop-adapters), which DEFAULTS the
 *  numbering on purpose — a dropped item must renumber to its new context.
 *  `exampleItemList` carries no uuid attr → `{}`. Returns the exampleBlock node
 *  JSON; callers nest it in a `doc`. */
export function wrapItemForFloat(
  schema: Schema,
  itemNode: PMNode,
  wrapperUuid: string | null,
  numbering: ExampleBlockNumbering | null,
): JSONContent {
  const block = schema.nodes.exampleBlock;
  const itemList = schema.nodes.exampleItemList;
  const inner = itemList.create({}, [itemNode]);
  const blockAttrs = numbering
    ? { ...numbering, uuid: wrapperUuid }
    : { uuid: wrapperUuid };
  return block.create(blockAttrs, [inner]).toJSON() as JSONContent;
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
 *  unwrap the float's `exampleBlock > exampleItemList > item(s)` (TWO levels),
 *  and rebuild each item as a main-schema node — the primary (index 0) keeps
 *  the source item's uuid (and any attrs the float doesn't model, e.g.
 *  `subLabel`), split-off siblings pass through (main's backfill re-mints a
 *  clone that copied the uuid). Returns the range + nodes to `replaceWith`, or
 *  null when nothing should be written. Exported as the testable seam for the
 *  round-trip lock. */
export function resolveInnerWriteback(
  doc: PMNode,
  uuid: string,
  floatDoc: JSONContent,
): InnerWriteback | null {
  const src = findExampleItemByUuid(doc, uuid);
  if (!src) return null;
  const block = (floatDoc.content ?? [])[0];
  if (!block || block.type !== "exampleBlock") return null;
  const itemList = (block.content ?? [])[0];
  if (!itemList || itemList.type !== "exampleItemList") return null;
  const itemsJson = itemList.content ?? [];
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
  type: "exampleItem",
  content: [{ type: "paragraph", content: [] }],
};

const EMPTY_WRAPPER: JSONContent = {
  type: "exampleBlock",
  content: [{ type: "exampleItemList", content: [EMPTY_ITEM] }],
};

export function ExampleItemBody({
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

  // Seed once from main on mount: find the source item by uuid and seed the
  // float doc WRAPPED in the full expex envelope via `wrapItemForFloat`, which
  // inherits the enclosing exampleBlock's numbering (so the float renders the
  // real `(N)`). A bare exampleItem (group:"textObject") can't be a top-level
  // doc child; the `exampleBlock > exampleItemList` wrapper provides the example
  // context that renders the marker + grid. Thereafter `useFloatMainSync` drives
  // main→float and `onUpdate` drives the inner-targeted (2-level unwrap)
  // float→main write-back.
  const initial = useMemo(() => {
    let wrapperJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findExampleItemByUuid(mainEditor.state.doc, uuid);
      if (src) {
        // Build via `wrapItemForFloat` (NOT `buildWrap`) so the seed inherits the
        // source block's numbering identically to the `readSource` sync path —
        // byte-identical JSON, no `sameDoc` thrash. The wrapper uuid is the
        // stable, mint-once `wrapperUuidRef` (above), so re-running this memo
        // never changes it.
        wrapperJson = wrapItemForFloat(
          mainEditor.state.schema,
          src.node,
          wrapperUuidRef.current,
          src.numbering,
        );
      }
    }
    return {
      doc: {
        type: "doc",
        content: [wrapperJson ?? EMPTY_WRAPPER],
      } as JSONContent,
    };
    // `mainEditor` (a `ref.current` read) is intentionally omitted, like the
    // sibling float bodies (list-item-body): the seed is a one-shot and
    // `useFloatMainSync` re-reads the real source on attach. (Also keeps the
    // body on the established float-body ref pattern — reassigning the proxied
    // callback refs during render — that the react-hooks compiler otherwise
    // flags.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const floatId = `exampleItem:${uuid}`;

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded into
  // the factory's `callbacks` exactly as `list-item-body.tsx`. An example
  // item's doc holds only a one-item example, so the heading NodeView never
  // instantiates (these stay inert); a graphicsBlock as the item's first child
  // renders as a compact card preview (docIdRef threaded below so its image
  // resolves). `.current` is reassigned each render so the closures see the
  // live handle.
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
  // resolves and renders its actual image (read-only) — like list-item-body.
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
      const src = findExampleItemByUuid(doc, uuid);
      if (!src) {
        return {
          doc: {
            type: "doc",
            content: [EMPTY_WRAPPER],
          } as JSONContent,
          missing: true,
        };
      }
      // Re-wrap the live item, reusing the seed's wrapper uuid AND re-reading
      // the source block's numbering so the synced JSON matches the seed
      // byte-for-byte (no spurious setContent). If main renumbers the block,
      // the new number flows in here and the float updates to match.
      return {
        doc: {
          type: "doc",
          content: [
            wrapItemForFloat(
              src.node.type.schema,
              src.node,
              wrapperUuidRef.current,
              src.numbering,
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
          kind="exampleItem"
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
