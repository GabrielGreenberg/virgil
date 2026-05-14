"use client";

/**
 * Floating selection card.
 *
 * Spawned by the lift-off gesture on the SelectionDragHandle. Hosts a
 * dedicated Tiptap editor seeded with the captured selection content,
 * and stays hardwired to the source range in the main editor:
 *
 *  - Float → main: every keystroke in the float replaces the tracked
 *    range in the main doc.
 *  - Main → float: edits in the main editor (including those that
 *    shift the range without modifying its contents) propagate live;
 *    the tracked range is mapped through every main transaction.
 *  - Source missing: if the tracked range collapses (the source was
 *    deleted), a banner appears in the float and sync pauses. Undo in
 *    main can restore the source — the float doesn't dispose its range
 *    ref, so a recovery is automatic.
 *  - Dragging the float emits MIME_TEXT_CAPTURE carrying the *live*
 *    range so panel drops still hit the right place after edits.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import {
  InlineMath,
  Footnote,
  LatexComment,
  ArchiveMarker,
  Citation,
  LabelRef,
  LatexCommandMark,
  AiRequestMarker,
  LinkedAnchor,
  LinkedAnchorGuard,
  TabIndent,
} from "@/lib/tiptap-extensions";

import { FloatCard } from "./FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "./panel-primitives";
import { MIME_TEXT_CAPTURE } from "@/hooks/usePanelCapture";
import { getSelectionFloatData, updateSelectionFloatRange } from "./selection-floats";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import type { EditorHandle } from "./Editor";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FLOAT_WRITE_META, SourceMissingBanner, useFloatMainSync } from "@/lib/float-sync";

export function SelectionFloat({
  cardKey,
  selectionFloatId,
  editorRef,
}: {
  cardKey: string;
  selectionFloatId: string;
  editorRef: RefObject<EditorHandle | null>;
}) {
  const popped = usePoppedCards();
  const dragHandleMenu = useDragHandleMenu();
  const mainEditor = editorRef.current?.getEditor() ?? null;
  const floatId = `sel:${selectionFloatId}`;

  const seed = useMemo(() => {
    const data = getSelectionFloatData(selectionFloatId);
    if (!data) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        range: null as null | { from: number; to: number },
        paragraphId: null as null | string,
        text: "",
      };
    }
    return {
      doc: data.contentJson,
      range: data.range,
      paragraphId: data.paragraphId,
      text: data.text,
    };
  }, [selectionFloatId]);

  // Live range — kept in sync with main via the transaction handler
  // below. Initialised from the seed captured at lift time.
  const rangeRef = useRef<{ from: number; to: number } | null>(seed.range);

  // Selection floats are ephemeral — their data lives in an in-memory
  // registry only. If we mount and find no backing data, the popped-cards
  // state was rehydrated from localStorage but the registry is empty
  // (page reload). Auto-close so the user isn't stuck with a blank float.
  //
  // Important: do NOT dispose the registry entry on unmount. React Strict
  // Mode double-mounts in dev would otherwise dispose between mount A's
  // cleanup and mount B's auto-close check, causing legitimate floats to
  // self-close immediately after spawning.
  useEffect(() => {
    if (!getSelectionFloatData(selectionFloatId) && popped) {
      popped.close(cardKey);
    }
  }, [selectionFloatId, cardKey, popped]);

  // Range tracking — registered BEFORE useFloatMainSync attaches its own
  // listener so by the time the content-sync handler reads rangeRef it
  // sees the already-updated range. Skips this float's own write-backs
  // (which manage the range themselves to match the new content size).
  useEffect(() => {
    if (!mainEditor) return;
    const handler = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (transaction.getMeta(FLOAT_WRITE_META) === floatId) return;
      if (!transaction.docChanged) return;
      const r = rangeRef.current;
      if (!r) return;
      // Bias choice: from prefers right of an insert at boundary, to
      // prefers left. This is a "closed window" — text typed exactly at
      // either boundary stays OUTSIDE the tracked range so the float
      // doesn't swallow unrelated typing.
      const newFrom = transaction.mapping.map(r.from, 1);
      const newTo = transaction.mapping.map(r.to, -1);
      if (newFrom >= newTo) {
        // Range collapsed — leave rangeRef as-is so that if an undo
        // restores the source content the next mapping reopens it.
        // useFloatMainSync's readSource will report missing.
        return;
      }
      rangeRef.current = { from: newFrom, to: newTo };
      updateSelectionFloatRange(selectionFloatId, rangeRef.current);
    };
    mainEditor.on("transaction", handler);
    return () => {
      mainEditor.off("transaction", handler);
    };
  }, [mainEditor, floatId]);

  const floatEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        listItem: false,
        dropcursor: false,
      }),
      Highlight.configure({ multicolor: true }),
      InlineMath,
      Footnote,
      LatexComment,
      ArchiveMarker,
      Citation,
      LabelRef,
      LatexCommandMark,
      AiRequestMarker,
      LinkedAnchor,
      LinkedAnchorGuard,
      TabIndent,
    ],
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
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    if (!rangeRef.current) return;
    const firstPar = floatDoc.content?.[0];
    if (!firstPar || firstPar.type !== "paragraph") return;
    const inlineJsons = firstPar.content ?? [];
    try {
      const inlineNodes: PMNode[] = inlineJsons
        .map((j) => {
          try {
            return ed.state.schema.nodeFromJSON(j);
          } catch {
            return null;
          }
        })
        .filter((n): n is PMNode => n != null);
      const { from, to } = rangeRef.current;
      const tr =
        inlineNodes.length > 0
          ? ed.state.tr.replaceWith(from, to, inlineNodes)
          : ed.state.tr.delete(from, to);
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, floatId);
      if (!tr.docChanged) return;
      ed.view.dispatch(tr);
      // Reflect the new content size so subsequent writes target the
      // right span.
      const newSize = inlineNodes.reduce((acc, n) => acc + n.nodeSize, 0);
      rangeRef.current = { from, to: from + newSize };
      updateSelectionFloatRange(selectionFloatId, rangeRef.current);
    } catch {
      /* schema mismatch / stale range — swallow */
    }
  }

  const readSource = useCallback(
    (doc: PMNode) => {
      const r = rangeRef.current;
      const emptyDoc = {
        type: "doc",
        content: [{ type: "paragraph" }],
      } as JSONContent;
      if (!r) return { doc: emptyDoc, missing: true };
      const docSize = doc.content.size;
      if (r.from < 0 || r.to > docSize || r.from >= r.to) {
        return { doc: emptyDoc, missing: true };
      }
      try {
        const slice = doc.slice(r.from, r.to);
        const inline = slice.content.toJSON();
        if (!inline || (Array.isArray(inline) && inline.length === 0)) {
          return { doc: emptyDoc, missing: true };
        }
        return {
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: Array.isArray(inline) ? inline : [inline],
              },
            ],
          } as JSONContent,
          missing: false,
        };
      } catch {
        return { doc: emptyDoc, missing: true };
      }
    },
    [],
  );

  const { sourceMissing } = useFloatMainSync({
    mainEditor,
    floatEditor,
    floatId,
    readSource,
  });

  return (
    <FloatCard cardKey={cardKey} surface="card">
      <div className="flex-1 min-h-0 flex flex-col bg-surface overflow-hidden">
        <div className="flex items-center gap-1 px-2 h-6 border-b border-edge-subtle bg-[var(--surface-muted-strong)]">
          <span className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate">
            Selection
          </span>
          <span className="flex-1" />
          {seed.paragraphId ? (
            <button
              type="button"
              onClick={() =>
                editorRef.current?.scrollToParagraphId(seed.paragraphId!)
              }
              className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
              title="Jump to source paragraph"
              aria-label="Jump to source paragraph"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          ) : null}
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun="selection"
            className="iconbtn-xs"
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        {sourceMissing ? (
          <SourceMissingBanner kind="selection" onClose={() => popped?.close(cardKey)} />
        ) : null}
        <div className="par-float-body flex-1 overflow-auto px-8 py-4">
          <div className="par-title-wrapper has-text par-float-paragraph">
            <div className="par-body-container">
              <EditorContent editor={floatEditor} />
              <div
                className="par-drag-handle"
                aria-hidden="true"
                title="Drag selection or click for actions"
                draggable
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const live = rangeRef.current;
                  if (!live || !seed.paragraphId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  dragHandleMenu?.open(
                    {
                      kind: "selection",
                      paragraphId: seed.paragraphId,
                      from: live.from,
                      to: live.to,
                    },
                    rect,
                  );
                }}
                onDragStart={(e) => {
                  e.stopPropagation();
                  const dt = e.dataTransfer;
                  if (!dt) return;
                  const live = rangeRef.current;
                  if (!live) return;
                  // MIME_TEXT_CAPTURE payload matches usePanelCapture.onDrop's
                  // parser — drops the *live* selection range out of the
                  // main editor and into the receiving panel.
                  dt.setData(
                    MIME_TEXT_CAPTURE,
                    JSON.stringify({
                      from: live.from,
                      to: live.to,
                      paragraphId: seed.paragraphId,
                    }),
                  );
                  if (seed.text) dt.setData("text/plain", seed.text);
                  dt.effectAllowed = "copyMove";
                  // Drag image: clone the float's paragraph DOM.
                  const pmEl = floatEditor?.view?.dom?.querySelector("p");
                  if (pmEl) {
                    const ghost = pmEl.cloneNode(true) as HTMLElement;
                    const cs = window.getComputedStyle(pmEl);
                    const w = (pmEl as HTMLElement).offsetWidth;
                    ghost.style.cssText =
                      "position:absolute;top:-9999px;left:-9999px;" +
                      (w > 0 ? `width:${w}px;` : "max-width:520px;") +
                      "opacity:0.5;margin:0;padding:0;background:transparent;" +
                      `color:${cs.color};` +
                      `font-family:${cs.fontFamily};` +
                      `font-size:${cs.fontSize};` +
                      `font-weight:${cs.fontWeight};` +
                      `font-style:${cs.fontStyle};` +
                      `line-height:${cs.lineHeight};` +
                      `letter-spacing:${cs.letterSpacing};` +
                      "pointer-events:none;";
                    document.body.appendChild(ghost);
                    dt.setDragImage(ghost, 12, 12);
                    requestAnimationFrame(() => {
                      try {
                        document.body.removeChild(ghost);
                      } catch {}
                    });
                  }
                }}
              >
                <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                  <circle cx="3" cy="2" r="1.2" />
                  <circle cx="7" cy="2" r="1.2" />
                  <circle cx="3" cy="7" r="1.2" />
                  <circle cx="7" cy="7" r="1.2" />
                  <circle cx="3" cy="12" r="1.2" />
                  <circle cx="7" cy="12" r="1.2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </FloatCard>
  );
}
