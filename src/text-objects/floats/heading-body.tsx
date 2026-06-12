"use client";

/**
 * Heading float body — TipTap embed rendering an entire section
 * (heading + every block under it, up to the next heading of equal or
 * higher rank). Edits round-trip back to the main doc's section range,
 * keyed by the heading's `uuid`.
 *
 * Migrated from the deleted `src/components/HeadingFloat.tsx`. The
 * outer FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Per-instance label: heading bodies override the static "Heading" via
 * `setHeaderLabel` based on the underlying node's level
 * ("Chapter" / "Section" / "Subsection" / …). Other bodies don't touch
 * the callback and inherit the static `meta.label`.
 *
 * Extension stack: built by the shared `buildEditorExtensions` factory
 * with `surface: "float"` (FCU Chip B) — the SAME chrome NodeViews as the
 * main editor, so the popped section faithfully renders its real section
 * number + "Section ▾ / label" chip + divider (they ride in via the
 * synced node attrs; the float omits the doc-wide numberer so it can't
 * renumber its lone section to "1"). Block atoms (`TexBlock`,
 * `FigureBlock`, `GraphicsBlock`) get `cardContext: true` — they render as
 * compact static previews; the user edits the atoms in the main doc.
 * Structural heading edits (label rename + `\ref` rewrite, numbered
 * toggle) proxy to the MAIN editor via `host.getMainEditor()`; the label
 * predicate / rename confirmation are the same ones main uses, read off
 * `editorRef.current`.
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
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { headingTypeName } from "@/lib/heading-types";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useFloatMainSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";

export function HeadingBody({
  cardKey,
  id: uuid,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let level = 1;
    const docContent: JSONContent[] = [];
    if (mainEditor) {
      const range = getSectionRangeByUuid(mainEditor.state.doc, uuid);
      if (range) {
        level = range.level;
        for (const n of range.nodes) {
          docContent.push(n.toJSON() as JSONContent);
        }
      } else {
        docContent.push({ type: "heading", attrs: { level: 1 }, content: [] });
      }
    } else {
      docContent.push({ type: "heading", attrs: { level: 1 }, content: [] });
    }
    return {
      doc: { type: "doc", content: docContent } as JSONContent,
      level,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  // Push the dynamic label up to the chrome on mount and whenever the
  // level changes. Clears on unmount so the chrome falls back to the
  // static `meta.label`.
  useEffect(() => {
    setHeaderLabel(headingTypeName(initial.level));
    return () => setHeaderLabel(null);
  }, [initial.level, setHeaderLabel]);

  const floatId = `hd:${uuid}`;

  // Heading-label callbacks proxied to the MAIN editor's handle. The float
  // runs the same `createHeadingWithLabel` NodeView as main; these refs let
  // it consult main's own label predicate / rename confirmation (read off
  // `editorRef.current`) and thread them into the factory's `callbacks`.
  // `.current` is reassigned each render (the standard ref-mirror pattern)
  // so the closures always see the live main handle. Defaults match what
  // the NodeView assumes when main's handle is briefly null.
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
      editable: chrome.showHeadingFloatLabelEdit,
      cardContext: true,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // Issue-4: thread the real docId so figure/graphics atoms resolve and
      // render their actual image (read-only) in the popped section instead of
      // a compact pill. Read by FigureBlockNodeView via extension.options.docIdRef.
      docIdRef,
      // Structural writes (label rename + `\ref` rewrite, numbered toggle,
      // level change) proxy to MAIN through this; the float's own doc is
      // never mutated by them, so useFloatMainSync re-reads idempotently.
      host: { getMainEditor: () => ref.current?.getEditor() ?? null },
    }),
    content: initial.doc,
    editable: chrome.showHeadingFloatLabelEdit,
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
    const range = getSectionRangeByUuid(ed.state.doc, uuid);
    if (!range) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return;
    try {
      const newNodes: PMNode[] = incoming
        .map((j) => {
          try {
            return ed.state.schema.nodeFromJSON(j);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as PMNode[];
      if (newNodes.length === 0) return;
      const sourceHeading = range.nodes[0];
      if (
        sourceHeading?.type.name === "heading" &&
        newNodes[0]?.type.name === "heading"
      ) {
        newNodes[0] = ed.state.schema.nodes.heading.create(
          {
            ...sourceHeading.attrs,
            level: newNodes[0].attrs.level ?? sourceHeading.attrs.level,
          },
          newNodes[0].content,
          newNodes[0].marks,
        );
      }
      const tr = ed.state.tr.replaceWith(range.start, range.end, newNodes);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      const range = getSectionRangeByUuid(doc, uuid);
      if (!range) {
        return {
          doc: {
            type: "doc",
            content: [{ type: "heading", attrs: { level: 1 }, content: [] }],
          } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: {
          type: "doc",
          content: range.nodes.map((n) => n.toJSON() as JSONContent),
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
          kind="section"
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
