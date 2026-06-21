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

export interface AiRequestCardMigrationApi {
  docId: string | null;
  /** All three source sidecars have finished their initial read. */
  ready: boolean;
  aiRequests: AiRequest[];
  appendNotes: (cards: UserNote[]) => void;
  appendTodos: (items: TodoItem[]) => void;
  relinkRequests: (updated: AiRequest[]) => void;
}

export function useAiRequestCardMigration({
  docId,
  ready,
  aiRequests,
  appendNotes,
  appendTodos,
  relinkRequests,
}: AiRequestCardMigrationApi): void {
  useEffect(() => {
    if (!docId || !ready) return;
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
  }, [docId, ready, aiRequests, appendNotes, appendTodos, relinkRequests]);
}

/** Test-only: clear the per-session run guard. */
export function __resetAiRequestCardMigrationForTests(): void {
  migratedDocs.clear();
}
