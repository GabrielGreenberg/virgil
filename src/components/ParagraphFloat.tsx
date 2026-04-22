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
 *  - No paragraph chrome (drag handle, gutter popout button). A
 *    plain Paragraph extension drives content; the title is rendered
 *    as a static label above the editor.
 *  - No block extensions (heading, list, blockquote, code block): a
 *    paragraph is one node, so Doc > Paragraph is the whole schema.
 */

import { type RefObject, useMemo } from "react";
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
} from "@/lib/tiptap-extensions";

import { FloatCard } from "./FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "./panel-primitives";
import type { EditorHandle } from "./Editor";

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
  const mainEditor = editorRef.current?.getEditor() ?? null;

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
    ],
    content: initial.doc,
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
            className="w-5 h-5 flex items-center justify-center rounded-md text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong transition-colors"
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
          {initial.title ? (
            <div className="par-title-annotation" style={{ cursor: "default" }}>
              <span className="par-title-text">{initial.title}</span>
            </div>
          ) : null}
          <EditorContent editor={floatEditor} />
        </div>
      </div>
    </FloatCard>
  );
}
