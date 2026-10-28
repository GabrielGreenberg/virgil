"use client";

/**
 * DOM-attribute sync for the STANDING (non-attention) chrome of `anchor`-kind
 * links — Mode-B `.linked-anchor` spans. Given the per-kind visibility set
 * and the archived-anchor set, this hook:
 *
 *   - Sets `data-show-hl-<kind>="true"` on the editor scroll root for
 *     each kind whose persistent highlight is enabled — CSS scopes the
 *     subtle background per-kind by matching `data-link-card^="<kind>:"`.
 *   - Paints `data-anchor-archived="true"` over the passage of every ARCHIVED
 *     card — as a DECORATION on the transient-highlight engine's `archived`
 *     channel (task 1331) — which one CSS rule turns into "no anchor chrome
 *     at all" (task 497 — see `archived-anchor-chrome.ts` for the rule and
 *     why the key is the anchorId rather than the card id).
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

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import { useDocStructureBus } from "@/lib/tiptap/doc-structure";
import {
  setTransientHighlights,
  type TransientAttrTarget,
} from "@/lib/tiptap/transient-highlight";
import { resolveLinkedAnchorRange } from "@/lib/linked-anchor-range";
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

  // ── Archived-chrome sync (task 497; a DECORATION since task 1331) ──────
  //
  // An archived card draws no anchor chrome. The three CSS paths that paint a
  // Mode-B span — the per-kind 18% wash, the `!important` tint band, and the
  // hover / selection washes — are all keyed on attributes the MARK emits from
  // `renderHTML`, which knows nothing about card state; so the state arrives as
  // one extra attribute and one CSS rule turns the chrome off.
  //
  // Keyed on the ANCHOR id, never the card id: a reload-restored span carries
  // `data-link-card="note:"` with the card id deliberately empty
  // (`applyLinkedAnchors`), so a card-keyed paint would work in-session and die
  // on every reload. See `archived-anchor-chrome.ts`.
  //
  // CARRIER: the transient-highlight engine's `archived` channel — an inline
  // decoration over each archived anchor's live range, replaced by a META-ONLY
  // transaction ("Transient state is never document content"). It used to be
  // an imperative `setAttribute` on the PM-owned `.linked-anchor` span, swept on
  // `onAnyChange`; PM re-mints that span on any redraw, and a MARK SPLIT
  // (bolding one word of the passage) is a redraw that wakes no structural
  // watcher, so the fresh fragments came back unstamped and the archived note's
  // wash reappeared (task 1331). A decoration is re-applied by the view on
  // every redraw, so split, re-stamp and `setContent` are covered by
  // construction rather than by a list of redraw shapes.
  //
  // Between repaints the set forward-maps (typing inside the passage stays
  // covered; `emitCount` flat). It is REBUILT — one bounded range resolve per
  // archived anchor — only when the archived set changes, on a structural
  // emit (an anchor re-entering via undo, a structure-changing replace), or
  // when an archived anchor's EXTENT changes (`onAnchorExtentChanged`: a text
  // drag-drop moves it, which mapping would not reproduce). Rebuilds off a bus
  // emit are deferred to a coalesced microtask: the bus emits from inside the
  // observer's view `update()`, where a nested dispatch would re-enter it
  // (the `useRequestWash` precedent).
  //
  // The host re-derives the set on every card-collection change (a keystroke
  // in a card body included), so the effect keys on its CONTENTS, not its
  // identity: an equal set repaints nothing.
  const bus = useDocStructureBus(editor);
  const archivedKey = [...archivedAnchorIds].sort().join("\u0000");
  const archivedRef = useRef(archivedAnchorIds);
  archivedRef.current = archivedAnchorIds;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const ids = archivedRef.current;
    const paint = () => {
      if (editor.isDestroyed) return;
      setTransientHighlights(
        editor.view,
        archivedAnchorTargets(editor.state, ids),
        "archived",
      );
    };
    paint();
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        paint();
      });
    };
    const unsubs: Array<() => void> = [];
    if (bus && ids.size > 0) {
      unsubs.push(bus.onAnyChange(schedule));
      for (const id of ids) {
        unsubs.push(bus.onAnchorExtentChanged(id, schedule));
      }
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [editor, bus, archivedKey]);
}

/**
 * The `archived` channel's COMPLETE desired set: one attr wrapper over the live
 * range of every archived anchor present in the document. An anchor not in the
 * document (its passage deleted, or a stale id) contributes nothing. O(#archived)
 * bounded resolves, run only off the rebuild triggers above — never per keystroke.
 */
export function archivedAnchorTargets(
  state: EditorState,
  archivedAnchorIds: ReadonlySet<string>,
): TransientAttrTarget[] {
  const out: TransientAttrTarget[] = [];
  for (const id of archivedAnchorIds) {
    if (!id) continue;
    const range = resolveLinkedAnchorRange(state, id);
    if (!range || range.to <= range.from) continue;
    out.push({
      shape: "attrs",
      from: range.from,
      to: range.to,
      attrs: { [DATA_ANCHOR_ARCHIVED]: "true" },
    });
  }
  return out;
}
