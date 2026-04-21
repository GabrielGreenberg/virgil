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

  const setGeneralBibPath = useCallback(
    (path: string | null) => {
      update((prev) => ({ ...prev, generalBibPath: path }));
    },
    [update],
  );

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
    generalBibPath: state.generalBibPath,
    entryRequests: state.entryRequests,
    setGeneralBibPath,
    addEntryRequest,
    removeEntryRequest,
    refresh,
  };
}
