"use client";

/**
 * Heading float body — TipTap embed rendering an entire section
 * (heading + every block under it, up to the next heading of equal or
 * higher rank). Edits round-trip back to the main doc's section range,
 * keyed by the heading's `uuid`.
 *
 * Migrated from the deleted `src/components/HeadingFloat.tsx`. The
 * outer FloatCard wrapper and header chrome now live in `FloatWindow` +
 * `FloatChrome`; this module is body-only. (The intermediate unified
 * `TextObjectFloat` that used to own them is itself deleted.)
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

import type { LabelRenameConfirm } from "@/lib/tiptap/label-rename";
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
import { useSpellcheckPortRef } from "@/lib/spell/spellcheck-context";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { getSectionRangeByUuid } from "@/lib/section-range";
import {
  useFloatMainSync,
  type SourceRange,
} from "@/lib/float-sync";
import { landFloatWrite, refuseWrite, wrongRootReason } from "@/lib/float-write-back";
import type { TextObjectFloatBodyProps } from "../types";
import {
  FLOAT_PROSE_EDITOR_CLASS,
  FloatBodyFrame,
  useRegistryHeaderLabel,
} from "./float-body-frame";

export function HeadingBody({
  cardKey,
  id: uuid,
  editorRef,
  setHeaderLabel,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
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

  // The chrome's level-dependent label ("Section", "Subsection", …) — the
  // registry's `heading.computeLabel`, the same one the lifted overlay's
  // popout-mode header reads, so the two can't drift (task 1346).
  useRegistryHeaderLabel("heading", uuid, mainEditor, setHeaderLabel);

  const floatId = `hd:${uuid}`;

  // Heading-label callbacks proxied to the MAIN editor's handle. The float
  // runs the same `createHeadingWithLabel` NodeView as main; these refs let
  // it consult main's own rename confirmation (read off
  // `editorRef.current`) and thread them into the factory's `callbacks`.
  // `.current` is reassigned each render (the standard ref-mirror pattern)
  // so the closures always see the live main handle. Defaults match what
  // the NodeView assumes when main's handle is briefly null.

  const onConfirmLabelRenameRef = useRef<LabelRenameConfirm | undefined>(undefined);
  onConfirmLabelRenameRef.current = (oldLabel, newLabel, refCount) =>
    ref.current?.onConfirmLabelRename(oldLabel, newLabel, refCount) ??
    Promise.resolve("confirm");

  const onConfirmHeadingDeleteRef = useRef<
    ((typeName: string) => Promise<boolean>) | undefined
  >(undefined);
  onConfirmHeadingDeleteRef.current = (typeName) =>
    ref.current?.onConfirmHeadingDelete(typeName) ?? Promise.resolve(true);

  const docId = useDocWriteHandleOrNull()?.docId ?? null;
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;

  const spellcheckPortRef = useSpellcheckPortRef();
  const floatEditor = useEditor({
    extensions: buildEditorExtensions({
      // Virgil's own spellchecker (task 518) — see `EditorExtensionsCtx`.
      spellcheckPortRef,
      surface: "float",
      editable: chrome.showHeadingFloatLabelEdit,
      cardContext: true,
      callbacks: {
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
          FLOAT_PROSE_EDITOR_CLASS,
      },
    },
    onUpdate({ editor }) {
      writeBackToMain(editor.getJSON());
    },
  });

  function writeBackToMain(doc: JSONContent) {
    // One door (task 1170): a refusal reaches `WriteRefusedBanner`, never a
    // bare return / swallowed catch. A section holds several blocks, so this
    // float binds no root; but it no longer filters out blocks that fail to
    // build either — writing the REST of the section while silently dropping
    // one block was the same loss in miniature. Any unbuildable block now
    // refuses the whole write.
    const outcome = landFloatWrite(ref.current?.getEditor(), floatId, (ed) => {
      // The live section range doubles as this write's position hint (task
      // 140), so the float→main direction stops re-scanning the doc's top
      // level on every float keystroke.
      const range = getSectionRangeByUuid(
        ed.state.doc,
        uuid,
        sourceRangeRef.current,
      );
      if (!range) return null;
      const incoming = doc.content ?? [];
      if (incoming.length === 0) return refuseWrite(wrongRootReason("section"));
      const newNodes: PMNode[] = incoming.map((j) =>
        ed.state.schema.nodeFromJSON(j),
      );
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
      return { from: range.start, to: range.end, content: newNodes };
    });
    reportWrite(outcome);
  }

  const readSource = useCallback(
    (doc: PMNode, hint: SourceRange | null) => {
      const range = getSectionRangeByUuid(doc, uuid, hint);
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
        // The WHOLE section, not just the heading: an edit to any block inside
        // it must re-read, and a heading inserted at either boundary (which
        // re-scopes the section) touches an endpoint.
        range: { from: range.start, to: range.end },
      };
    },
    [uuid],
  );

  const { sourceMissing, sourceRangeRef, writeRefusal, reportWrite } = useFloatMainSync({
    mainEditor,
    floatEditor,
    floatId,
    readSource,
  });

  return (
    <FloatBodyFrame
      cardKey={cardKey}
      sourceKind="section"
      sourceMissing={sourceMissing}
      writeRefusal={writeRefusal}
    >
      <EditorContent editor={floatEditor} />
    </FloatBodyFrame>
  );
}
