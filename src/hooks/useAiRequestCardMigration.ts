"use client";

import { useEffect } from "react";
import { generateEntityId } from "@/lib/uuid";
import { migrateUnlinkedCardRequests } from "@/lib/migrate-ai-request-cards";
import type { AiRequest, TodoItem, UserNote } from "@/lib/types";

/**
 * BUG #55b (part b) — one-time, idempotent migration that subsumes any
 * pre-existing UNLINKED `note` / `todo` `ai-requests.json` entry into the
 * per-card model, so retiring the legacy `"ai"` CardKind (the old per-panel
 * `AiRequestCard`) doesn't strand them.
 *
 * Each convertible request becomes a real Note/Todo card (carrying
 * `aiRequest: true`) plus an in-place re-link of the request at that card —
 * the exact on-disk shape the card-flag bridge produces. See
 * `migrate-ai-request-cards.ts` for the pure transform (and which kinds are in
 * scope). footnote/citation/suggestion/report requests are left in the
 * AIWindow.
 *
 * Runs ONCE per docId per session via a module-level guard set synchronously
 * before any work, so concurrent hook instances (StrictMode double-invoke,
 * the EditorLayout parity mounts) can't double-convert. Re-runs after the
 * dependency-driven state update bail on the guard; a genuine reload finds the
 * requests already linked on disk and converts nothing (idempotent).
 */
const migratedDocs = new Set<string>();

/**
 * The read state of ONE sidecar, in the shape both sidecar primitives publish
 * it (`usePersistentState`, and since task 679 `useAiRequests` too).
 */
export interface SidecarReadState {
  loaded: boolean;
  loadError: boolean;
}

/**
 * **Is what this migration derives from TRUE?** (task 679)
 *
 * The one owner of the question, rather than a conjunction spelled out at the
 * call site — because the conjunction that is WRONG (`a.loaded && b.loaded &&
 * c.loaded`) is shorter and reads better than the one that is right, and the
 * call site is a six-thousand-line component. A source is authoritative only if
 * its initial read both TERMINATED and SUCCEEDED: `loaded` alone is `true` for
 * a read that threw, and such a source holds the EMPTY DEFAULT, which for a
 * collection means "we don't know", never "there is nothing".
 *
 * Every AUTOMATIC write derived from sidecar collections owes this question —
 * this is the migration's, the sibling of `anyCardSidecarLoadError`'s in
 * `EditorPane` (the orphan reaper's).
 */
export function sourcesAreAuthoritative(
  ...sources: SidecarReadState[]
): boolean {
  return sources.every((s) => s.loaded && !s.loadError);
}

export interface AiRequestCardMigrationApi {
  docId: string | null;
  /**
   * All three source sidecars' initial reads have finished **and SUCCEEDED**
   * (task 679).
   *
   * NOT "the reads terminated". `usePersistentState` (and now `useAiRequests`)
   * flips `loaded` on a read that THREW as well as on one that succeeded, and
   * an errored read leaves its collection at the EMPTY DEFAULT — so
   * `notes.loaded && todos.loaded && aiRequests.loaded` is true in exactly the
   * state where this migration is at its most destructive. It is an AUTOMATIC
   * write (an effect, no user gesture) into THREE sidecars at once, and
   * `usePersistentState.update()` persists unconditionally: mint from a
   * failed-read empty request list and `notes.json` is rewritten as only the
   * minted cards, destroying every note in the paper by a write the user never
   * asked for.
   *
   * Hence the name. The question this door needs answered is not "did the read
   * finish" but "is what I am about to derive from TRUE", and a boolean called
   * `ready` invites the first conjunction and not the second. The caller owes
   * `loaded && !loadError` for all three.
   */
  sourcesAuthoritative: boolean;
  aiRequests: AiRequest[];
  appendNotes: (cards: UserNote[]) => void;
  appendTodos: (items: TodoItem[]) => void;
  relinkRequests: (updated: AiRequest[]) => void;
}

export function useAiRequestCardMigration({
  docId,
  sourcesAuthoritative,
  aiRequests,
  appendNotes,
  appendTodos,
  relinkRequests,
}: AiRequestCardMigrationApi): void {
  useEffect(() => {
    // STAND DOWN before the claim, never after: a session that could not read
    // one of the three sources must not burn the doc's one-per-session
    // migration chance, or a later good read in the same session (a re-hydrate,
    // a doc switch back) would find the doc already claimed and skip a
    // migration that was never performed.
    if (!docId || !sourcesAuthoritative) return;
    if (migratedDocs.has(docId)) return;
    // Claim the doc synchronously BEFORE any state writes so a sibling hook
    // instance reaching this effect in the same tick bails immediately.
    migratedDocs.add(docId);

    const result = migrateUnlinkedCardRequests(aiRequests, {
      genId: generateEntityId,
      now: () => new Date().toISOString(),
    });
    if (!result.changed) return;

    appendNotes(result.addedNotes);
    appendTodos(result.addedTodos);
    relinkRequests(result.relinkedRequests);
  }, [
    docId,
    sourcesAuthoritative,
    aiRequests,
    appendNotes,
    appendTodos,
    relinkRequests,
  ]);
}

/** Test-only: clear the per-session run guard. */
export function __resetAiRequestCardMigrationForTests(): void {
  migratedDocs.clear();
}
