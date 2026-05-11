"use client";

/**
 * Floating selection card.
 *
 * Spawned by the lift-off gesture on the SelectionDragHandle. Hosts a
 * dedicated Tiptap editor seeded with the captured selection content.
 *
 * Semantics for this pass:
 *  - The source selection remains in the main doc; no extraction on lift.
 *  - Edits inside the float DO NOT write back to the main editor — the
 *    float is a scratch surface (the source range is volatile and a
 *    robust write-back protocol would be a much larger feature).
 *  - The drag-handle on the float emits `MIME_TEXT_CAPTURE` carrying the
 *    captured range, so dropping the float on a side panel (archive,
 *    notes, …) extracts the selection from the main doc via the
 *    existing `usePanelCapture` flow.
 */

import { type RefObject, useEffect, useMemo } from "react";
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
import { getSelectionFloatData } from "./selection-floats";
import type { EditorHandle } from "./Editor";

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

  // Selection floats are ephemeral — their data lives in an in-memory
  // registry only. If we mount and find no backing data, the popped-cards
  // state was rehydrated from localStorage but the registry is empty
  // (page reload). Auto-close so the user isn't stuck with a blank float.
  //
  // Important: do NOT dispose the registry entry on unmount. React Strict
  // Mode double-mounts in dev would otherwise dispose between mount A's
  // cleanup and mount B's auto-close check, causing legitimate floats to
  // self-close immediately after spawning. The registry is in-memory only
  // (a few entries per session, cleared on reload), so leaking the entries
  // is acceptable.
  useEffect(() => {
    if (!getSelectionFloatData(selectionFloatId) && popped) {
      popped.close(cardKey);
    }
  }, [selectionFloatId, cardKey, popped]);

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
  });

  return (
    <FloatCard cardKey={cardKey}>
      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-md border border-edge-subtle overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-edge-subtle bg-[var(--header-bg,#e8e5de)] text-xs text-ink-subtle">
          <span className="truncate">Selection</span>
          <span className="flex-1" />
          {seed.paragraphId ? (
            <button
              type="button"
              onClick={() =>
                editorRef.current?.scrollToParagraphId(seed.paragraphId!)
              }
              className="w-5 h-5 flex items-center justify-center rounded-md text-ink-muted hover:text-ink-body hover-on-light"
              title="Jump to source paragraph"
              aria-label="Jump to source paragraph"
            >
              <svg
                width="12"
                height="12"
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
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        <div className="par-float-body flex-1 overflow-auto px-8 py-4">
          <div className="par-title-wrapper has-text par-float-paragraph">
            <div className="par-body-container">
              <EditorContent editor={floatEditor} />
              <div
                className="par-drag-handle"
                aria-hidden="true"
                title="Drag selection"
                draggable
                onMouseDown={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.stopPropagation();
                  const dt = e.dataTransfer;
                  if (!dt) return;
                  if (!seed.range) return;
                  // MIME_TEXT_CAPTURE payload matches usePanelCapture.onDrop's
                  // parser — drops the *original* selection range out of the
                  // main editor and into the receiving panel.
                  dt.setData(
                    MIME_TEXT_CAPTURE,
                    JSON.stringify({
                      from: seed.range.from,
                      to: seed.range.to,
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
