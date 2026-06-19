/**
 * The ONE implementation of the load-time linked-anchor re-apply / reconcile
 * (`applyLinkedAnchorsImpl`). Both the production handle (`Editor.tsx`'s
 * `applyLinkedAnchors`) and the RC-B tests import this function, so they can
 * never drift apart (it replaces the prior hand-copied test mirror of the
 * handle body).
 *
 * BUG1 fix — RECONCILE, not skip. On reload the `.tex` parse does NOT drop the
 * `linkedAnchor` mark; it RESURRECTS every `\vlid` pair as a HARDCODED
 * `kind:"note"`/`linkCard:""` mark (`applyLinkedAnchorBoundaries`). The old
 * handle skipped any record whose anchorId was already present, so a revision /
 * cutter / todo / report / highlight span reloaded permanently mislabeled as a
 * note (its purple/red/stone/yellow accent lost — the BUG1 kind-corruption
 * class). This impl makes the sidecar authoritative:
 *
 *   - absent  → re-stamp from the snapshot text via `reanchorByText` (carries
 *               the kind, cardId, and kind-derived tintColor faithfully).
 *   - present & DISAGREES (kind, linkCard token, or tintColor mismatch) →
 *               re-stamp the existing range IN PLACE with the authoritative
 *               attrs (`addToHistory:false` — a load-time correction, not an
 *               undoable user edit).
 *   - present & AGREES → skip (idempotent; a healthy reloaded mark, or our own
 *               re-stamp on a re-run, costs nothing).
 *
 * The `linkCard` token is built via the SHARED `legacyKindToCardKindString`
 * (the same fn create-time uses) so the re-stamped token is byte-identical to
 * create-time.
 *
 * LOAD-ONLY: invoked once per doc-open from the EditorPane reconcile effect
 * (latched on `modeAReconciledDocRef`). Never a keystroke subscriber; the
 * Map-vs-doc capture is O(marks) at load, not per-keystroke.
 */

import type { Editor } from "@tiptap/react";
import { reanchorByText, resolveTextRangeByAnchorId } from "../links";
import type { ModeBReapplyRecord } from "./reapply-mode-b-anchors";

// ─────────────────────────────────────────────────────────────────────────────
// linkCard policy (load-bearing — do NOT stamp a derived `<token>:<id>` here).
//
// The reconcile re-stamps ONLY the authoritative-on-reload attrs — `kind` and
// `tintColor` — and PRESERVES whatever `linkCard` the live mark already carries
// (on a fresh parse that is the schema default `""`; the parser never emits a
// linkCard). It does NOT synthesize `linkCard` from the record's `cardId`.
//
// WHY: the canonical `data-link-card` grammar is `<spineCardKind>:<id>` (the
// `linkCardKey` SSOT — `link-registry.ts`), which `parseLinkCardKey` consumers
// (delete-range / drag-handle bindAnchor / duplicate-slice / collectLinksFromEditor)
// slice back into a spine `CardKind`. The LEGACY mark-`kind` token namespace
// DIVERGES from the spine kind for exactly the two revision kinds
// (`revision-comment`/`revision-suggestion` → mark-token `comment`). An earlier
// version stamped `<legacyToken>:<id>` = `comment:<id>`, which parsed to the
// non-spine kind `"comment"` → `lifecycle.get("comment")` is undefined → a block
// delete silently failed to remove the revision card, and `collectLinksFromEditor`
// minted an invalid `ref.kind`. Leaving `linkCard` empty restores the PROVEN
// historical-restore behavior: `kind` drives the per-kind COLOUR via the render
// fallback (`dataLinkCardTokenForLegacyMarkKind` → `comment:`) and consumer
// resolution via the `legacyAnchorKindToCardKind` fallback. (A future enhancement
// could make reloaded marks self-describing with the CANONICAL spine linkCard —
// see docs/memos/action-menu-anchor-bugs/REVIEW.md — but that is a pre-existing
// CSS-vs-spine inconsistency out of scope for this fix.)
// ─────────────────────────────────────────────────────────────────────────────

/** The present `linkedAnchor` marks in the doc, keyed by anchorId. */
interface PresentMark {
  kind: string;
  linkCard: string;
  tintColor: string | null;
}

function collectPresentMarks(editor: Editor): Map<string, PresentMark> {
  const present = new Map<string, PresentMark>();
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      const anchorId = m.attrs.anchorId as string | undefined;
      if (!anchorId) continue;
      // First run carrying the anchorId wins (the mark is contiguous).
      if (present.has(anchorId)) continue;
      present.set(anchorId, {
        kind: typeof m.attrs.kind === "string" ? m.attrs.kind : "",
        linkCard: typeof m.attrs.linkCard === "string" ? m.attrs.linkCard : "",
        tintColor:
          typeof m.attrs.tintColor === "string" && m.attrs.tintColor
            ? m.attrs.tintColor
            : null,
      });
    }
    return true;
  });
  return present;
}

/**
 * Re-apply / reconcile every Mode-B record's `linkedAnchor` mark from the
 * sidecar. See the module header for the absent / disagrees / agrees policy.
 */
export function applyLinkedAnchorsImpl(
  editor: Editor,
  records: ModeBReapplyRecord[],
): void {
  if (!editor) return;
  const present = collectPresentMarks(editor);

  for (const rec of records) {
    if (!rec.anchorId || !rec.text) continue;
    const live = present.get(rec.anchorId);

    if (!live) {
      // Absent (mark lost across the parse): re-stamp from the snapshot text.
      // Pass NO cardId → `reanchorByText` leaves `linkCard` empty (see the
      // linkCard-policy note above); it carries the kind + kind-derived tint and
      // sets `addToHistory:false`.
      reanchorByText(
        editor,
        rec.kind,
        rec.text,
        rec.anchorId,
        undefined, // no cardId → linkCard "" (kind-fallback drives colour + consumer kind)
        rec.tintColor,
        rec.paragraphId, // consumed in Chip 6 (uuid-scoped search)
      );
      continue;
    }

    // Present: the sidecar `kind`/`tintColor` are authoritative over the parser's
    // hardcoded `note`/null. `linkCard` is PRESERVED (not compared, not derived)
    // — see the linkCard-policy note above.
    const expectedTint = rec.tintColor ?? null;
    if (live.kind === rec.kind && live.tintColor === expectedTint) continue; // idempotent

    // Disagrees: re-stamp the existing range IN PLACE with the authoritative
    // kind + tint, preserving the live `linkCard`. The parser already placed the
    // boundaries by `\vlid` — resolve the live range by anchorId and over-write.
    const range = resolveTextRangeByAnchorId(editor, rec.anchorId);
    if (!range) continue;
    editor
      .chain()
      // Load-time correction: not an undoable user edit.
      .command(({ tr }) => {
        tr.setMeta("addToHistory", false);
        return true;
      })
      .setTextSelection(range)
      .setMark("linkedAnchor", {
        anchorId: rec.anchorId,
        kind: rec.kind,
        linkId: rec.anchorId,
        linkKind: "anchor",
        linkCard: live.linkCard, // preserve (parser default "" on load; never clobber)
        tintColor: expectedTint,
      })
      .setTextSelection(range.from)
      .run();
  }
}
