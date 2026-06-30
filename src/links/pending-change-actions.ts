/**
 * Phase 1c — the shared Keep / Revert orchestration for an applied pending AI
 * change.
 *
 * Phase 1b put Apply/Keep/Revert closures inside `revisions-host` /
 * `cutter-host`, where the card surface drives them. Phase 1c adds a SECOND
 * driver — the persistent margin-gutter control (the `pending-change` marker,
 * built in `EditorPane`). To keep the two drivers byte-identical (and avoid a
 * third copy when the floating pill lands), the Keep/Revert side-effect
 * SEQUENCE — splice the doc, text-first `.tex` flush, then flip card state —
 * lives here as two pure functions over an explicit deps bag.
 *
 * These do NOT own the flag gate or the editor-mounted check: each caller
 * already guards `isPendingChangesOn() && editorInstance` (the host closures and
 * the EditorPane marker bridge both bail early when the flag is OFF, so flag-OFF
 * stays byte-identical — no pending-change marker is ever emitted, and these are
 * never reached). They DO own the `appliedChange`-presence check, since a stale
 * double-click (Keep after Keep) must no-op rather than re-splice.
 *
 * REUSE, don't reinvent: the actual doc mutation is `keepPendingChange` /
 * `revertPendingChange` from `apply-suggestion.ts` (the same functions Phase 1b
 * calls); this module only sequences them with the `.tex` flush and the card
 * state transitions the hosts already performed inline.
 */

import type { Editor } from "@tiptap/react";
import {
  applyPendingChange,
  keepPendingChange,
  revertPendingChange,
  type PendingChangeFamily,
} from "@/links/apply-suggestion";
import { flushPendingForDoc } from "@/lib/multi-window/pending-saves";
import { getLinkedTextObjectIds, type CardWithLinks } from "@/links/links";

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

/** The card-state mutators + lookup the Keep/Revert sequence drives. Both
 *  `useRevisions` and `useCutter` expose exactly this surface (the host
 *  closures already call these), so a host or the EditorPane marker passes its
 *  hook's methods straight through. Generic over the suggestion status union so
 *  each family keeps its own literal type. */
export interface PendingChangeCardDeps<TStatus extends string = string> {
  /** Resolve the card's applied-splice descriptor by id, or `undefined` when
   *  the card isn't an applied suggestion (already kept / reverted / wrong
   *  kind). Returning `undefined` makes the action a safe no-op. */
  getAppliedChange: (id: string) => AppliedChangeDescriptor | undefined;
  setSuggestionStatus: (id: string, status: TStatus) => void;
  setArchived: (id: string, archived: boolean) => void;
  setAppliedChange: (id: string, appliedChange: undefined) => void;
  deleteCard: (id: string) => void;
  /** The accepted-status literal for this family (always `"accepted"`; passed
   *  explicitly so the generic status union is satisfied without a cast). */
  acceptedStatus: TStatus;
}

/**
 * Keep (finalize) the applied pending change for card `id`.
 *
 * Text-first ordering: splice the doc, flush the `.tex` BEFORE flipping card
 * state, so the finalized splice is on disk ahead of the sidecar status change.
 * No-ops when the card has no `appliedChange` (stale double-Keep).
 */
export function keepSuggestion<TStatus extends string>(
  editor: Editor,
  id: string,
  docId: string | null,
  deps: PendingChangeCardDeps<TStatus>,
): void {
  const ac = deps.getAppliedChange(id);
  if (!ac) return;
  keepPendingChange(editor, {
    anchorUuid: ac.anchorUuid,
    mode: ac.mode,
    anchorId: ac.anchorId,
    originalText: ac.originalText,
    replacement: ac.replacement,
  });
  if (docId) void flushPendingForDoc(docId).catch(() => {});
  deps.setSuggestionStatus(id, deps.acceptedStatus);
  deps.setArchived(id, true);
  deps.setAppliedChange(id, undefined);
}

/**
 * Revert (undo) the applied pending change for card `id` — restores the
 * paragraph and deletes the suggestion card. No-ops when there's no
 * `appliedChange` (stale double-Revert).
 */
export function revertSuggestion<TStatus extends string>(
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
  if (docId) void flushPendingForDoc(docId).catch(() => {});
  deps.deleteCard(id);
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
