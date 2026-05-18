"use client";

import { useCallback } from "react";
import { generateEntityId } from "@/lib/uuid";
import { readSidecar } from "@/lib/storage";
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
  const { state, setState, update } = usePersistentState<BibSettings>(
    docId,
    "bib-settings.json",
    EMPTY,
    { migrate, errorLabel: "bib settings" },
  );

  /** Re-read the sidecar from disk. Used when another pane edits it. */
  const refresh = useCallback(() => {
    if (!docId) return;
    readSidecar<BibSettings>(docId, "bib-settings.json", EMPTY)
      .then((data) => setState(migrate(data)))
      .catch(() => {});
  }, [docId, setState]);

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
