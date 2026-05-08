"use client";

/**
 * Floating section editor.
 *
 * Counterpart of ParagraphFloat for headings (chapters/sections/etc.).
 * Opens from the gutter popout button on a heading in the main editor.
 * Renders the WHOLE section — heading plus every block under it up to
 * the next heading of equal or higher rank — in a dedicated Tiptap
 * editor. Edits round-trip back to the main editor's section range,
 * keyed by the heading's uuid.
 *
 * The float uses StarterKit with all block types enabled (paragraphs,
 * lists, blockquotes, sub-headings, code blocks, horizontal rules) so
 * it can host arbitrary section content. Inline atoms (citations,
 * footnotes, math, …) come from the same extensions ParagraphFloat
 * uses. The main editor's custom paragraph/heading attrs (parTitle,
 * label, sectionNumber, …) ride through the JSON; node attrs that the
 * float's schema doesn't know about are preserved literally and re-
 * emitted via the main editor's schema on write-back, which holds the
 * authoritative attr definitions.
 *
 * Intentional omissions vs. the main editor:
 *  - No marginalia rendering or anchor guard.
 *  - No fold chevron, no in-gutter popout/drag chrome inside the
 *    float. The card header has an X close and a Jump-to button. A
 *    single drag handle by the heading lets the user grab the whole
 *    section out of the float to reorder it in the main doc.
 */

import { type RefObject, useMemo } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import {
  InlineMath,
  DisplayMath,
  Footnote,
  LatexComment,
  ArchiveMarker,
  Citation,
  LabelRef,
  LatexCommandMark,
  AiRequestMarker,
  LinkedAnchor,
  LinkedAnchorGuard,
  ExampleBlock,
  ExampleItem,
  ExampleItemList,
  ExampleGloss,
  AlignedGlossRow,
  ProseGlossRow,
  GlossCell,
  TabIndent,
} from "@/lib/tiptap-extensions";

import { FloatCard } from "./FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "./panel-primitives";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { useEditorChrome } from "./editor-layout/chrome-context";
import { getSectionRangeByUuid } from "@/lib/section-range";
import type { EditorHandle } from "./Editor";
import type { Node as PMNode } from "@tiptap/pm/model";

// Indexed by heading level 0..6 (Part..Subparagraph).
const TYPE_NAMES = ["Part", "Chapter", "Section", "Subsection", "Subsubsection", "Paragraph", "Subparagraph"];

export function HeadingFloat({
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

  // Read the section once — heading + every block in its range. We seed
  // the float editor with this content; thereafter the float is the
  // source of truth and edits are written back range-replacing the
  // section in the main doc.
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
        // Heading not found — render an empty heading at level 1 as a
        // placeholder so the float still opens.
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

  const floatEditor = useEditor({
    extensions: [
      // All block types enabled — sections can contain anything. Drop
      // cursor isn't needed in the float; it's a single-section view.
      StarterKit.configure({ dropcursor: false }),
      Highlight.configure({ multicolor: true }),
      InlineMath,
      DisplayMath,
      Footnote,
      LatexComment,
      ArchiveMarker,
      Citation,
      LabelRef,
      LatexCommandMark,
      AiRequestMarker,
      LinkedAnchor,
      LinkedAnchorGuard,
      // Expex example blocks — Virgil's custom block extension. The
      // dev-doc samples include them inside sections, so the float
      // schema must register them or those nodes silently disappear
      // during initial parse.
      ExampleBlock,
      ExampleItem,
      ExampleItemList,
      ExampleGloss,
      AlignedGlossRow,
      ProseGlossRow,
      GlossCell,
      TabIndent,
    ],
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
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    // Re-resolve the section range every write — earlier edits may
    // have shifted positions in the main doc.
    const range = getSectionRangeByUuid(ed.state.doc, uuid);
    if (!range) return;
    const incoming = doc.content ?? [];
    if (incoming.length === 0) return; // float can't be totally empty
    try {
      // Build the new section's nodes from the float's JSON, parsed
      // through the main editor's schema so heading/paragraph attrs
      // (uuid, parTitle, label, sectionNumber, …) are typed properly
      // and unknown attrs are dropped cleanly.
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
      // Preserve the original heading's attrs on the first node when
      // possible — the float editor's heading doesn't carry the main
      // editor's custom attrs (label, sectionNumber, uuid). The first
      // top-level node SHOULD be a heading; if it isn't, the user
      // restructured the section in a way we can't transparently
      // back-translate, so we pass it through as-is.
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
      if (tr.docChanged) ed.view.dispatch(tr);
    } catch {
      /* schema mismatch / stale uuid — swallow */
    }
  }

  const typeName = TYPE_NAMES[Math.max(0, Math.min(initial.level, 6))];

  return (
    <FloatCard cardKey={cardKey}>
      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-md border border-edge-subtle overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-edge-subtle bg-[var(--header-bg,#e8e5de)] text-xs text-ink-subtle">
          <span className="truncate">{typeName}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.scrollToParagraphId(uuid)}
            className="w-5 h-5 flex items-center justify-center rounded-md text-ink-muted hover:text-ink-body hover-on-light"
            title={`Jump to ${typeName.toLowerCase()}`}
            aria-label={`Jump to ${typeName.toLowerCase()}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun={typeName.toLowerCase()}
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        <div className="par-float-body heading-float-body flex-1 overflow-auto px-8 py-4 relative">
          {/* Drag handle for the whole section. Lives at the top-left of
              the float body so the user can grab the section out of the
              float (drop into the main editor moves the section via the
              MIME_PAR_CAPTURE handler). The float editor itself fills
              the body underneath. */}
          <div
            className="heading-drag-handle heading-float-section-handle"
            aria-hidden="true"
            title={`Drag ${typeName.toLowerCase()}`}
            draggable
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.stopPropagation();
              const dt = e.dataTransfer;
              if (!dt) return;
              dt.setData(MIME_PAR_CAPTURE, JSON.stringify({ uuid }));
              const text = floatEditor?.getText() ?? "";
              if (text) dt.setData("text/plain", text);
              dt.effectAllowed = "copyMove";
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
          <EditorContent editor={floatEditor} />
        </div>
      </div>
    </FloatCard>
  );
}
