"use client";

/**
 * LinkedRange float body — TipTap embed rendering the text covered by a
 * `linkedAnchor` mark with a given `anchorId`. Edits in the float
 * round-trip into the same range in the main doc.
 *
 * Schema (FCU mandate — this was the LAST float not on the shared factory):
 * the embed is built by `buildEditorExtensions({ surface: "float", … })`, the
 * SAME stack every other prose float uses, so a selection spanning lists /
 * display math / figures / examples / colored text renders faithfully. The
 * pre-FCU hand-rolled StarterKit subset OMITTED those node types, so any
 * unsupported node in the seed was silently dropped (TipTap's
 * `errorOnInvalidContent: false`) and a rich range popped out BLANK.
 * `surface: "float"` omits the doc-wide numberers + folding so a popped range
 * never renumbers; the bidirectional sync below is unchanged — the factory
 * only WIDENS the schema.
 *
 * Header label: a plain selection grab rides a `kind: "transient"`
 * `linkedAnchor` (L3f-1), so its float reads "Text selection", not the static
 * "Linked range". Both the released-float header (`setHeaderLabel` below) and
 * the lift-overlay's popout-mode header (`TextObjectGrabHandle`) resolve it
 * through the ONE `linkedRange.computeLabel` in the registry — a real
 * annotation's range (note/highlight/cut/revision) returns null and falls
 * back to "Linked range", untouched.
 *
 * Replaces the deleted session-only `SelectionFloat` + `selection-floats.ts`
 * registry. The source range is read from the live `linkedAnchor` mark
 * each time, so reload and undo cleanly recover.
 *
 * Range resolution: `findLinkedAnchorRange` walks the main doc for text
 * nodes carrying `linkedAnchor` with the matching `anchorId` and
 * returns `[firstMarkedStart, lastMarkedEnd)`. The range may span
 * multiple paragraphs.
 *
 * Paste policy: `LinkedAnchorGuard.transformPasted`
 * (src/lib/tiptap/linked-anchor.ts:134) strips `linkedAnchor` marks on
 * paste. AnchorIds mint exactly once at hydration; copies do not
 * propagate identity. Copying from this body and pasting elsewhere
 * drops the mark cleanly.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import type { EditorHandle } from "@/components/Editor";
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
// L3f-2: the marked-range resolver now lives in one shared util consumed by
// this float, the linkedRange lift-overlay hooks, and the text-range-move
// drop spec — see src/lib/linked-anchor-range.ts.
import {
  blocksToRangeSlice,
  findLinkedAnchorRange,
  rangeSliceToBlocks,
} from "@/lib/linked-anchor-range";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { TextObjectFloatBodyProps } from "../types";

export function LinkedRangeBody({
  cardKey,
  id: anchorId,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;
  const floatId = `lrange:${anchorId}`;

  // Live range tracked across main transactions. Initialized once from
  // the current doc; re-derived if the mark vanishes and reappears.
  const rangeRef = useRef<{ from: number; to: number } | null>(null);

  const seed = useMemo(() => {
    if (!mainEditor) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        missing: true,
      };
    }
    const range = findLinkedAnchorRange(mainEditor.state.doc, anchorId);
    if (!range) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        missing: true,
      };
    }
    rangeRef.current = range;
    return { doc: sliceAsDoc(mainEditor.state.doc, range), missing: false };
    // Seed once on mount; thereafter useFloatMainSync drives main→float.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorId]);

  // Heading/figure callback refs proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the paragraph/list floats. Unlike
  // the paragraph float (whose doc holds only a paragraph), a text range can
  // hold a heading, list, or figure, so these are not purely inert — they let
  // an embedded heading's label-rename / heading-delete confirm resolve against
  // MAIN. `.current` is reassigned each render so the closures see the live
  // main handle.
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

  // Thread the real docId so figure/graphics atoms inside the range resolve and
  // render their actual image (read-only), like the list float (Issue-4) — the
  // paragraph float passes null because it can hold no figure.
  const docId = useDocWriteHandleOrNull()?.docId ?? null;
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;

  const floatEditor = useEditor({
    // FCU factory — the SAME stack as the main editor + every other prose float
    // (`surface: "float"` drops the doc-wide numberers / folding / main-only
    // chrome). This WIDENS the schema so a selection spanning lists / display
    // math / figures / examples round-trips faithfully; the prior hand-rolled
    // StarterKit subset dropped those node types → blank popout.
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
      // Heading/list title + heading structural writes inside the range proxy
      // to MAIN through this; the float's own onUpdate never fires from them,
      // so useFloatMainSync re-reads idempotently (no echo).
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: seed.doc,
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
    const r = rangeRef.current;
    if (!r) return;
    try {
      // Reconstruct the edited block nodes from the float doc — the same blocks
      // `rangeSliceToBlocks` produced for the seed, now carrying the user's
      // edit.
      const blocks: PMNode[] = [];
      for (const c of floatDoc.content ?? []) {
        try {
          blocks.push(ed.state.schema.nodeFromJSON(c));
        } catch {
          /* skip invalid children */
        }
      }
      if (blocks.length === 0) return;
      // Write back as the faithful INVERSE of the seed extraction: a Slice that
      // reuses the current cut's open depths (or unwraps a single inline
      // paragraph), so an unedited round-trip is byte-identical and an edited
      // one preserves the boundary paragraphs — no split, no extra wrapping
      // list. (`r.from`/`r.to` are TEXT-bounded, usually mid-paragraph;
      // replacing with fully-closed blocks via `replaceWith` was the L3f-7 bug.)
      const slice = blocksToRangeSlice(ed.state.doc, r, blocks);
      const tr = ed.state.tr.replace(r.from, r.to, slice);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (!tr.docChanged) return;
      ed.view.dispatch(tr);
      // Re-track the range to span the newly written content. `tr.replace`
      // grows the doc by `slice.size`, so the new content occupies
      // [from, from + slice.size) (the open ends merged into the boundaries).
      rangeRef.current = { from: r.from, to: r.from + slice.size };
    } catch {
      /* schema mismatch / stale range — swallow */
    }
  }

  // Track the range across main transactions: any non-float change in
  // the main doc may shift the range or invalidate it (mark vanished).
  // Re-derive from the live mark on every read for correctness.
  const readSource = useCallback(
    (doc: PMNode) => {
      const range = findLinkedAnchorRange(doc, anchorId);
      if (!range) {
        rangeRef.current = null;
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      rangeRef.current = range;
      return { doc: sliceAsDoc(doc, range), missing: false };
    },
    [anchorId],
  );

  const { sourceMissing } = useFloatMainSync({
    mainEditor,
    floatEditor,
    floatId,
    readSource,
  });

  // Released-float header label. Reflects the mark's TRUE nature via the ONE
  // `linkedRange.computeLabel` in the registry (the same source the
  // lift-overlay's popout-mode header reads, so the two can't drift): a
  // transient selection grab → "Text selection"; a real annotation's range →
  // null, so the chrome keeps the static "Linked range". Re-runs when the main
  // editor resolves.
  useEffect(() => {
    const label = mainEditor
      ? (TEXT_OBJECT_REGISTRY.linkedRange.computeLabel?.(mainEditor, {
          kind: "linkedRange",
          id: anchorId,
        }) ?? null)
      : null;
    setHeaderLabel(label);
    return () => setHeaderLabel(null);
  }, [mainEditor, anchorId, setHeaderLabel]);

  return (
    <>
      {sourceMissing ? (
        <SourceMissingBanner
          kind="linkedRange"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div
        className={`par-float-body flex-1 overflow-auto ${TEXT_FLOAT_BODY_PAD_CLASS} ${viewToggleClasses(chrome.menuBar)}`}
      >
        {/* No manual `.par-title-wrapper` here: the factory's paragraph
            NodeView now wraps each block itself (FCU), exactly like
            paragraph-body / list-body — a manual wrapper would double-nest. */}
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}

/**
 * Build a TipTap doc that wraps the main-doc slice at `[from, to)`. The
 * slice may carry partial-paragraph open depths; the shared
 * `rangeSliceToBlocks` unwraps an inline run into one paragraph and keeps a
 * multi-block range's blocks — the SAME transform the `text-range-move`
 * between-paragraphs drop uses (L3f-3), so the float and the move never
 * drift.
 */
function sliceAsDoc(
  doc: PMNode,
  range: { from: number; to: number },
): JSONContent {
  try {
    const blocks = rangeSliceToBlocks(
      doc.slice(range.from, range.to),
      doc.type.schema,
    );
    return { type: "doc", content: blocks.map((n) => n.toJSON() as JSONContent) };
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}
