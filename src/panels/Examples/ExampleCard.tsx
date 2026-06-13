"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useEditor,
  EditorContent,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ExampleInfo, EditorHandle } from "@/components/Editor";
import {
  CardEmptyText,
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { BorrowedMainText } from "@/components/BorrowedMainText";
import { useEditorRefContextOrNull } from "@/components/editor-layout/contexts/editor-ref";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { useExampleContentRevision } from "@/lib/tiptap/doc-structure";
import { useMainEditable } from "@/components/editor-layout/contexts/editor-ref";
import { useDocWriteHandleOrNull } from "@/components/editor-layout/DocPipeline";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

export interface ExampleCardProps {
  example: ExampleInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  /** Extra `data-*` attributes forwarded onto the card root. Omni-view
   *  uses this to attach `data-omni-entry` directly on the card so the
   *  global `[data-omni-entry] > :first-child { border-radius: inherit }`
   *  rule inherits from the card's own `rounded-lg` (rather than from
   *  an outer wrapper with no radius, which would zero out the corners). */
  extraDataAttrs?: Record<string, string>;
}

// ── Source resolution (shared with example-block-body.tsx) ─────────────
// Find the live `exampleBlock` in the main doc by uuid. Early-bails once
// found; worst-case O(doc), so callers MUST NOT run it per keystroke (the
// card re-seeds only on the `rev.examples` structural counter, below).
function findExampleBlockByUuid(
  doc: PMNode,
  uuid: string,
): { start: number; end: number; node: PMNode } | null {
  let result: { start: number; end: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === "exampleBlock" && node.attrs?.uuid === uuid) {
      result = { start: pos, end: pos + node.nodeSize, node };
      return false;
    }
    return true;
  });
  return result;
}

const EMPTY_BLOCK: JSONContent = {
  type: "exampleBlock",
  content: [
    {
      type: "exampleItemList",
      content: [
        {
          type: "exampleItem",
          content: [{ type: "paragraph", content: [] }],
        },
      ],
    },
  ],
};

/**
 * The directly-editable expex body for an example card (#32 / #33). Mounts
 * the SAME `buildEditorExtensions({ surface: "float" })` stack the in-editor
 * example float (`text-objects/floats/example-block-body.tsx`) uses, seeded
 * from the live `exampleBlock` JSON. The number `(N)` and sub-item markers
 * `a./b./c.` ride in via the synced node attrs and render through the real
 * `ExampleBlock` / `ExampleItem` NodeViews + expex CSS grid — so the card
 * renders IDENTICALLY to main text (no hand-built mono span, no flex row).
 * Glosses + nested xlists round-trip because the WHOLE block JSON is seeded
 * and written back (the old `BorrowedMainText` projection dropped them).
 *
 * KEYSTROKE SANCTITY: this does NOT subscribe to the main editor's per-
 * transaction stream (that would do O(doc) `findExampleBlockByUuid` work per
 * keystroke, fanned out across every open card). Instead it re-seeds from the
 * main doc only when the `rev.examples` STRUCTURAL counter bumps — i.e. an
 * example was added / removed / structurally changed (`onExamplesRecomputable`).
 * A plain keystroke inside an unrelated paragraph fires no example structural
 * event → no re-seed → no per-card doc walk. Own write-backs are tagged with
 * `FLOAT_WRITE_META`; we skip the immediate echo re-seed they would trigger by
 * comparing serialized JSON before pushing.
 */
function ExampleCardEditor({
  exampleId,
  mainEditor,
  editorRef,
  bodyStyle,
}: {
  exampleId: string;
  mainEditor: Editor | null;
  editorRef: React.RefObject<EditorHandle | null>;
  bodyStyle: React.CSSProperties;
}) {
  const rev = useStructuralRevisions(mainEditor);
  // Per-uuid content signal (#39 nit 1): bumps ONLY when THIS example's
  // interior content changed in the MAIN editor — so a content-only edit
  // (no add/remove → `rev.examples` stays flat) still re-seeds this card,
  // and never re-seeds a sibling example's card.
  const contentRev = useExampleContentRevision(mainEditor, exampleId);
  // Read-only gate (#39 nit 2): on a read-only / partner-claimed doc the
  // main editor's `data-editable` is "false". Mirror it onto the embedded
  // editor so the card shows read-only content instead of accepting phantom
  // typing whose write-back the readOnlyEnforcer would silently reject.
  const mainEditable = useMainEditable(mainEditor);

  // Heading/label callbacks proxied to the MAIN handle, exactly as the
  // example float does — an example doc holds only an exampleBlock so the
  // heading NodeView never instantiates and these stay inert, but they're
  // threaded for parity with the factory contract. `.current` is reassigned
  // each render so the closures see the live main handle.
  const isLabelTakenRef = useRef<
    ((candidate: string, excludeLabel: string | null) => boolean) | undefined
  >(undefined);
  isLabelTakenRef.current = (candidate, excludeLabel) =>
    editorRef.current?.isLabelTaken(candidate, excludeLabel) ?? false;

  const onConfirmLabelRenameRef = useRef<
    | ((oldLabel: string, newLabel: string, refCount: number) => Promise<boolean>)
    | undefined
  >(undefined);
  onConfirmLabelRenameRef.current = (oldLabel, newLabel, refCount) =>
    editorRef.current?.onConfirmLabelRename(oldLabel, newLabel, refCount) ??
    Promise.resolve(false);

  const onConfirmHeadingDeleteRef = useRef<
    ((typeName: string) => Promise<boolean>) | undefined
  >(undefined);
  onConfirmHeadingDeleteRef.current = (typeName) =>
    editorRef.current?.onConfirmHeadingDelete(typeName) ?? Promise.resolve(true);

  // Seed once at mount from the live block (recomputed only when the editor
  // identity or example id changes — content re-seeds ride the rev counter).
  const initialDoc = useMemo<JSONContent>(() => {
    let blockJson: JSONContent | null = null;
    if (mainEditor) {
      const src = findExampleBlockByUuid(mainEditor.state.doc, exampleId);
      if (src) blockJson = src.node.toJSON() as JSONContent;
    }
    return { type: "doc", content: [blockJson ?? EMPTY_BLOCK] };
  }, [exampleId, mainEditor]);

  const floatId = `example-card:${exampleId}`;

  function writeBackToMain(doc: JSONContent) {
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    const src = findExampleBlockByUuid(ed.state.doc, exampleId);
    if (!src) return;
    const incoming = doc.content ?? [];
    const first = incoming[0];
    if (!first || first.type !== "exampleBlock") return;
    try {
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
      /* schema mismatch / stale uuid — swallow (parity with the float) */
    }
  }

  // Doc-id mirror (#39 nit 3): thread the real docId so figure/graphics atoms
  // nested in an example resolve + render their actual image (read-only)
  // instead of a compact pill — parity with the example float, which threads
  // it at example-block-body.tsx (`useDocWriteHandleOrNull()?.docId`). Read
  // each render so a doc swap is seen; null in bare/no-pipeline contexts.
  const docId = useDocWriteHandleOrNull()?.docId ?? null;
  const docIdRef = useRef<string | null>(docId);
  docIdRef.current = docId;

  const editor = useEditor({
    extensions: buildEditorExtensions({
      surface: "float",
      editable: mainEditable,
      cardContext: true,
      docIdRef,
      callbacks: {
        isLabelTaken: isLabelTakenRef,
        onConfirmLabelRename: onConfirmLabelRenameRef,
        onConfirmHeadingDelete: onConfirmHeadingDeleteRef,
      },
      // The card omits ExpexNumbering (surface: "float"), so the example
      // number + sub-item letters ride in via the synced node attrs and
      // render through the real NodeViews — never renumbered to (1).
      host: { getMainEditor: () => editorRef.current?.getEditor() ?? null },
    }),
    content: initialDoc,
    editable: mainEditable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap ProseMirror example-card-editor max-w-none focus:outline-none",
      },
    },
    onUpdate({ editor: ed }) {
      writeBackToMain(ed.getJSON());
    },
  });

  // Keep the embedded editor's editability in lock-step with the main doc's,
  // in case read-only mode toggles after mount (collab pen handoff).
  useEffect(() => {
    if (editor && editor.isEditable !== mainEditable) {
      editor.setEditable(mainEditable);
    }
  }, [editor, mainEditable]);

  // ── Main → card re-seed, gated on structural + content example signals ──
  // Re-seed from the live block when EITHER `rev.examples` bumps (an example
  // was added / removed / structurally changed, including our OWN write-back
  // which surfaces as `onExamplesRecomputable`) OR `contentRev` bumps (a
  // content-only edit to THIS example was made in the main editor — the #39
  // staleness fix). We compare serialized JSON so an echo of our own edit —
  // or a re-derivation with no content change — is a no-op (no cursor reset).
  // This is NOT a per-transaction subscriber: a structurally-null keystroke
  // in a non-example paragraph fires neither signal, so this effect never
  // runs; a content edit inside example A bumps only A's `contentRev`, so
  // only card A re-seeds — card B (a different uuid) never fires.
  const lastSyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !mainEditor) return;
    const src = findExampleBlockByUuid(mainEditor.state.doc, exampleId);
    if (!src) return; // block gone — leave last content; close drops it cleanly
    const nextDoc: JSONContent = {
      type: "doc",
      content: [src.node.toJSON() as JSONContent],
    };
    const nextJson = JSON.stringify(nextDoc);
    if (lastSyncedRef.current === null) {
      // Initial content was set at mount via `content: initialDoc`.
      lastSyncedRef.current = nextJson;
      return;
    }
    if (lastSyncedRef.current === nextJson) return;
    if (JSON.stringify(editor.getJSON()) === nextJson) {
      lastSyncedRef.current = nextJson;
      return;
    }
    lastSyncedRef.current = nextJson;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(nextDoc, { emitUpdate: false });
    const size = editor.state.doc.content.size;
    try {
      editor.commands.setTextSelection({
        from: Math.min(Math.max(from, 0), size),
        to: Math.min(Math.max(to, 0), size),
      });
    } catch {
      /* selection target may be invalid post-reset; OK */
    }
  }, [editor, mainEditor, exampleId, rev.examples, contentRev]);

  // Panel typography onto the editor DOM, the way BorrowedMainText /
  // RichTextField do (so the panel's borrowed font-size + a stepper override
  // take effect instead of the global 1.05rem fallback).
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const fontFamily = bodyStyle?.fontFamily;
    const fontSize = bodyStyle?.fontSize;
    const color = bodyStyle?.color;
    /* eslint-disable react-hooks/immutability */
    if (fontFamily) dom.style.fontFamily = String(fontFamily);
    else dom.style.removeProperty("font-family");
    if (fontSize) {
      dom.style.fontSize = String(fontSize);
      dom.style.setProperty("--editor-font-size", String(fontSize));
    } else {
      dom.style.removeProperty("font-size");
      dom.style.removeProperty("--editor-font-size");
    }
    if (color) dom.style.color = String(color);
    else dom.style.removeProperty("color");
    /* eslint-enable react-hooks/immutability */
  }, [editor, bodyStyle]);

  return <EditorContent editor={editor} />;
}

/** Panel card for a single `\ex` / `\pex` block. The body mounts the real
 *  expex editor (directly editable, identical to main text) when an editor
 *  context is available; in bare contexts (tests / no provider) it falls
 *  back to a read-only projection. A footer exposes a "?" help popover. */
export function ExampleCard({
  example,
  isSelected,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: ExampleCardProps) {
  const theme = useCardTheme("example");
  const bodyStyle = usePanelBodyStyle("example");
  const popped = usePoppedCards();
  const cardKey = popKey("examples", example.exampleId);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "example", id: example.exampleId });
  const isExpanded = ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();

  const [showHelp, setShowHelp] = useState(false);

  // The directly-editable expex body needs the main editor (to seed + write
  // back). Self-sourced from context so the card body is identical in every
  // host (panel / omni / float) — no per-host `onUpdateLatex` threading. In a
  // bare mount (the unit test, a no-provider preview) the context is null and
  // we render the read-only projection fallback below.
  const editorCtx = useEditorRefContextOrNull();
  const mainEditor = editorCtx?.editorInstance ?? null;
  const editorRef = editorCtx?.editorRef ?? null;
  const canEdit = !!editorRef;

  const card = (
    <PanelCard
      theme={theme}
      selected={isHaloed}
      onClick={(e) => {
        ac.onActivate();
        onSelect();
        onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      data-link-card={`example:${example.exampleId}`}
      {...(extraDataAttrs ?? {})}
      kind="example"
      canJump
      onJump={(e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
    >
      {compressed ? (
        <div className="px-3 py-1.5 text-ink-body">
          <div style={{ fontFamily: "var(--font-serif), Georgia, serif", ...bodyStyle, ...compressedBodyStyle(compressedLines) }}>
            <span
              className="font-mono mr-2"
              style={{ color: theme.titleColor }}
            >
              ({example.number || "?"})
            </span>
            {(() => {
              const text = example.bodyText || example.items[0]?.text || "";
              const trimmed = text.replace(/\s+/g, " ").trim();
              if (trimmed) return trimmed;
              return <CardEmptyText />;
            })()}
          </div>
        </div>
      ) : (
      <>
      {/* ── Body — the real expex editor (directly editable) ──────── */}
      <div
        className="px-3 py-2 text-ink-body example-card-body"
        style={{ fontFamily: "var(--font-serif), Georgia, serif", ...bodyStyle }}
        onClick={(e) => {
          // Keep clicks inside the editor from activating / jumping the card.
          if (canEdit) e.stopPropagation();
        }}
      >
        {canEdit ? (
          <ExampleCardEditor
            exampleId={example.exampleId}
            mainEditor={mainEditor}
            editorRef={editorRef}
            bodyStyle={bodyStyle}
          />
        ) : example.bodyContent || example.items.length > 0 ? (
          // Read-only fallback (no editor context — tests / no provider).
          <div className="flex gap-2">
            <span className="font-mono shrink-0" style={{ color: theme.titleColor }}>
              ({example.number || "?"})
            </span>
            <div className="min-w-0 flex-1">
              {example.bodyContent ? (
                <BorrowedMainText
                  value={example.bodyContent}
                  instanceKey={`example-body:${example.exampleId}`}
                  variant="footnote"
                  className="leading-snug break-words"
                  bodyStyle={bodyStyle}
                />
              ) : (
                example.bodyText && (
                  <div className="leading-snug whitespace-pre-wrap break-words">
                    {example.bodyText}
                  </div>
                )
              )}
              {example.items.length > 0 && (
                <ol className="list-none m-0 p-0 mt-1 flex flex-col gap-0.5">
                  {example.items.map((it, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="shrink-0" style={{ minWidth: "1.25rem", color: theme.titleColor }}>
                        {it.subLabel || (idx + 1)}.
                      </span>
                      <div className="min-w-0 flex-1">
                        {it.content ? (
                          <BorrowedMainText
                            value={it.content}
                            instanceKey={`example-item:${example.exampleId}:${idx}`}
                            variant="footnote"
                            className="leading-snug break-words"
                            bodyStyle={bodyStyle}
                          />
                        ) : (
                          <span className="leading-snug whitespace-pre-wrap break-words">
                            {it.text || <CardEmptyText />}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : example.bodyText ? (
          <div className="flex gap-2">
            <span className="font-mono shrink-0" style={{ color: theme.titleColor }}>
              ({example.number || "?"})
            </span>
            <div className="leading-snug whitespace-pre-wrap break-words min-w-0 flex-1">
              {example.bodyText}
            </div>
          </div>
        ) : (
          <CardEmptyText label="Empty example" />
        )}
      </div>

      {/* ── Footer: Help ─────────────────────────────────────────── */}
      <div
        className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
      />
      <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-muted/30">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowHelp((v) => !v);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover-on-light hover:border-edge-hover flex-shrink-0 font-semibold"
          data-hint={showHelp ? "Hide help" : "Help"}
          data-hint-pos="above"
        >
          ?
        </button>
        <div className="flex-1" />
      </div>

      {/* ── Help panel: brief expex explainer ────────────────────── */}
      {showHelp && (
        <>
          <div
            className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
          />
          <div
            className="px-3 py-2 text-[11px] leading-snug text-ink-body bg-amber-50/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1">
              <span className="font-mono">\expex</span> renders numbered linguistic examples.
            </p>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              <li>
                <span className="font-mono">\ex … \xe</span> — a single numbered example.
              </li>
              <li>
                <span className="font-mono">\pex … \xe</span> — a multi-part example;
                use <span className="font-mono">\a</span> to introduce each sub-item
                (auto-labeled <span className="font-mono">a, b, c…</span>).
              </li>
              <li>
                <span className="font-mono">\label{"{"}name{"}"}</span> on either the
                top block or a <span className="font-mono">\a</span> item makes it
                referenceable with <span className="font-mono">\ref{"{"}name{"}"}</span>.
              </li>
              <li>
                <span className="font-mono">{"<tag>"}</span> right after
                <span className="font-mono"> \ex</span> /
                <span className="font-mono"> \a</span> sets a custom display tag
                (e.g. <span className="font-mono">\ex{"<*>"}</span> for an
                ungrammatical example).
              </li>
              <li>
                <span className="font-mono">\begingl … \endgl</span> with
                <span className="font-mono"> \gla / \glb / \glc</span> rows and a
                <span className="font-mono"> \glft</span> free-translation row
                produces an interlinear gloss.
              </li>
            </ul>
          </div>
        </>
      )}
      </>
      )}
    </PanelCard>
  );
  // Pop residue (#21): the docked card stays fully live while a float for
  // the same example is open — no self-suppression (that pattern was
  // removed everywhere in ba90bd9; this card had drifted back).
  return card;
}
