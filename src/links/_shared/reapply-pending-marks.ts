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
 * `#bfdbfe` tint, same `<family>:<cardId>` linkCard token, same delete-mode
 * `data-pending-delete` strikethrough signal). The family — `revision-suggestion`
 * or `cutter-suggestion` — is NOT recoverable from the shared `pending-ai-change`
 * kind, so the CALLER (EditorPane, which knows revision vs cutter cards) tags each
 * card's family; the re-stamp threads it into `reanchorByText`'s explicit
 * `linkCardToken` so the cutter halo resolves on reload too (Phase 4, Part A). The
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
import type { PendingChangeFamily } from "@/links/apply-suggestion";

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
  /** The owning card id — stamped into the mark's `linkCard` token, paired with
   *  `family` to form `<family>:<cardId>` (same as apply). */
  cardId: string;
  /** The owning suggestion family — the `linkCard` token prefix. Tagged by the
   *  caller (which knows revision vs cutter); NOT derivable from the shared
   *  `pending-ai-change` kind, so it's carried explicitly so the cutter halo
   *  resolves on reload (Phase 4, Part A). */
  family: PendingChangeFamily;
  /** The doc text the mark wraps: `replacement` (mode "replace") or
   *  `originalText` (mode "delete" — the struck text is still in the paragraph). */
  text: string;
  /** Whether this is a pending DELETION — drives the `data-pending-delete`
   *  strikethrough signal on the re-stamped mark (Phase 4, Part B). */
  pendingDelete: boolean;
}

/** A family-tagged card group — the caller (EditorPane) passes the revision and
 *  cutter card collections each tagged with their family, so the re-stamp can
 *  carry the right `linkCard` token without re-deriving family from the kind. */
export interface PendingMarkCardGroup {
  family: PendingChangeFamily;
  cards: ReadonlyArray<PendingMarkCardLike>;
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
 * Build the re-stamp record set from family-tagged card groups. Pure — separated
 * from the editor dispatch so a test can assert the record set without mounting an
 * editor, mirroring `buildModeBReapplyRecords`. Skips cards whose stored text is
 * empty (nothing to locate). Gated on `isPendingChangesOn()` (flag-OFF → []).
 * Each record carries its group's `family` (the `linkCard` token) and the
 * mode-derived `pendingDelete` flag.
 */
export function buildPendingMarkReapplyRecords(
  groups: ReadonlyArray<PendingMarkCardGroup>,
): PendingMarkReapplyRecord[] {
  const records: PendingMarkReapplyRecord[] = [];
  if (!isPendingChangesOn()) return records;
  for (const group of groups) {
    for (const c of group.cards) {
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
        family: group.family,
        text,
        pendingDelete: ac.mode === "delete",
      });
    }
  }
  return records;
}

/**
 * Re-stamp the `pending-ai-change` mark for every applied suggestion in `groups`,
 * via the SAME `reanchorByText` primitive the applicator uses — threading each
 * record's `family` (the explicit `linkCard` token) and the `pendingDelete`
 * strikethrough signal so the reloaded mark is byte-identical to apply's. Returns
 * the number of records processed (for no-op short-circuits / tests). A record
 * whose stored text no longer matches the live paragraph is a graceful no-op
 * (reanchorByText → null). Gated on `isPendingChangesOn()` (flag-OFF → 0).
 */
export function reapplyPendingMarks(
  editor: Editor,
  groups: ReadonlyArray<PendingMarkCardGroup>,
): number {
  if (!editor || editor.isDestroyed) return 0;
  const records = buildPendingMarkReapplyRecords(groups);
  for (const rec of records) {
    reanchorByText(
      editor,
      PENDING_KIND,
      rec.text,
      rec.anchorId,
      rec.cardId,
      PENDING_TINT,
      rec.anchorUuid,
      { linkCardToken: rec.family, pendingDelete: rec.pendingDelete },
    );
  }
  return records.length;
}
