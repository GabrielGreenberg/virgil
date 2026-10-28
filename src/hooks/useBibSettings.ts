"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import type { BibSettings, BibEntryRequest } from "@/lib/types";
import { usePersistentState } from "./usePersistentState";

const EMPTY: BibSettings = { generalBibPath: null, entryRequests: [] };

function migrate(raw: unknown): BibSettings {
  const s = raw as Partial<BibSettings>;
  return {
    // Legacy field — preserved on read so old sidecars round-trip, but
    // never set from the UI anymore. See [BibliographyPanel.tsx] notes.
    generalBibPath: s.generalBibPath ?? null,
    entryRequests: Array.isArray(s.entryRequests) ? s.entryRequests : [],
  };
}

export function useBibSettings(docId: string | null) {
  const { state, update, reread } = usePersistentState<BibSettings>(
    docId,
    "bib-settings.json",
    EMPTY,
    { migrate, errorLabel: "bib settings" },
  );

  /**
   * Re-read the sidecar from disk (the AI window's Refresh). The shared re-read
   * policy (task 1332): deferred while a write is armed or in flight, merged —
   * never adopted — so a just-filed entry request survives a Refresh.
   */
  const refresh = reread;

  const addEntryRequest = useCallback(
    (description: string) => {
      const req: BibEntryRequest = {
        id: generateEntityId(),
        description,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      update((prev) => ({ ...prev, entryRequests: [...prev.entryRequests, req] }));
    },
    [update],
  );

  const removeEntryRequest = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        entryRequests: prev.entryRequests.filter((r) => r.id !== id),
      }));
    },
    [update],
  );

  return {
    entryRequests: state.entryRequests,
    addEntryRequest,
    removeEntryRequest,
    refresh,
  };
}
