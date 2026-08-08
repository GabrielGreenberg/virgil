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
 * SCHEMA (backlog #11, the A9 deferral, now LANDED): the inline-atom +
 * block-atom-preview sub-schema this read-only surface shares with
 * RichTextField is extracted into `borrowed-schema.ts` and composed via
 * `buildBorrowedAtomSchema({ includeLabelRefFootnote: true })` on top of a
 * StarterKit configured with the shared `CARD_STARTER_KIT_CONFIG`. The
 * `includeLabelRefFootnote` flag adds the read-only `\ref` (LabelRef) + nested
 * footnote markers (Footnote) this surface needs — RichTextField omits those
 * because its editable cards never author them. Only the SHARED sub-schema was
 * extracted: the main editor's `buildEditorExtensions` keeps its own ordered
 * stack (it is full of stateful main-surface NodeViews — heading folding,
 * paragraph-title chrome, the doc-structure observer, grab handles — that a
 * read-only card body must NOT run, and its block atoms carry main-only config
 * + a position-gated order), but a contract test asserts it registers every
 * atom the borrowed-schema module knows about, so "add an atom kind in one
 * place" holds across all three surfaces.
 */

import { useEffect, useMemo, useRef } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  CARD_STARTER_KIT_CONFIG,
  buildBorrowedAtomSchema,
} from "@/lib/tiptap-extensions";
import { normalizeRichContent } from "@/lib/footnote-content";
import { useCitationDisplayContextOrNull } from "@/components/editor-layout/contexts/citation-display";
import { registerEditorMount } from "@/lib/editor-census-probe";

export interface BorrowedMainTextProps {
  /** The card's already-resolved body. JSONContent (a `doc`), or anything
   *  `normalizeRichContent` accepts. */
  value: unknown;
  /** Stable identifier — change it to force a remount with new content (the
   *  same remount-on-key contract RichTextField uses). */
  instanceKey: string;
  /** Resolves a raw `\cite{...}` command into a human-readable display string
   *  (e.g. "Abusch 2014"), so persisted citation nodes with an empty
   *  `displayText` render the formatted name instead of the raw command.
   *  Optional override — when omitted, the resolver is picked up from the
   *  surrounding `CitationDisplayProvider` (backlog #16), so every mount
   *  (collapsed footnote/archive bodies included) resolves citations without
   *  per-site prop threading. */
  getCitationDisplayText?: (command: string) => string;
  /** Visual variant — `"footnote"` (serif, the default) borrows the main-text
   *  serif face; `"note"` matches the compact panel body. Drives the
   *  `rtf-content-*` class so it shares RichTextField's body CSS. */
  variant?: "footnote" | "note";
  /** Extra class on the EditorContent wrapper (e.g. line-clamp for compressed). */
  className?: string;
  /** Inline style on the EditorContent wrapper (panel typography / clamp). */
  style?: React.CSSProperties;
  /** Resolved panel body style (font-size / face / color) — the same
   *  `usePanelBodyStyle(panelKey)` value the card uses. Threaded onto the
   *  read-only editor DOM the way RichTextField does, so the panel's borrowed
   *  default (15px) AND a user size-stepper override take effect instead of
   *  being masked by the global `.tiptap p { font-size: var(--editor-font-size) }`
   *  rule. Without this the body renders at the 1.05rem fallback (~16.8px). */
  bodyStyle?: React.CSSProperties;
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
  bodyStyle,
}: BorrowedMainTextProps) {
  // Citation resolver: the explicit prop wins; otherwise fall back to the
  // surrounding CitationDisplayProvider (nullable — the throwing hook is for
  // sites that REQUIRE a provider; this surface must also render without one).
  const citationCtx = useCitationDisplayContextOrNull();
  const resolveCitation = getCitationDisplayText ?? citationCtx?.getCitationDisplayText;
  // Resolve the content. The editor is read-only, so we never need a
  // focus-gated external value sync — but we DO re-push content when `value`
  // changes (see the value-sync effect below), so a card whose instanceKey is
  // content-independent (e.g. keyed on a stable id) still reflects live edits.
  const resolved = useMemo(
    () => refreshCitationDisplay(normalizeRichContent(value), resolveCitation),
    [value, resolveCitation],
  );

  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      extensions: [
        // Shared card-body StarterKit config (SSOT in borrowed-schema.ts).
        StarterKit.configure({ ...CARD_STARTER_KIT_CONFIG }),
        // Shared card-context inline-atom + block-atom-preview sub-schema
        // (borrowed-schema.ts — backlog #11). `includeLabelRefFootnote: true`
        // adds the read-only `\ref` (LabelRef) + nested footnote markers
        // (Footnote) this borrowed surface needs — RichTextField omits those.
        // Read-only, so no Placeholder / TabIndent layer. Adding a new atom
        // kind there surfaces it here automatically (the contract test gates
        // the main editor too).
        ...buildBorrowedAtomSchema({ includeLabelRefFootnote: true }),
      ],
      content: resolved,
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

  // Editor-census probe (__editorCensus): one live-instance tick per mount.
  useEffect(() => registerEditorMount("borrowed-main-text"), []);

  // ── Read-only value-sync (FIX 2 / A9 review) ─────────────────────────────
  // A consumer may key the editor on a CONTENT-INDEPENDENT identity (e.g.
  // ExampleCard's `example-body:<id>`), so an in-card LaTeX edit keeps the same
  // instanceKey and the editor never remounts. Re-push the resolved body when
  // it changes by content identity. This fires on CONTENT change only — it
  // never subscribes to the main editor and runs no per-keystroke doc work — so
  // keystroke sanctity holds. `setContent(…, { emitUpdate: false })` does not
  // emit an update (this editor is `editable:false` with zero `editor.on`
  // anyway), keeping the re-push silent. We compare serialized JSON so an
  // unchanged body (a new object identity from re-derivation) is a no-op.
  const lastJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const nextJson = JSON.stringify(resolved);
    if (lastJsonRef.current === null) {
      // Initial content was set at mount via `content: resolved`; just record it.
      lastJsonRef.current = nextJson;
      return;
    }
    if (lastJsonRef.current === nextJson) return;
    lastJsonRef.current = nextJson;
    editor.commands.setContent(resolved, { emitUpdate: false });
  }, [editor, resolved]);

  // ── Panel typography (FIX 1 / A9 review) ─────────────────────────────────
  // Write the resolved panel font-size / face / color onto the editor DOM the
  // way RichTextField does. Setting `--editor-font-size` (not just `font-size`)
  // is required because the global `.tiptap p` rule resolves its own size from
  // that var, which would otherwise mask an inherited inline value — so without
  // this the borrowed body renders at the 1.05rem fallback (~16.8px) instead of
  // the declared 15px (or a stepped override).
  useEffect(() => {
    if (!editor) return;
    // We mutate the live ProseMirror DOM node's inline style, not the `editor`
    // hook value — React Compiler's `react-hooks/immutability` rule can't tell
    // the two apart and flags `editor cannot be modified`. RichTextField.tsx
    // ships this same error on its identical panel-typography effect (the
    // codebase-accepted norm); we suppress it here so the touched file stays
    // lint-clean.
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

  return <EditorContent editor={editor} className={className} style={style} />;
}

export default BorrowedMainText;
