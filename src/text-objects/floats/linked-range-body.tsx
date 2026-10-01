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

import type { LabelRenameConfirm } from "@/lib/tiptap/label-rename";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useEditor,
  EditorContent,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { useSpellcheckPortRef } from "@/lib/spell/spellcheck-context";
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
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import {
  checkLinkedRangeRepresentable,
  describeLinkedRangeRefusal,
  linkedRangeAsDoc,
  planLinkedRangeWriteBack,
  type LinkedRangeRefusal,
} from "@/lib/linked-range-writeback";
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
    // No range write here: `useFloatMainSync` seeds (and thereafter tracks)
    // the live range itself on attach, and this memo runs during render —
    // before the hook exists.
    // A cut that cannot be taken seeds nothing — and the seed check below
    // refuses it, so an empty float can never write over the range.
    return {
      doc: linkedRangeAsDoc(mainEditor.state.doc, range),
      missing: false,
    };
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

  const onConfirmLabelRenameRef = useRef<LabelRenameConfirm | undefined>(undefined);
  onConfirmLabelRenameRef.current = (oldLabel, newLabel, refCount) =>
    ref.current?.onConfirmLabelRename(oldLabel, newLabel, refCount) ??
    Promise.resolve("confirm");

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

  const spellcheckPortRef = useSpellcheckPortRef();
  const floatEditor = useEditor({
    // FCU factory — the SAME stack as the main editor + every other prose float
    // (`surface: "float"` drops the doc-wide numberers / folding / main-only
    // chrome). This WIDENS the schema so a selection spanning lists / display
    // math / figures / examples round-trips faithfully; the prior hand-rolled
    // StarterKit subset dropped those node types → blank popout.
    extensions: buildEditorExtensions({
      // Virgil's own spellchecker (task 518) — see `EditorExtensionsCtx`.
      spellcheckPortRef,
      surface: "float",
      editable: true,
      cardContext: true,
      callbacks: {
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      docIdRef,
      // Heading/list title + heading structural writes inside the range proxy
      // to MAIN through this; the float's own onUpdate never fires from them,
      // so useFloatMainSync re-reads idempotently (no echo).
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: seed.doc ?? EMPTY_FLOAT_DOC,
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap ProseMirror prose prose-stone max-w-none focus:outline-none",
      },
    },
    onUpdate({ editor }) {
      writeBackToMain(editor);
    },
  });

  // Task 842 — the write door. A write-back REPLACES the whole range, so it
  // may only land when the float held everything it replaces and main can
  // rebuild every child it writes; otherwise it refuses (no dispatch) and the
  // body says so. `planLinkedRangeWriteBack` asks both schemas; this only
  // dispatches or reports.
  const [refusal, setRefusal] = useState<LinkedRangeRefusal | null>(null);

  // Takes the float editor from `onUpdate` itself rather than closing over
  // `floatEditor`, which is null on the render whose closure useEditor keeps.
  function writeBackToMain(floatEd: Editor) {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    // The shared tracker's live range IS this float's range — it is mapped
    // through every main transaction (task 140), so it stays correct even on
    // the transactions the source-touch gate now skips. A second, locally
    // maintained copy would silently drift the moment a skip happened.
    const r = sourceRangeRef.current;
    if (!r) return;
    let plan: ReturnType<typeof planLinkedRangeWriteBack>;
    try {
      plan = planLinkedRangeWriteBack(
        ed.state,
        r,
        floatEd.getJSON(),
        floatEd.schema,
      );
    } catch (err) {
      // A stale range (positions past the doc end) — nothing was written.
      console.warn("[linkedRange] write-back skipped — stale range", err);
      return;
    }
    if (!plan.ok) {
      reportRefusal(floatEd, plan);
      return;
    }
    if (!plan.tr) return;
    plan.tr.setMeta("addToHistory", false);
    plan.tr.setMeta(FLOAT_WRITE_META, floatId);
    ed.view.dispatch(plan.tr);
    // No range write here. `useMainTransactionSync` ran synchronously inside
    // the dispatch above and already mapped the range through this
    // transaction AND its appended ones. Restating the root-only arithmetic
    // (`{r.from, r.from + slice.size}`) would agree in the ordinary case and
    // CLOBBER the tracker whenever a plugin resized the region on top of our
    // write — which is exactly the case where the tracker is the only one
    // that knows.
  }

  function reportRefusal(floatEd: Editor, r: LinkedRangeRefusal) {
    console.warn(
      "[linkedRange] refused — the popout cannot represent this range; the " +
        "document was NOT modified.",
      { reason: r.reason, constructs: r.constructs, anchorId },
    );
    floatEd.setEditable(false);
    setRefusal((prev) => prev ?? r);
  }

  // Seed half of the door: a range the float schema cannot hold mounts BLANK
  // (TipTap swallows the mismatch), so say so up front and keep the float
  // read-only rather than wait for a keystroke the write door would refuse.
  useEffect(() => {
    if (!floatEditor || seed.missing) return;
    const held = checkLinkedRangeRepresentable(floatEditor.schema, seed.doc);
    if (!held.ok) reportRefusal(floatEditor, held);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatEditor, seed]);

  // Re-derive from the live mark whenever a transaction touched the range —
  // the mark's extent is the truth, and only it can tell us the run grew at a
  // boundary. The reported range re-arms the source-touch gate, so foreign
  // edits elsewhere in the doc no longer reach this walk at all. (No hint
  // fast-path: a marked run has no single node to resolve, so `findLinked-
  // AnchorRange` still scans — now only on transactions that touched us.)
  const readSource = useCallback(
    (doc: PMNode) => {
      const range = findLinkedAnchorRange(doc, anchorId);
      if (!range) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: linkedRangeAsDoc(doc, range) ?? EMPTY_FLOAT_DOC,
        missing: false,
        range,
      };
    },
    [anchorId],
  );

  const { sourceMissing, sourceRangeRef } = useFloatMainSync({
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
      {refusal && !sourceMissing ? <RefusalBanner refusal={refusal} /> : null}
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

const EMPTY_FLOAT_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/**
 * Stated beside the body, like `SourceMissingBanner`: the float is showing a
 * range it cannot represent, so it is read-only and nothing was written.
 */
function RefusalBanner({ refusal }: { refusal: LinkedRangeRefusal }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 h-6 text-[11px] bg-[var(--surface-warning,#fdf3d1)] border-b border-[var(--edge-warning,#e7d49a)] text-[var(--ink-warning,#7a5a16)]"
    >
      <span className="flex-1 truncate">
        This range holds {describeLinkedRangeRefusal(refusal)} the popout
        can&apos;t show — editing is off, nothing was changed.
      </span>
    </div>
  );
}
