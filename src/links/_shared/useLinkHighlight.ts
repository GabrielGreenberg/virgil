"use client";

/**
 * DOM-attribute sync for the STANDING (non-attention) chrome of `anchor`-kind
 * links — Mode-B `.linked-anchor` spans. Given the per-kind visibility set
 * and the archived-anchor set, this hook:
 *
 *   - Sets `data-show-hl-<kind>="true"` on the editor scroll root for
 *     each kind whose persistent highlight is enabled — CSS scopes the
 *     subtle background per-kind by matching `data-link-card^="<kind>:"`.
 *   - Sets `data-anchor-archived="true"` on the span(s) of every ARCHIVED
 *     card, which one CSS rule turns into "no anchor chrome at all" (task
 *     497 — see `archived-anchor-chrome.ts` for the rule and why the key
 *     is the anchorId rather than the card id).
 *
 * HOVER / SELECTION are NOT here (task 1148). They are attention state, and
 * their one painter is the pane's `useAnchorHighlightReconciler`, which stamps
 * `data-card-hovered` / `data-card-selected` on the span from the pane's own
 * card store. This hook used to paint a second channel (`data-link-highlight`)
 * from a shell-level copy of the same state; the reconciler's later CSS rule
 * always won the background, so the second channel was dead paint plus a
 * second DOM sweep per hover.
 *
 * HOST: `EditorPane`, once per pane (task 1316). It used to be mounted in
 * EditorLayout's shell, so a pane with no shell around it — the Library
 * Reader — got no washes and every Highlights toggle in its View menu was
 * inert. The pane owns both inputs anyway: its editor, its `archivedAnchorIds`
 * authority, and the view prefs its host hands it.
 */

import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { DATA_LINK_ID } from "../link-dom-contract";
import { useDocStructureBus } from "@/lib/tiptap/doc-structure";
import {
  ALL_HIGHLIGHT_TYPES,
  type HighlightType,
} from "@/lib/view-prefs/highlight-types";

/** Cross-layer DOM contract with `globals.css`'s archived-chrome rule. */
export const DATA_ANCHOR_ARCHIVED = "data-anchor-archived";

/**
 * Every kind that carries a `data-show-hl-<kind>` root toggle — DERIVED from
 * the Highlights-menu SSOT (`ALL_HIGHLIGHT_TYPES`) plus `"archive"`, whose
 * wash is not menu-togglable and rides the master switch alone (task 1316).
 * Never hand-listed: a kind added to the SSOT gets its menu row AND its root
 * attribute from the same edit.
 */
export const LINK_ANCHOR_KINDS = [...ALL_HIGHLIGHT_TYPES, "archive"] as const;
export type LinkAnchorKind = (typeof LINK_ANCHOR_KINDS)[number];

/**
 * The ONE rule from the two highlight prefs to the kinds whose persistent
 * wash is on: nothing when the master switch is off; otherwise every
 * menu kind not hidden, plus `"archive"`. Pure — the pane (which mounts the
 * hook) and the shell (which gates the revisions text highlight on
 * `"comment"`) both read it, so neither restates it.
 */
export function visibleHighlightKinds(prefs: {
  showHighlights: boolean;
  hiddenHighlightTypes: readonly HighlightType[];
}): ReadonlySet<LinkAnchorKind> {
  const out = new Set<LinkAnchorKind>();
  if (!prefs.showHighlights) return out;
  for (const t of ALL_HIGHLIGHT_TYPES) {
    if (!prefs.hiddenHighlightTypes.includes(t)) out.add(t);
  }
  out.add("archive");
  return out;
}

const dataAttrFor = (kind: LinkAnchorKind) => `data-show-hl-${kind}`;

export interface UseLinkHighlightArgs {
  editor: Editor | null;
  /** Card kinds whose persistent linked-anchor highlight is currently
   *  enabled. Empty set hides all. */
  visibleHighlightKinds: ReadonlySet<LinkAnchorKind>;
  /**
   * Mode-B `linkedAnchor` anchor ids owned by an ARCHIVED card, from the one
   * authority (`archivedAnchorIds`, projected in EditorPane — the hook's one
   * host, task 1316). REQUIRED, deliberately: an optional prop with an empty-set
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
  visibleHighlightKinds,
  archivedAnchorIds,
}: UseLinkHighlightArgs): void {
  // Preference sync — set/clear a per-kind attr on the editor scroll
  // root. CSS scopes the persistent tint per kind by combining the
  // root attr with `data-link-card^="<kind>:"` on the span.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    for (const kind of LINK_ANCHOR_KINDS) {
      if (visibleHighlightKinds.has(kind)) {
        root.setAttribute(dataAttrFor(kind), "true");
      } else {
        root.removeAttribute(dataAttrFor(kind));
      }
    }
    return () => {
      for (const kind of LINK_ANCHOR_KINDS) root.removeAttribute(dataAttrFor(kind));
    };
  }, [editor, visibleHighlightKinds]);

  // ── Archived-chrome sync (task 497) ────────────────────────────────────
  //
  // An archived card draws no anchor chrome. The three CSS paths that paint a
  // Mode-B span — the per-kind 18% wash, the `!important` tint band, and the
  // hover / selection washes — are all keyed on attributes the MARK emits from
  // `renderHTML`, which knows nothing about card state; so the state arrives as
  // one extra attribute here and one CSS rule turns it off.
  // (The hover/selection wash is now stamped by the reconciler — task 1148 —
  // and the same CSS rule zeroes it.)
  //
  // Keyed on the ANCHOR id, never the card id: a reload-restored span carries
  // `data-link-card="note:"` with the card id deliberately empty
  // (`applyLinkedAnchors`), so a card-keyed sweep would work in-session and die
  // on every reload. See `archived-anchor-chrome.ts`.
  //
  // The attribute is PERSISTENT state, unlike its sibling above (the per-kind
  // attrs live on the editor ROOT, which ProseMirror never recreates). So it must survive a redraw, and MEASURED against this
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
  // times (docs/agents/laws/keystroke-sanctity.md, "Keystroke sanctity"). The
  // sweep is ONE query over the Mode-B spans and runs only off that channel or
  // a prop change.
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
    // ONE root query per sweep (task 937): every Mode-B span, each checked
    // against the archived set by its id — O(spans), not O(archived × DOM)
    // as the per-id `querySelectorAll` loop it replaced was. Equality-bailed,
    // so a sweep that changes nothing writes nothing.
    const sweep = () => {
      const spans = root.querySelectorAll(`.linked-anchor[${DATA_LINK_ID}]`);
      for (const el of spans) {
        const want = archivedAnchorIds.has(el.getAttribute(DATA_LINK_ID) ?? "");
        if (want === el.hasAttribute(DATA_ANCHOR_ARCHIVED)) continue;
        if (want) el.setAttribute(DATA_ANCHOR_ARCHIVED, "true");
        else el.removeAttribute(DATA_ANCHOR_ARCHIVED);
      }
    };
    sweep();
    return bus?.onAnyChange(sweep);
  }, [editor, bus, archivedAnchorIds]);
}
