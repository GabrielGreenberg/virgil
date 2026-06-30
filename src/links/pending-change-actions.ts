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
import { keepPendingChange, revertPendingChange } from "@/links/apply-suggestion";
import { flushPendingForDoc } from "@/lib/multi-window/pending-saves";

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
