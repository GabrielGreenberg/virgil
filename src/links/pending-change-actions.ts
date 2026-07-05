/**
 * The shared applied-pending-change orchestration — the 3-axis control surface
 * (SESSION 4) behind every driver (card body, margin-gutter marker, floating
 * pill, omni bulk):
 *
 *   - COMMIT: `keepSuggestion` (Check — finalize the suggested text) and
 *     `dismissSuggestion` (Cross — DISMISS-PRESERVES: byte-restore the original
 *     + archive the card & its comment; NEVER hard-deletes).
 *   - NON-COMMITTING PREVIEW: `previewOriginal` / `previewSuggested` flip the
 *     LIVE doc text in place (via the same inverse splices) WITHOUT touching card
 *     status / archived / appliedChange, recording the direction in the transient
 *     `pending-preview-store` so a mid-preview commit stays deterministic.
 *
 * Keeping all four verbs on ONE sequence over an explicit deps bag is what lets
 * every surface inherit them without a per-surface copy (the pre-SESSION-4
 * design already deduped Keep/Revert this way).
 *
 * These do NOT own the flag gate or the editor-mounted check: each caller
 * already guards `isPendingChangesOn() && editorInstance` (flag-OFF stays
 * byte-identical — no applied card ever exists, so these are never reached).
 * They DO own the `appliedChange`-presence check, since a stale double-click
 * (Keep after Keep) must no-op rather than re-splice.
 *
 * COMMIT DETERMINISM: Check / Cross reconcile from the canonical `appliedChange`,
 * NOT the transient preview — Check re-applies the suggested view before keeping
 * when the user is mid-preview on the original; Cross's revert splice is
 * idempotent from either direction.
 *
 * REUSE, don't reinvent: the actual doc mutation is `applyPendingChange` /
 * `keepPendingChange` / `revertPendingChange` from `apply-suggestion.ts`; this
 * module only sequences them with the `.tex` flush, the preview-dir bookkeeping,
 * and the card-state transitions.
 */

import type { Editor } from "@tiptap/react";
import {
  applyPendingChange,
  keepPendingChange,
  revertPendingChange,
  insertParagraphAfter,
  type PendingChangeFamily,
} from "@/links/apply-suggestion";
import { flushPendingForDoc } from "@/lib/multi-window/pending-saves";
import {
  getLinkedTextObjectIds,
  removeLinkedAnchor,
  type CardWithLinks,
} from "@/links/links";
import {
  getPreviewDir,
  resetPreviewDir,
  setPreviewDir,
} from "@/links/pending-preview-store";

/** The applied-splice descriptor a `status:"applied"` suggestion card carries
 *  (`RevisionSuggestionCard.appliedChange` ≡ `CutterSuggestionCard.appliedChange`
 *  — identical shape across both families). */
export interface AppliedChangeDescriptor {
  anchorId: string;
  anchorUuid: string;
  originalText: string;
  replacement: string;
  mode: "replace" | "delete";
  appliedAt: string;
}

/** The card-state mutators + lookup the commit / preview sequence drives. Both
 *  `useRevisions` and `useCutter` expose exactly this surface (the host
 *  closures already call these), so a host or the EditorPane marker passes its
 *  hook's methods straight through. Generic over the suggestion status union so
 *  each family keeps its own literal type. */
export interface PendingChangeCardDeps<TStatus extends string = string> {
  /** Resolve the card's applied-splice descriptor by id, or `undefined` when
   *  the card isn't an applied suggestion (already kept / dismissed / wrong
   *  kind). Returning `undefined` makes the action a safe no-op. */
  getAppliedChange: (id: string) => AppliedChangeDescriptor | undefined;
  setSuggestionStatus: (id: string, status: TStatus) => void;
  setArchived: (id: string, archived: boolean) => void;
  setAppliedChange: (id: string, appliedChange: undefined) => void;
  /** The card's suggestion family — needed to RE-STAMP the blue mark when a
   *  commit / preview re-applies the suggested view (so a cutter change tokens
   *  `cutter-suggestion:<id>`, a revision `revision-suggestion:<id>`). */
  family: PendingChangeFamily;
  /** The accepted-status literal for this family (always `"accepted"`; passed
   *  explicitly so the generic status union is satisfied without a cast). */
  acceptedStatus: TStatus;
  /** The rejected-status literal for this family (always `"rejected"`) — the
   *  status a DISMISSED-but-preserved suggestion carries. */
  rejectedStatus: TStatus;
}

/** Re-apply the suggested splice + blue mark for the applied change `ac` of card
 *  `id`, from the deps' `family`. Shared by `keepSuggestion`'s reconcile and
 *  `previewSuggested`. */
function reapplySuggested<TStatus extends string>(
  editor: Editor,
  id: string,
  ac: AppliedChangeDescriptor,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  applyPendingChange(editor, {
    anchorUuid: ac.anchorUuid,
    originalText: ac.originalText,
    replacement: ac.replacement,
    mode: ac.mode,
    cardId: id,
    anchorId: ac.anchorId,
    family: deps.family,
  });
}

/**
 * Keep (finalize) the applied pending change for card `id`.
 *
 * Text-first ordering: splice the doc, flush the `.tex` BEFORE flipping card
 * state, so the finalized splice is on disk ahead of the sidecar status change.
 * No-ops when the card has no `appliedChange` (stale double-Keep).
 *
 * RECONCILE: Check always finalizes the SUGGESTED text regardless of the
 * transient preview. If the user is currently previewing the ORIGINAL, re-apply
 * the suggested splice (from the canonical `appliedChange`, NOT the transient
 * doc text) BEFORE `keepPendingChange`, so a mid-preview commit is deterministic.
 */
export function keepSuggestion<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  const ac = deps.getAppliedChange(id);
  if (!ac) return;
  if (getPreviewDir(id) === "original") reapplySuggested(editor, id, ac, deps);
  keepPendingChange(editor, {
    anchorUuid: ac.anchorUuid,
    mode: ac.mode,
    anchorId: ac.anchorId,
    originalText: ac.originalText,
    replacement: ac.replacement,
  });
  resetPreviewDir(id);
  if (docId) void flushPendingForDoc(docId).catch(() => {});
  deps.setSuggestionStatus(id, deps.acceptedStatus);
  deps.setArchived(id, true);
  deps.setAppliedChange(id, undefined);
}

/**
 * Dismiss (decline) the applied pending change for card `id` — DISMISS ALWAYS
 * PRESERVES: byte-restore the original paragraph, then archive the card + its
 * `explanation` comment so nothing is lost (status→rejected, archived→true).
 * NEVER `deleteCard`. No-ops when there's no `appliedChange` (stale double-Cross).
 *
 * `revertPendingChange` is idempotent from either preview direction: from the
 * suggested view it removes the mark + restores the original; from an
 * original-preview (mark already gone, text already original) it no-ops — so
 * Cross deterministically leaves the ORIGINAL regardless of the transient
 * preview (`commit reads appliedChange, not the preview`).
 */
export function dismissSuggestion<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  const ac = deps.getAppliedChange(id);
  if (!ac) return;
  revertPendingChange(editor, {
    anchorUuid: ac.anchorUuid,
    originalText: ac.originalText,
    replacement: ac.replacement,
    mode: ac.mode,
    anchorId: ac.anchorId,
  });
  resetPreviewDir(id);
  if (docId) void flushPendingForDoc(docId).catch(() => {});
  deps.setSuggestionStatus(id, deps.rejectedStatus);
  deps.setArchived(id, true);
  deps.setAppliedChange(id, undefined);
}

/**
 * NON-COMMITTING preview: show the ORIGINAL in the live doc for card `id` —
 * restore the pre-splice text + drop the blue mark, WITHOUT touching card status
 * / `archived` / `appliedChange`. Records the preview direction so the commit
 * path can reconcile and the card body can render the active segment. No-ops
 * when there's no `appliedChange`, or when already previewing the original.
 */
export function previewOriginal<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  const ac = deps.getAppliedChange(id);
  if (!ac) return;
  if (getPreviewDir(id) === "original") return;
  revertPendingChange(editor, {
    anchorUuid: ac.anchorUuid,
    originalText: ac.originalText,
    replacement: ac.replacement,
    mode: ac.mode,
    anchorId: ac.anchorId,
  });
  setPreviewDir(id, "original");
  if (docId) void flushPendingForDoc(docId).catch(() => {});
}

/**
 * NON-COMMITTING preview: show the SUGGESTED view in the live doc for card `id`
 * — re-apply the suggested splice + blue mark, WITHOUT touching card status /
 * `archived` / `appliedChange`. Records the preview direction. No-ops when
 * there's no `appliedChange`, or when already previewing the suggestion.
 */
export function previewSuggested<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  const ac = deps.getAppliedChange(id);
  if (!ac) return;
  if (getPreviewDir(id) === "suggested") return;
  reapplySuggested(editor, id, ac, deps);
  setPreviewDir(id, "suggested");
  if (docId) void flushPendingForDoc(docId).catch(() => {});
}

// ── Insert-below — the third landing verb (retires the 4-field AI fallback) ──
//
// When an AI suggestion can't auto-apply in place (the anchored paragraph was
// "returned" — cut/re-inserted or re-parsed on the writeback, so its resolvable
// text drifted), the pending card used to fall back to the retired 4-field
// revision grid. Gabriel never wants that grid for AI cards. Insert-below is the
// escape hatch: drop the `suggested_text` as a NEW paragraph directly below the
// anchor (non-destructive — the original is never spliced), then retire the card
// (`accepted` + `archived`) so it leaves the active list and can't recycle
// through the auto-apply `pending` filter.

/** The card-state mutators + suggestion lookup `insertSuggestionBelow` drives.
 *  A focused sibling of {@link PendingChangeCardDeps}: the insert needs the
 *  card's replacement text + Mode-A anchor (not just its applied descriptor), so
 *  it resolves the whole suggestion by id. Generic over the family's status
 *  union so each family keeps its literal type. */
export interface InsertBelowCardDeps<TStatus extends string = string> {
  /** Resolve the pending suggestion by id → its replacement text, its Mode-A
   *  anchor uuid (the first linked paragraph), and any applied-splice descriptor
   *  (present only if the card was auto-applied first). `undefined` = not found /
   *  wrong kind → the action is a safe no-op. */
  getSuggestion: (id: string) =>
    | {
        suggestedText: string;
        anchorUuid: string | undefined;
        appliedChange: AppliedChangeDescriptor | undefined;
      }
    | undefined;
  setSuggestionStatus: (id: string, status: TStatus) => void;
  setArchived: (id: string, archived: boolean) => void;
  setAppliedChange: (id: string, appliedChange: undefined) => void;
  /** The accepted-status literal for this family (always `"accepted"`). */
  acceptedStatus: TStatus;
}

/**
 * Insert the suggestion's `suggested_text` as a NEW paragraph directly below its
 * anchored paragraph, then retire the card.
 *
 * Non-destructive: the original paragraph is never spliced — {@link
 * insertParagraphAfter} only inserts a sibling after it, and `BlockUuidBackfill`
 * mints the new paragraph's `%!v:` id. Returns false (no doc/card mutation) when:
 *   - the card isn't resolvable,
 *   - `suggested_text` is blank (a delete/empty cut — nothing to insert), or
 *   - the anchor uuid doesn't resolve in the live doc.
 *
 * On success: if the card had been auto-applied first (an `appliedChange` → a
 * live blue mark), drop that mark + clear the descriptor BEFORE finalizing, so
 * no `pending-ai-change` mark lingers; then flush the `.tex` and flip the card to
 * `accepted` + `archived` (drops it from the auto-apply `pending` filter, so it
 * can't recycle). Text-first ordering mirrors {@link keepSuggestion}.
 */
export function insertSuggestionBelow<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: InsertBelowCardDeps<TStatus>,
): boolean {
  const s = deps.getSuggestion(id);
  if (!s) return false;
  // Nothing to insert (a cutter/delete cut, or an empty revision) → refuse.
  if (s.suggestedText.trim() === "") return false;
  if (!s.anchorUuid) return false;

  const inserted = insertParagraphAfter(editor, s.anchorUuid, s.suggestedText);
  if (!inserted) return false;

  // If the card was auto-applied first, tear down its blue mark + descriptor so
  // nothing lingers (no-op for a never-applied pending card — the common case).
  if (s.appliedChange) {
    removeLinkedAnchor(editor, s.appliedChange.anchorId);
    deps.setAppliedChange(id, undefined);
  }
  if (docId) void flushPendingForDoc(docId).catch(() => {});
  deps.setSuggestionStatus(id, deps.acceptedStatus);
  deps.setArchived(id, true);
  return true;
}

// ── Phase 2 — the shared Apply orchestration ──────────────────────────────
//
// Phase 1b computed `anchorUuid` / `mode` / `anchorId`, called
// `applyPendingChange`, then flipped the card to `applied` + `appliedChange`
// (or `stale`) inside BOTH `revisions-host` and `cutter-host` as byte-identical
// closures. Phase 2 adds a SECOND driver — the keystroke-safe auto-apply hook
// (`useAutoApplyPendingChanges`) — that must run that EXACT sequence. To keep
// the manual Apply button and the auto-apply driver on ONE code path (the same
// dedup Phase 1c did for Keep/Revert), that orchestration lives here.
//
// This owns the flag-OFF / editor-mounted guard NOT — each caller already
// guards `isPendingChangesOn() && editor` before reaching here (the hosts bail,
// and the driver is mounted behind the flag + the reactive `editor`). It DOES
// own everything from "compute the anchor" through "set card state", returning
// a discriminated result so a caller (the driver) can branch on what happened.

/** The minimal suggestion-card shape `applySuggestion` reads: the two
 *  splice-defining text fields, the paragraph links (for the Mode-A anchor),
 *  plus `id` (for `CardWithLinks`). Both `RevisionSuggestionCard` and
 *  `CutterSuggestionCard` structurally satisfy this. */
export interface SuggestionLike extends CardWithLinks {
  id: string;
  original_text: string;
  suggested_text: string;
}

/** Card-state mutators + the anchorId minter the apply sequence drives. Both
 *  `useRevisions` and `useCutter` expose `setSuggestionStatus` / `setAppliedChange`
 *  with these exact signatures; `generateAnchorId` is injected (rather than
 *  imported here) so this module stays free of the uuid dependency and the
 *  caller can stub it in a unit test. Generic over the family's status union. */
export interface ApplySuggestionDeps<TStatus extends string = string> {
  editor: Editor;
  /** The pending suggestion card to apply. */
  card: SuggestionLike;
  /** The card's suggestion family — threaded into the blue mark's `linkCard`
   *  token so a cutter applied change tokens `cutter-suggestion:<id>` and a
   *  revision tokens `revision-suggestion:<id>` (the family is NOT derivable from
   *  the shared `pending-ai-change` kind). The host/hook that owns the card
   *  supplies the literal; the auto-apply driver passes the resolved family
   *  through. */
  family: PendingChangeFamily;
  setSuggestionStatus: (id: string, status: TStatus) => void;
  setAppliedChange: (
    id: string,
    appliedChange: AppliedChangeDescriptor | undefined,
  ) => void;
  /** Mints the anchorId stamped on the blue range (so Keep/Revert can resolve
   *  it later). Injected = `generateEntityId` in app code, a stub in tests. */
  generateAnchorId: () => string;
  /** The `applied` status literal for this family (always `"applied"`; passed
   *  explicitly so the generic union is satisfied without a cast). */
  appliedStatus: TStatus;
  /** The `stale` status literal for this family (always `"stale"`). */
  staleStatus: TStatus;
}

/** What `applySuggestion` did, so the caller (the auto-apply driver) can branch:
 *  - `applied`  — the splice landed; the card is now `applied` + carries an
 *                 `appliedChange` (returned so the driver can track it).
 *  - `stale`    — `applyPendingChange` refused (span not verbatim); the card is
 *                 now `stale`. NEVER retried.
 *  - `skipped`  — no resolvable Mode-A anchor (not applicable); the doc + card
 *                 are untouched. */
export type ApplySuggestionResult =
  | { outcome: "applied"; anchorUuid: string; appliedChange: AppliedChangeDescriptor }
  | { outcome: "stale" }
  | { outcome: "skipped" };

/**
 * Apply a pending suggestion: compute its Mode-A anchor + mode, splice it into
 * the live doc via {@link applyPendingChange}, then transition the card —
 * `applied` + `appliedChange` on success, `stale` on a verbatim-miss. Pure
 * orchestration over the deps bag (no flag read, no editor-mounted check — the
 * caller owns those). The single source of truth shared by the manual Apply
 * button (both hosts) and the auto-apply driver.
 */
export function applySuggestion<TStatus extends string>(
  deps: ApplySuggestionDeps<TStatus>,
): ApplySuggestionResult {
  const { editor, card } = deps;
  // Mode-A anchor: the first linked paragraph uuid. No anchor → not applicable;
  // bail WITHOUT mutating the doc or the card (matches Phase 1b's early return).
  const anchorUuid = getLinkedTextObjectIds(card)[0];
  if (!anchorUuid) return { outcome: "skipped" };

  const mode: "replace" | "delete" =
    card.suggested_text === "" ? "delete" : "replace";
  const anchorId = deps.generateAnchorId();

  const result = applyPendingChange(editor, {
    anchorUuid,
    originalText: card.original_text,
    replacement: card.suggested_text,
    mode,
    cardId: card.id,
    anchorId,
    family: deps.family,
  });

  if (!result.ok) {
    // result.reason === "stale" — no doc mutation happened. Mark + never retry.
    deps.setSuggestionStatus(card.id, deps.staleStatus);
    return { outcome: "stale" };
  }

  const appliedChange: AppliedChangeDescriptor = {
    anchorId: result.anchorId,
    anchorUuid,
    originalText: card.original_text,
    replacement: card.suggested_text,
    mode,
    appliedAt: new Date().toISOString(),
  };
  deps.setSuggestionStatus(card.id, deps.appliedStatus);
  deps.setAppliedChange(card.id, appliedChange);
  return { outcome: "applied", anchorUuid, appliedChange };
}
