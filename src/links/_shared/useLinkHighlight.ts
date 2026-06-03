"use client";

/**
 * DOM-attribute sync for the coupled margin-icon / text-range highlight
 * on `anchor`-kind links. Given the current active/hovered link id and
 * the per-kind visibility set, this hook:
 *
 *   - Sets `data-link-highlight="active" | "hover"` on the matching
 *     `.linked-anchor[data-link-id=<id>]` span(s) in the editor.
 *   - Sets `data-show-hl-<kind>="true"` on the editor scroll root for
 *     each kind whose persistent highlight is enabled — CSS scopes the
 *     subtle background per-kind by matching `data-link-card^="<kind>:"`.
 *
 * The margin-icon side of the coupling reads the same state via its
 * own `selected` prop; no DOM plumbing is needed there.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { DATA_LINK_ID } from "../link-registry";

const DATA_HIGHLIGHT = "data-link-highlight";

const ALL_KINDS = [
  "note",
  "todo",
  "comment",
  "cut",
  "archive",
  "report",
] as const;
type LinkAnchorKind = (typeof ALL_KINDS)[number];

const dataAttrFor = (kind: LinkAnchorKind) => `data-show-hl-${kind}`;

export interface UseLinkHighlightArgs {
  editor: Editor | null;
  /** Link id of the currently-selected link, or null. */
  activeLinkId: string | null;
  /** Link id of the currently-hovered link, or null. Hover takes
   *  precedence over active for visuals. */
  hoveredLinkId: string | null;
  /** Card kinds whose persistent linked-anchor highlight is currently
   *  enabled. Empty set hides all. */
  visibleHighlightKinds: ReadonlySet<LinkAnchorKind>;
}

export function useLinkHighlight({
  editor,
  activeLinkId,
  hoveredLinkId,
  visibleHighlightKinds,
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

  // Preference sync — set/clear a per-kind attr on the editor scroll
  // root. CSS scopes the persistent tint per kind by combining the
  // root attr with `data-link-card^="<kind>:"` on the span.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    for (const kind of ALL_KINDS) {
      if (visibleHighlightKinds.has(kind)) {
        root.setAttribute(dataAttrFor(kind), "true");
      } else {
        root.removeAttribute(dataAttrFor(kind));
      }
    }
    return () => {
      for (const kind of ALL_KINDS) root.removeAttribute(dataAttrFor(kind));
    };
  }, [editor, visibleHighlightKinds]);
}
