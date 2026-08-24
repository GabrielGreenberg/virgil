"use client";

/**
 * Paragraph float body — TipTap embed mirroring the main editor's
 * paragraph schema. Edits round-trip to the source paragraph in the
 * main doc (identified by `uuid`) via `useFloatMainSync`.
 *
 * Migrated from the deleted `src/components/ParagraphFloat.tsx`. The
 * outer FloatCard wrapper and header chrome now live in `FloatWindow` +
 * `FloatChrome` — this module is body-only. (The intermediate unified
 * `TextObjectFloat` that used to own them is itself deleted.)
 *
 * Extension stack: built by the shared `buildEditorExtensions` factory
 * with `surface: "float"` (FCU Chip C1) — the SAME chrome NodeViews as the
 * main editor, so the popped paragraph's title is rendered by the very
 * same inline `+T` `ParagraphWithTitle` NodeView that main uses (no per-body
 * title UI; the retired `FloatTitleField` is gone for paragraphs). The
 * paragraph's `parTitle` rides in via the synced node attrs; the inline
 * `+T` write PROXIES to the MAIN editor via `host.getMainEditor()` (resolved
 * by uuid), so editing the title in the popout updates the source paragraph.
 * Colored text renders too (TextColor is now in the shared core).
 *
 * The float syncs the FULL paragraph node (attrs incl. `parTitle` + `uuid`),
 * not content-only, so the inline NodeView can read the title. Body-content
 * writes back to main rebuild the paragraph from main's own attrs, so a body
 * edit never clobbers the title (and vice-versa — the title write goes
 * straight to main and syncs back).
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
import { findSourceNodeByUuid } from "@/lib/float-source-range";
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
import type { TextObjectFloatBodyProps } from "../types";

export function ParagraphBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  // Seed once from main on mount: the FULL paragraph node (attrs incl.
  // `parTitle` + `uuid`), so the inline `+T` NodeView renders the title and
  // the title write can resolve the source paragraph by uuid. Thereafter
  // useFloatMainSync drives main→float and our onUpdate drives float→main.
  const initial = useMemo(() => {
    let paragraphNode: JSONContent | null = null;
    if (mainEditor) {
      const src = findSourceNodeByUuid(mainEditor.state.doc, uuid, "paragraph");
      if (src) paragraphNode = src.node.toJSON() as JSONContent;
    }
    return {
      doc: {
        type: "doc",
        content: [paragraphNode ?? { type: "paragraph", content: [] }],
      } as JSONContent,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const floatId = `par:${uuid}`;

  // Heading/figure callbacks proxied to the MAIN editor's handle, threaded
  // into the factory's `callbacks` exactly as the heading float (Chip B).
  // A paragraph float's doc holds only a paragraph, so the heading/figure
  // NodeViews never instantiate and these are inert — they're threaded for
  // parity with the factory contract and to stay structurally identical to
  // heading-body. `.current` is reassigned each render so the closures see
  // the live main handle.
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
      editable: chrome.showParagraphFloatTitleEdit,
      cardContext: true,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // cardContext figure/graphics previews render compact pills and don't
      // resolve images via docId; a paragraph float has none anyway (matches
      // the pre-FCU float, which passed no docId).
      docIdRef: null,
      // The inline `+T` title write proxies to MAIN through this; the float's
      // own doc is never mutated by it, so useFloatMainSync re-reads
      // idempotently.
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: initial.doc,
    editable: chrome.showParagraphFloatTitleEdit,
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
    const firstPar = doc.content?.[0];
    if (!firstPar || firstPar.type !== "paragraph") return;
    // The live source range doubles as this write's position hint, so the
    // float→main direction stops walking the doc on every float keystroke too.
    const src = findSourceNodeByUuid(
      ed.state.doc,
      uuid,
      "paragraph",
      sourceRangeRef.current,
    );
    if (!src) return;
    const pos = src.start;
    const found: PMNode = src.node;
    try {
      const fragment = (firstPar.content ?? []).map((c) =>
        ed.state.schema.nodeFromJSON(c),
      );
      // Rebuild from main's OWN attrs (which include `parTitle`), so a
      // body-content write never clobbers the title — the title is owned by
      // the inline `+T` write that targets main directly (see the NodeView's
      // float-mode setTitle in editor-extensions.ts).
      const newPar = ed.state.schema.nodes.paragraph.create(
        found.attrs,
        fragment,
        found.marks,
      );
      const tr = ed.state.tr.replaceWith(pos, pos + found.nodeSize, newPar);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode, hint: SourceRange | null) => {
      const src = findSourceNodeByUuid(doc, uuid, "paragraph", hint);
      if (!src) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      // Sync the FULL node (attrs incl. parTitle + uuid), so the inline `+T`
      // NodeView renders the current title.
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
          kind="paragraph"
          onClose={() => popped?.close(cardKey)}
        />
      ) : null}
      <div
        className={`par-float-body flex-1 overflow-auto ${TEXT_FLOAT_BODY_PAD_CLASS} ${viewToggleClasses(chrome.menuBar)}`}
      >
        <EditorContent editor={floatEditor} />
      </div>
    </>
  );
}
