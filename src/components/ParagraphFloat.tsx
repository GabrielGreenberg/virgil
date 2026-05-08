"use client";

/**
 * Floating paragraph editor.
 *
 * Opens from the gutter popout button on a paragraph in the main editor.
 * Hosts a dedicated Tiptap editor whose schema mirrors the main editor's
 * — same marks (linkedAnchor, latexCommandMark, etc.) and same inline
 * nodes (citation, inlineMath, footnote, …) — so content round-trips
 * losslessly. Write-back dispatches replaceWith against the paragraph
 * node in the main editor on every local edit, identified by uuid.
 *
 * Intentional omissions vs. the main editor:
 *  - No marginalia rendering or marginalia anchor guard (the float is
 *    a pure paragraph view; marginalia live in the main canvas).
 *  - No gutter popout button (the card header already has an X close
 *    button). The 6-dot drag handle and editable paragraph title DO
 *    appear, mirroring the main-editor chrome.
 *  - No block extensions (heading, list, blockquote, code block): a
 *    paragraph is one node, so Doc > Paragraph is the whole schema.
 */

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
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
import { autoSizeInput } from "@/lib/autoSizeInput";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import type { EditorHandle } from "./Editor";
import { useEditorChrome } from "./editor-layout/chrome-context";

export function ParagraphFloat({
  cardKey,
  uuid,
  editorRef,
}: {
  cardKey: string;
  uuid: string;
  editorRef: RefObject<EditorHandle | null>;
}) {
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = editorRef.current?.getEditor() ?? null;
  const [title, setTitle] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  // Initial content + title are read once from the main doc. The float
  // editor owns its own state after mount — changes flow float → main
  // via onUpdate. Main → float sync is out of scope for this pass
  // (the user typically isn't editing both at once).
  const initial = useMemo(() => {
    let paragraphContent: JSONContent[] = [];
    let title: string | null = null;
    if (mainEditor) {
      mainEditor.state.doc.descendants((node) => {
        if (node.type.name === "paragraph" && node.attrs?.uuid === uuid) {
          const json = node.toJSON() as JSONContent;
          paragraphContent = json.content ?? [];
          title = (node.attrs?.parTitle as string | null) ?? null;
          return false;
        }
        return true;
      });
    }
    return {
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: paragraphContent }],
      } as JSONContent,
      title,
    };
    // Intentionally keyed on uuid only — we don't want re-initialization
    // when the user types (mainEditor's state changes every keystroke).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  // Seed the editable title state once we've read the initial doc.
  useEffect(() => {
    setTitle(initial.title);
  }, [initial.title]);

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
        // Drop cursor isn't meaningful inside a single paragraph.
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
    content: initial.doc,
    editable: chrome.showParagraphFloatTitleEdit,
    immediatelyRender: false,
    editorProps: {
      // Same class stack the main editor uses on its contenteditable so
      // prose / prose-stone typography + the `.tiptap` selectors in
      // globals.css apply identically. Padding is trimmed to fit the
      // float; the font-size / line-height / color tokens are inherited
      // through `prose` + `--editor-*` custom props on the root.
      attributes: {
        class:
          "tiptap ProseMirror prose prose-stone max-w-none focus:outline-none",
      },
    },
    onUpdate({ editor }) {
      // Safe to always write: writeBackToMain re-reads the target
      // paragraph's attrs from the main doc and constructs a new
      // paragraph node carrying those attrs plus the float's inline
      // content. Transactions identical to the current main state are
      // dropped via the `tr.docChanged` check.
      writeBackToMain(editor.getJSON());
    },
  });

  function commitTitle(newTitle: string | null) {
    setTitle(newTitle);
    setEditingTitle(false);
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    let foundPos: number | null = null;
    let foundAttrs: Record<string, unknown> | null = null;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.attrs?.uuid === uuid) {
        foundPos = p;
        foundAttrs = { ...n.attrs };
        return false;
      }
      return true;
    });
    if (foundPos == null || foundAttrs == null) return;
    const tr = ed.state.tr.setNodeMarkup(
      foundPos,
      undefined,
      { ...(foundAttrs as Record<string, unknown>), parTitle: newTitle },
    );
    ed.view.dispatch(tr);
  }

  function writeBackToMain(doc: JSONContent) {
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    const firstPar = doc.content?.[0];
    if (!firstPar || firstPar.type !== "paragraph") return;
    // Find the paragraph by uuid — its position shifts as the doc
    // changes, so re-resolve on every write.
    let pos: number | null = null;
    let targetNode: NonNullable<ReturnType<typeof ed.state.doc.nodeAt>> | null = null;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.attrs?.uuid === uuid) {
        pos = p;
        targetNode = n;
        return false;
      }
      return true;
    });
    if (pos == null || !targetNode) return;
    const found: NonNullable<ReturnType<typeof ed.state.doc.nodeAt>> = targetNode;
    try {
      // Build a new paragraph node that carries the ORIGINAL attrs
      // (uuid, parTitle, …) and the float's inline content. Replacing
      // the whole paragraph with an explicitly-constructed node is the
      // only way I found to reliably preserve attrs — `replaceWith` on
      // the interior range was dropping them on some re-parse path.
      const fragment = (firstPar.content ?? []).map((c) =>
        ed.state.schema.nodeFromJSON(c),
      );
      const newPar = ed.state.schema.nodes.paragraph.create(
        found.attrs,
        fragment,
        found.marks,
      );
      const tr = ed.state.tr.replaceWith(
        pos,
        pos + found.nodeSize,
        newPar,
      );
      // Don't push the float's routine updates onto the main undo stack
      // — they'd make Cmd+Z in the main editor jump per-keystroke.
      tr.setMeta("addToHistory", false);
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      // Schema mismatch or stale uuid: swallow; the float may have been
      // opened for a paragraph that was since rebuilt.
    }
  }

  return (
    <FloatCard cardKey={cardKey}>
      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-md border border-edge-subtle overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-edge-subtle bg-[var(--header-bg,#e8e5de)] text-xs text-ink-subtle">
          <span className="truncate">Paragraph</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.scrollToParagraphId(uuid)}
            className="w-5 h-5 flex items-center justify-center rounded-md text-ink-muted hover:text-ink-body hover-on-light"
            title="Jump to paragraph"
            aria-label="Jump to paragraph"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun="paragraph"
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        <div className="par-float-body flex-1 overflow-auto px-8 py-4">
          <div
            className={`par-title-wrapper has-text par-float-paragraph${title ? " has-title" : " has-add-btn"}`}
          >
            <ParagraphFloatTitle
              title={title}
              editing={chrome.showParagraphFloatTitleEdit && editingTitle}
              onStartEdit={
                chrome.showParagraphFloatTitleEdit
                  ? () => setEditingTitle(true)
                  : () => {}
              }
              onCommit={commitTitle}
              onCancel={() => setEditingTitle(false)}
              onClear={
                chrome.showParagraphFloatTitleEdit
                  ? () => commitTitle(null)
                  : () => {}
              }
            />
            <div className="par-body-container">
              <EditorContent editor={floatEditor} />
              <div
                className="par-drag-handle"
                aria-hidden="true"
                title="Drag paragraph"
                draggable
                onMouseDown={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.stopPropagation();
                  const dt = e.dataTransfer;
                  if (!dt) return;
                  // Tag with paragraph-capture MIME so side panels (archive,
                  // cuts, etc.) and the main editor's drop handler can act
                  // on the source paragraph by uuid — same handshake the
                  // main editor's drag handle uses. Format is JSON so it
                  // matches usePanelCapture.onDrop's parser.
                  dt.setData(MIME_PAR_CAPTURE, JSON.stringify({ uuid }));
                  // Plain-text fallback so dropping into other apps yields
                  // the paragraph's text.
                  const text = floatEditor?.getText() ?? "";
                  if (text) dt.setData("text/plain", text);
                  dt.effectAllowed = "copyMove";
                  // Drag image: clone the float's paragraph DOM so the user
                  // sees the paragraph following the cursor.
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
                      try { document.body.removeChild(ghost); } catch {}
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

function ParagraphFloatTitle({
  title,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  onClear,
}: {
  title: string | null;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    const cleanup = autoSizeInput(input);
    input.focus();
    input.select();
    return cleanup;
  }, [editing]);

  if (editing) {
    return (
      <div className="par-title-annotation">
        <input
          ref={inputRef}
          type="text"
          className="par-title-input"
          defaultValue={title ?? ""}
          placeholder="Paragraph title…"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              const val = (e.target as HTMLInputElement).value.trim();
              onCommit(val || null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
            onCommit(val || null);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="par-title-annotation"
      onClick={onStartEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStartEdit();
        }
      }}
    >
      {title ? (
        <>
          <span className="par-title-text">{title}</span>
          <button
            type="button"
            className="par-title-delete"
            title="Remove title"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); }}
          >
            ×
          </button>
        </>
      ) : (
        <span className="par-title-add">+T</span>
      )}
    </div>
  );
}
