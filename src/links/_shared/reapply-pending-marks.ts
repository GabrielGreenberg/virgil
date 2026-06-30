/**
 * Load-time re-stamp of the light-blue `pending-ai-change` `linkedAnchor` mark
 * for every applied-but-not-yet-kept suggestion (the reload-persistence half of
 * the pending-AI-changes feature).
 *
 * WHY a sibling, not the Mode-B pass. `linkedAnchor` marks are app-state: the
 * serializer strips them on `.tex` export and the load reconcile re-applies them
 * from the sidecar. The Mode-B reconcile (`reapply-mode-b-anchors.ts`) re-stamps
 * a card's mark from its *text-range anchor* (`getTextAnchor` → a `linkedRange`
 * link). A pending mark is NOT a text-range anchor — it is described by the
 * separate `appliedChange` descriptor a `status:"applied"` revision/cutter
 * suggestion carries:
 *
 *   { anchorId, anchorUuid, originalText, replacement, mode }
 *
 * Its `anchorId` (`appliedChange.anchorId`) and containing-paragraph uuid
 * (`appliedChange.anchorUuid`) come from that descriptor, not from `links[]`, and
 * its snapshot text is `replacement` (mode "replace") or `originalText` (mode
 * "delete" — the struck text is still in the paragraph). None of that fits the
 * `ModeBReapplyRecord` shape, so this lives as a dedicated reconciler that runs
 * in the SAME load phase (right after the Mode-B reapply, before the per-panel
 * reconciles and the orphan reaper).
 *
 * Re-stamping reuses the EXACT primitive the applicator uses — `reanchorByText`
 * with kind `"pending-ai-change"` and the crosswalk-derived blue tint — so the
 * reloaded mark is byte-identical to the one apply originally stamped (same
 * `#bfdbfe` tint, same `revision-suggestion:<cardId>` linkCard token). The
 * search is uuid-scoped to `appliedChange.anchorUuid`, so a span that recurs
 * elsewhere isn't mis-marked; if the stored text no longer matches (the user
 * edited it post-apply), `reanchorByText` returns null and the re-stamp is a
 * graceful no-op (no blue) — acceptable per the feature spec.
 *
 * LOAD-ONLY / keystroke-safe. Invoked once per doc-open from the EditorPane
 * load-reconcile effect (latched on `modeAReconciledDocRef`), NOT a keystroke
 * subscriber. The card scan is O(applied-suggestions) at load, never per
 * transaction. The whole pass is gated on `isPendingChangesOn()`: flag-OFF no
 * card ever reaches `status:"applied"` (no apply path runs), so this produces
 * zero records and stamps nothing — byte-identical to pre-feature behaviour.
 */

import type { Editor } from "@tiptap/react";
import { reanchorByText } from "../links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";

/** The legacy `linkedAnchor.kind` namespace value for a pending AI change — the
 *  same constant the applicator stamps (apply-suggestion.ts `PENDING_KIND`). */
const PENDING_KIND = "pending-ai-change" as const;

/** The blue tint, single-sourced from the crosswalk so apply / keep / revert and
 *  this reload re-stamp all agree (`#bfdbfe`). */
const PENDING_TINT = defaultTintForLinkedAnchorKind(PENDING_KIND);

/** The applied-splice descriptor a `status:"applied"` suggestion card carries.
 *  Structurally identical to `RevisionSuggestionCard.appliedChange` ≡
 *  `CutterSuggestionCard.appliedChange` ≡ `AppliedChangeDescriptor`. */
interface AppliedChangeLike {
  anchorId: string;
  anchorUuid: string;
  originalText: string;
  replacement: string;
  mode: "replace" | "delete";
}

/** The minimal card shape this reconciler reads: an applied suggestion exposes
 *  `kind:"suggestion"`, `status:"applied"`, and an `appliedChange` descriptor.
 *  Both `RevisionSuggestionCard` and `CutterSuggestionCard` structurally satisfy
 *  this (read-only — we never mutate the card). */
export interface PendingMarkCardLike {
  id: string;
  kind?: string;
  status?: string;
  appliedChange?: AppliedChangeLike;
}

/** One re-stamp instruction, pre-resolved from a card's `appliedChange`. */
export interface PendingMarkReapplyRecord {
  /** The anchorId to stamp on the re-applied mark (so Keep/Revert resolve the
   *  same range the original apply created). */
  anchorId: string;
  /** The containing-paragraph uuid — scopes `reanchorByText`'s text search. */
  anchorUuid: string;
  /** The owning card id — stamped into the mark's `linkCard` token (folds onto
   *  the `revision-suggestion:` spine, same as apply). */
  cardId: string;
  /** The doc text the mark wraps: `replacement` (mode "replace") or
   *  `originalText` (mode "delete" — the struck text is still in the paragraph). */
  text: string;
}

/**
 * The anchorIds of every pending mark that WILL be (or was) re-stamped, so the
 * load-time + in-session orphan reapers don't strip it. The reaper's alive-set
 * is built from card *text anchors* (`getTextAnchor`), which never include the
 * `appliedChange.anchorId` — without this the freshly re-stamped pending mark
 * would be reaped as an orphan on the same load pass.
 *
 * Gated on `isPendingChangesOn()`: flag-OFF → empty set (no applied cards exist).
 */
export function pendingMarkAnchorIds(
  cards: ReadonlyArray<PendingMarkCardLike>,
): Set<string> {
  const ids = new Set<string>();
  if (!isPendingChangesOn()) return ids;
  for (const c of cards) {
    if (c.kind === "suggestion" && c.status === "applied" && c.appliedChange) {
      ids.add(c.appliedChange.anchorId);
    }
  }
  return ids;
}

/**
 * Build the re-stamp record set from a card collection. Pure — separated from
 * the editor dispatch so a test can assert the record set without mounting an
 * editor, mirroring `buildModeBReapplyRecords`. Skips cards whose stored text is
 * empty (nothing to locate). Gated on `isPendingChangesOn()` (flag-OFF → []).
 */
export function buildPendingMarkReapplyRecords(
  cards: ReadonlyArray<PendingMarkCardLike>,
): PendingMarkReapplyRecord[] {
  const records: PendingMarkReapplyRecord[] = [];
  if (!isPendingChangesOn()) return records;
  for (const c of cards) {
    if (c.kind !== "suggestion" || c.status !== "applied") continue;
    const ac = c.appliedChange;
    if (!ac) continue;
    // mode "replace": the blue wraps the inserted `replacement`.
    // mode "delete":  the text was never cut, so the blue wraps `originalText`
    //                 (still present in the paragraph) — a pending-delete preview.
    const text = ac.mode === "delete" ? ac.originalText : ac.replacement;
    if (!text) continue;
    records.push({
      anchorId: ac.anchorId,
      anchorUuid: ac.anchorUuid,
      cardId: c.id,
      text,
    });
  }
  return records;
}

/**
 * Re-stamp the `pending-ai-change` mark for every applied suggestion in `cards`,
 * via the SAME `reanchorByText` primitive the applicator uses. Returns the number
 * of records processed (for no-op short-circuits / tests). A record whose stored
 * text no longer matches the live paragraph is a graceful no-op (reanchorByText
 * → null). Gated on `isPendingChangesOn()` (flag-OFF → 0, nothing stamped).
 */
export function reapplyPendingMarks(
  editor: Editor,
  cards: ReadonlyArray<PendingMarkCardLike>,
): number {
  if (!editor || editor.isDestroyed) return 0;
  const records = buildPendingMarkReapplyRecords(cards);
  for (const rec of records) {
    reanchorByText(
      editor,
      PENDING_KIND,
      rec.text,
      rec.anchorId,
      rec.cardId,
      PENDING_TINT,
      rec.anchorUuid,
    );
  }
  return records.length;
}
