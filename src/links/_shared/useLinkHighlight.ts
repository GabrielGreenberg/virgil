"use client";

/**
 * DOM-attribute sync for the coupled margin-icon / text-range highlight
 * on `anchor`-kind links. Given the current active/hovered link id and
 * the `alwaysShowLinkedText` preference, this hook:
 *
 *   - Sets `data-link-highlight="active" | "hover"` on the matching
 *     `.linked-anchor[data-link-id=<id>]` span(s) in the editor.
 *   - Sets `data-always-show-links="true"` on the editor scroll root
 *     when the preference is on — CSS turns subtle persistent
 *     backgrounds on globally.
 *
 * The margin-icon side of the coupling reads the same state via its
 * own `selected` prop; no DOM plumbing is needed there.
 *
 * This is the CSS-driven replacement for the Tiptap Highlight-mark
 * approach in `Editor.tsx:2188-2204`, which remains in place for one
 * release as belt-and-suspenders.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { DATA_LINK_ID } from "../link-registry";

const DATA_HIGHLIGHT = "data-link-highlight";
const DATA_ALWAYS_SHOW = "data-always-show-links";

export interface UseLinkHighlightArgs {
  editor: Editor | null;
  /** Link id of the currently-selected link, or null. */
  activeLinkId: string | null;
  /** Link id of the currently-hovered link, or null. Hover takes
   *  precedence over active for visuals. */
  hoveredLinkId: string | null;
  /** When true, CSS applies a subtle persistent background to every
   *  Mode B text range in the doc. */
  alwaysShowLinkedText: boolean;
}

export function useLinkHighlight({
  editor,
  activeLinkId,
  hoveredLinkId,
  alwaysShowLinkedText,
}: UseLinkHighlightArgs): void {
  // Highlight sync — the span for the effective link id gets the
  // data-link-highlight attr; everyone else gets it cleared.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const effectiveId = hoveredLinkId ?? activeLinkId;
    const state = hoveredLinkId ? "hover" : activeLinkId ? "active" : null;

    const stale = root.querySelectorAll(
      `.linked-anchor[${DATA_HIGHLIGHT}]`,
    );
    for (const el of stale) el.removeAttribute(DATA_HIGHLIGHT);

    if (!effectiveId || !state) return;
    const fresh = root.querySelectorAll(
      `.linked-anchor[${DATA_LINK_ID}="${effectiveId}"]`,
    );
    for (const el of fresh) el.setAttribute(DATA_HIGHLIGHT, state);
  }, [editor, activeLinkId, hoveredLinkId]);

  // Preference sync — on the editor scroll root so :has() in CSS is cheap.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    if (alwaysShowLinkedText) {
      root.setAttribute(DATA_ALWAYS_SHOW, "true");
    } else {
      root.removeAttribute(DATA_ALWAYS_SHOW);
    }
    return () => root.removeAttribute(DATA_ALWAYS_SHOW);
  }, [editor, alwaysShowLinkedText]);
}
