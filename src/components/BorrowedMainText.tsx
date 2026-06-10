"use client";

/**
 * BorrowedMainText (A9 §C1) — a READ-ONLY TipTap renderer for a card's
 * already-resolved body, so that a card that quotes document prose renders the
 * real inline atoms (citations, `\ref` label refs, inline math, nested
 * footnote markers) with the same fidelity as the main text — instead of a
 * flattened `textContent` string.
 *
 * KEYSTROKE SANCTITY: this mounts its OWN isolated editor over one card's
 * resolved JSONContent. It never touches — never subscribes to — the MAIN
 * editor's transactions (it has no `editor.on('update'|'transaction')`, no
 * `onUpdate`, no doc walk). Re-rendering is driven only by prop changes
 * (remount on `instanceKey`). This is the same isolation RichTextField already
 * relies on; the keystroke-sanctity sweep covers per-keystroke MAIN-editor
 * work, which this does none of.
 *
 * R10: this AUGMENTS display only. footnote/note/archive keep their editable
 * `RichTextField` path for in-card editing; BorrowedMainText is used for their
 * collapsed / reader / popped-read surfaces and for the always-read-only
 * example body. R12: highlight keeps its faithful serif STRING excerpt (it has
 * no JSONContent body) — do NOT route highlight through here.
 *
 * SCHEMA (the A9 fallback, ratified): this builds its own read-only extension
 * list mirroring RichTextField's hand-mirrored card-context schema (StarterKit
 * minus heading/blockquote/codeBlock, plus the inline atoms + block-atom
 * previews), rather than extracting a shared `borrowed-schema.ts` consumed by
 * BOTH the main editor and here. The full extraction was DEFERRED (backlog):
 * the main editor's `buildEditorExtensions` is full of stateful main-surface
 * NodeViews (heading folding, paragraph-title chrome, the doc-structure
 * observer, grab handles) that a read-only card body must not run, so the two
 * schemas are intentionally different and a "pure extraction" is not clean.
 * BorrowedMainText additionally registers `LabelRef` + `Footnote` (read-only)
 * so `\ref` and nested footnote markers render — RichTextField omits those
 * because its cards never need to edit them.
 */

import { useMemo } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  InlineMath,
  DisplayMath,
  Citation,
  LabelRef,
  Footnote,
  LatexCommandMark,
  TexBlock,
  FigureBlock,
  FigureCaption,
  GraphicsBlock,
  LatexComment,
} from "@/lib/tiptap-extensions";
import { normalizeRichContent } from "@/lib/footnote-content";

export interface BorrowedMainTextProps {
  /** The card's already-resolved body. JSONContent (a `doc`), or anything
   *  `normalizeRichContent` accepts. */
  value: unknown;
  /** Stable identifier — change it to force a remount with new content (the
   *  same remount-on-key contract RichTextField uses). */
  instanceKey: string;
  /** Resolves a raw `\cite{...}` command into a human-readable display string
   *  (e.g. "Abusch 2014"), so persisted citation nodes with an empty
   *  `displayText` render the formatted name instead of the raw command. */
  getCitationDisplayText?: (command: string) => string;
  /** Visual variant — `"borrowed"` (serif, the default) borrows the main-text
   *  serif face; `"sans"` matches the compact panel body. Drives the
   *  `rtf-content-*` class so it shares RichTextField's body CSS. */
  variant?: "footnote" | "note";
  /** Extra class on the EditorContent wrapper (e.g. line-clamp for compressed). */
  className?: string;
  /** Inline style on the EditorContent wrapper (panel typography / clamp). */
  style?: React.CSSProperties;
}

/** Rewrite citation nodes so their `displayText` reflects the current
 *  bibliography lookup (persisted nodes often saved `displayText=""`). Pure;
 *  runs once at mount on the initial content. */
function refreshCitationDisplay(
  doc: JSONContent,
  resolve: ((command: string) => string) | undefined,
): JSONContent {
  if (!resolve) return doc;
  function walk(node: JSONContent): JSONContent {
    if (node.type === "citation" && node.attrs) {
      const command = (node.attrs.command as string) || "";
      const desired = resolve!(command) || command;
      if (node.attrs.displayText !== desired) {
        return { ...node, attrs: { ...node.attrs, displayText: desired } };
      }
      return node;
    }
    if (node.content) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(doc);
}

export function BorrowedMainText({
  value,
  instanceKey,
  getCitationDisplayText,
  variant = "footnote",
  className,
  style,
}: BorrowedMainTextProps) {
  // Resolve the initial content once. The editor is read-only and remounts on
  // instanceKey, so we never need a focus-gated external value sync.
  const initialContent = useMemo(
    () => refreshCitationDisplay(normalizeRichContent(value), getCitationDisplayText),
    // instanceKey is the remount key; value/lookup are read at mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instanceKey],
  );

  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        InlineMath,
        Citation,
        LabelRef,
        Footnote,
        LatexCommandMark,
        // Block-atom previews in card-context mode — mirror RichTextField so a
        // body carrying a texBlock / figure / graphics / comment / displayMath
        // renders its compact static preview instead of being stripped.
        TexBlock.configure({ cardContext: true }),
        FigureBlock.configure({ cardContext: true }),
        FigureCaption,
        GraphicsBlock.configure({ cardContext: true }),
        LatexComment.configure({ cardContext: true }),
        DisplayMath,
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          // Share RichTextField's body CSS (font face / spacing) but flag this
          // as the read-only borrowed surface so styling can diverge if needed.
          class: `rtf-content rtf-content-${variant} borrowed-main-text focus:outline-none`,
        },
      },
    },
    // Remount when the card identity changes (same contract as RichTextField).
    [instanceKey],
  );

  return <EditorContent editor={editor} className={className} style={style} />;
}

export default BorrowedMainText;
