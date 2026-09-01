"use client";

/**
 * DOM-attribute sync for the coupled margin-icon / text-range highlight
 * on `anchor`-kind links. Given the current active/hovered link id, the
 * per-kind visibility set and the archived-anchor set, this hook:
 *
 *   - Sets `data-link-highlight="active" | "hover"` on the matching
 *     `.linked-anchor[data-link-id=<id>]` span(s) in the editor.
 *   - Sets `data-show-hl-<kind>="true"` on the editor scroll root for
 *     each kind whose persistent highlight is enabled — CSS scopes the
 *     subtle background per-kind by matching `data-link-card^="<kind>:"`.
 *   - Sets `data-anchor-archived="true"` on the span(s) of every ARCHIVED
 *     card, which one CSS rule turns into "no anchor chrome at all" (task
 *     497 — see `archived-anchor-chrome.ts` for the rule and why the key
 *     is the anchorId rather than the card id).
 *
 * The margin-icon side of the coupling reads the same state via its
 * own `selected` prop; no DOM plumbing is needed there.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { linkIdSelector } from "../link-dom-contract";
import { useDocStructureBus } from "@/lib/tiptap/doc-structure";
// Name from the view-only vocabulary (task 523). This attribute paints a
// 45%/60% wash plus a ring from `--link-anchor-color`, which the print block
// zeroes BY this name — until 523 it was neutralised only because the anchor
// reconciler happens to stamp `data-card-selected` on the same element.
import { DATA_LINK_HIGHLIGHT as DATA_HIGHLIGHT } from "@/lib/view-only-chrome";

/** Cross-layer DOM contract with `globals.css`'s archived-chrome rule. */
export const DATA_ANCHOR_ARCHIVED = "data-anchor-archived";

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
  /**
   * Mode-B `linkedAnchor` anchor ids owned by an ARCHIVED card, from the one
   * authority (`archivedAnchorIds`, projected in EditorPane and bubbled through
   * `PaneState`). REQUIRED, deliberately: an optional prop with an empty-set
   * default would let a host silently restore the pre-497 behaviour — archived
   * notes leaving their wash standing in the prose — with no type error and no
   * test failure. A host that genuinely has no cards says so by passing an
   * empty set; that is a decision, not an inherited default.
   * (AGENTS.md: "A defaulted argument is a decision nobody made.")
   */
  archivedAnchorIds: ReadonlySet<string>;
}

export function useLinkHighlight({
  editor,
  activeLinkId,
  hoveredLinkId,
  visibleHighlightKinds,
  archivedAnchorIds,
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
      `.linked-anchor${linkIdSelector(effectiveId)}`,
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

  // ── Archived-chrome sync (task 497) ────────────────────────────────────
  //
  // An archived card draws no anchor chrome. The three CSS paths that paint a
  // Mode-B span — the per-kind 18% wash, the `!important` tint band, and the
  // hover / selection washes — are all keyed on attributes the MARK emits from
  // `renderHTML`, which knows nothing about card state; so the state arrives as
  // one extra attribute here and one CSS rule turns it off.
  //
  // Keyed on the ANCHOR id, never the card id: a reload-restored span carries
  // `data-link-card="note:"` with the card id deliberately empty
  // (`applyLinkedAnchors`), so a card-keyed sweep would work in-session and die
  // on every reload. See `archived-anchor-chrome.ts`.
  //
  // The attribute is PERSISTENT state, unlike its two siblings above (hover is
  // transient; the per-kind attrs live on the editor ROOT, which ProseMirror
  // never recreates). So it must survive a redraw, and MEASURED against this
  // tree the two redraw shapes fall out cleanly:
  //
  //  - a structure-PRESERVING whole-doc replace (`setContent` with the same
  //    blocks — the ordinary code-pane push) leaves the span element in place:
  //    PM's viewdesc sync matches and REUSES the `MarkViewDesc`, so the stamp
  //    rides through it unaided, and the bus stays silent (correctly — there is
  //    nothing to re-stamp);
  //  - a structure-CHANGING one (a block added in the code view) builds FRESH
  //    span DOM and the stamp goes with the old elements. That is exactly the
  //    shape the bus reports, so `onAnyChange` is what puts it back.
  //
  // `onAnyChange` is `emitCount`-gated: typing N plain characters fires it ZERO
  // times (AGENTS.md, "Keystroke sanctity"). The sweep is O(archived) and runs
  // only off that channel or a prop change.
  //
  // Residual, stated: a MARK-ATTRS re-stamp (a card-kind morph rewriting
  // `linkCard`) also recreates the span and does NOT wake the bus — but every
  // such re-stamp is driven by a card record change, which mints a fresh
  // `archivedAnchorIds` set upstream and re-fires this effect through its own
  // deps. What is genuinely uncovered is a mark re-stamp with no card change at
  // all, which today only `reapplyModeBAnchors` performs, on a fresh editor at
  // load — before the sidecars have populated the set.
  // The re-sweep is IMPERATIVE, never a React state bump: a structural
  // transaction is ordinary editing (press Enter and a block is added), and
  // re-rendering the shell for it would trade a stale attribute for a render
  // storm. The subscription and the sweep therefore live in ONE effect that
  // re-registers only when the editor or the archived set changes.
  const bus = useDocStructureBus(editor);
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const sweep = () => {
      const stale = root.querySelectorAll(
        `.linked-anchor[${DATA_ANCHOR_ARCHIVED}]`,
      );
      for (const el of stale) el.removeAttribute(DATA_ANCHOR_ARCHIVED);
      for (const anchorId of archivedAnchorIds) {
        const spans = root.querySelectorAll(
          `.linked-anchor${linkIdSelector(anchorId)}`,
        );
        for (const el of spans) el.setAttribute(DATA_ANCHOR_ARCHIVED, "true");
      }
    };
    sweep();
    return bus?.onAnyChange(sweep);
  }, [editor, bus, archivedAnchorIds]);
}
