"use client";

/**
 * StaticBorrowedText — the T1 presence tier's body surface (perf Wave 3).
 *
 * Renders a borrowed card body as STATIC HTML (`renderBorrowedHtml`) instead
 * of mounting a read-only TipTap editor per collapsed card. Zero editors,
 * zero census ticks, zero ProseMirror state — the collapsed-card half of the
 * diagnosis's 881-live-editors problem.
 *
 * Fidelity contract with the live `BorrowedMainText` twin:
 *  - SAME pipeline (normalize → citation refresh → the scope's exact
 *    extension list) via the borrowed-render SSOT — never a hand copy.
 *  - SAME class surface: `tiptap` (the `.tiptap p` typography rules key on
 *    it) + `rtf-content rtf-content-<variant> borrowed-main-text`.
 *    Deliberately NOT `ProseMirror`: nothing here is an editor, and the
 *    presence-tier contract test counts `.ProseMirror` instances as the
 *    "zero live editors" tooth.
 *  - SAME panel-typography contract: `--editor-font-size` is set alongside
 *    `font-size` (the `.tiptap p` rule resolves the var, which would
 *    otherwise mask the inline value — the exact bug the live twin's
 *    typography effect exists to prevent).
 *  - Math: `renderHTML` emits raw `$…$` text with a `latex` attribute; the
 *    one-shot KaTeX pass below repaints each math atom through the SAME
 *    `renderMath` the live NodeView uses (placeholder/error sentinels
 *    included). Runs once per rendered HTML, in an effect, never per
 *    keystroke — this component subscribes to nothing.
 *
 * A body the scope's schema cannot represent renders as the plain-text
 * fallback the caller supplies (renderBorrowedHtml returns null — the
 * refusal contract), never a blank.
 */

import { useEffect, useMemo, useRef } from "react";
import { renderBorrowedHtml } from "@/lib/borrowed-render";
import { renderMath } from "@/lib/tiptap/math";
import { richJsonToPlainText } from "@/lib/footnote-content";
import type { CardBodySchemaScope } from "@/lib/tiptap/borrowed-schema";
import { useCitationDisplayContextOrNull } from "@/components/editor-layout/contexts/citation-display";

export interface StaticBorrowedTextProps {
  /** The card's already-resolved body (same contract as BorrowedMainText). */
  value: unknown;
  /** Optional citation resolver override; falls back to the surrounding
   *  CitationDisplayProvider, exactly like the live twin. */
  getCitationDisplayText?: (command: string) => string;
  variant?: "footnote" | "note";
  /** Resolved panel body style (font-size / face / color) — the same
   *  `usePanelBodyStyle(panelKey)` value the live twin threads. */
  bodyStyle?: React.CSSProperties;
  /** Body vocabulary (task 308) — thread the SAME value the card's other
   *  surfaces use. */
  schemaScope?: CardBodySchemaScope;
}

export function StaticBorrowedText({
  value,
  getCitationDisplayText,
  variant = "footnote",
  bodyStyle,
  schemaScope = "card",
}: StaticBorrowedTextProps) {
  const citationCtx = useCitationDisplayContextOrNull();
  const resolveCitation =
    getCitationDisplayText ?? citationCtx?.getCitationDisplayText;

  const html = useMemo(
    () => renderBorrowedHtml(value, schemaScope, resolveCitation),
    [value, schemaScope, resolveCitation],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);

  // One-shot KaTeX pass per rendered HTML: repaint each math atom from its
  // `latex` attribute (TipTap's default attr rendering carries it through
  // generateHTML). Keyed on `html` so a body edit re-runs it; never runs on
  // any editor event — this surface has no editor.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !html) return;
    const inline = root.querySelectorAll<HTMLElement>(
      'span[data-type="inline-math"]',
    );
    for (const el of inline) renderMath(el, el.getAttribute("latex") ?? "", false);
    const display = root.querySelectorAll<HTMLElement>(
      'div[data-type="display-math"]',
    );
    for (const el of display) renderMath(el, el.getAttribute("latex") ?? "", true);
  }, [html]);

  // Panel typography, inline (the live twin writes the same three onto its
  // editor DOM in an effect; a static div can carry them in render). The
  // `--editor-font-size` var write is the load-bearing half — see the
  // header comment.
  const style = useMemo(() => {
    const s: React.CSSProperties & Record<string, string> = {};
    if (bodyStyle?.fontFamily) s.fontFamily = String(bodyStyle.fontFamily);
    if (bodyStyle?.fontSize) {
      s.fontSize = String(bodyStyle.fontSize);
      s["--editor-font-size"] = String(bodyStyle.fontSize);
    }
    if (bodyStyle?.color) s.color = String(bodyStyle.color);
    return s;
  }, [bodyStyle]);

  if (html === null) {
    // Refusal path: the scope's schema can't represent this body — show the
    // faithful plain-text projection rather than a blank (task-308 class).
    return (
      <div
        className={`rtf-content rtf-content-${variant} static-borrowed-text`}
        style={style}
        data-static-borrowed="fallback"
      >
        {richJsonToPlainText(value)}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`tiptap rtf-content rtf-content-${variant} borrowed-main-text static-borrowed-text`}
      style={style}
      data-static-borrowed="html"
      // The HTML is produced by TipTap's own generateHTML over the card
      // schema from the card's stored JSON — same trust domain as the live
      // editor's DOM, no user-supplied raw HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default StaticBorrowedText;
