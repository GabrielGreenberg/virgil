"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { generateShortId } from "@/lib/uuid";
import { readBib, writeBib } from "@/lib/storage";
import { isUnanchored } from "@/links/links";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  serializeBibFile,
  parseCiteCommand,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";
import { usePersistentState } from "./usePersistentState";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY: CitationsState = {
  citations: [],
  bibPath: "",
  citationStyle: "apa",
  bibPackage: "biblatex",
};

function migrate(raw: unknown): CitationsState {
  const s = raw as Partial<CitationsState>;
  if (!Array.isArray(s.citations)) return EMPTY;
  return {
    citations: s.citations,
    bibPath: s.bibPath ?? "",
    citationStyle: s.citationStyle ?? "apa",
    bibPackage: s.bibPackage ?? "biblatex",
  };
}

export function useCitations(docId: string | null, pristine?: PristineKindApi | null) {
  const {
    state,
    setState,
    update,
    stateRef,
  } = usePersistentState<CitationsState>(docId, "citations.json", EMPTY, {
    migrate,
    errorLabel: "citations",
  });

  // .bib side — lives outside the factory since it's a different sidecar
  // with its own parse/serialize pipeline.
  const [bibEntries, setBibEntries] = useState<BibEntry[]>([]);
  const [bibRaw, setBibRaw] = useState("");
  const docRef = useRef(docId);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) {
      setBibEntries([]);
      setBibRaw("");
      return;
    }
    readBib(docId)
      .then((data) => {
        if (docRef.current !== docId) return;
        setBibRaw(data.bibText || "");
        if (data.bibText) {
          try {
            setBibEntries(parseBibFile(data.bibText));
          } catch {
            setBibEntries([]);
          }
        }
        // Auto-set bib package from tex preamble detection.
        if (data.detectedPackage) {
          setState((prev) => ({ ...prev, bibPackage: data.detectedPackage }));
        }
      })
      .catch(() => {});
  }, [docId, setState]);

  const persistBib = useCallback(async (text: string) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await writeBib(id, text);
    } catch (err) {
      console.error("Failed to save bib:", err);
    }
  }, []);

  const addCitation = useCallback(
    (command: string, existingId?: string, markUnanchored?: boolean): CitationRef => {
      const parsed = parseCiteCommand(command);
      const ref: CitationRef = {
        id: existingId || generateShortId(),
        command,
        keys: parsed?.keys || [],
        createdAt: new Date().toISOString(),
        ...(markUnanchored ? { unanchored: true as const } : {}),
      };
      // Pristine when created with no cite keys (e.g. toolbar "+" insert:
      // `\cite{}`). Once the user fills in a key, updateCitation clears it.
      if (ref.keys.length === 0) pristine?.markNew(ref.id);
      update((prev) => {
        const existing = prev.citations.find((c) => c.id === ref.id);
        if (existing) {
          // Entry already in state. If we're (re)anchoring an
          // unanchored entry — i.e. dragging an unanchored card into
          // the editor — clear the unanchored flag so syncFromEditor
          // won't resurrect it on next reload.
          if (isUnanchored(existing) && !markUnanchored) {
            return {
              ...prev,
              citations: prev.citations.map((c) =>
                c.id === ref.id ? { ...c, unanchored: undefined } : c,
              ),
            };
          }
          return prev;
        }
        return { ...prev, citations: [...prev.citations, ref] };
      });
      return ref;
    },
    [update, pristine],
  );

  const updateCitation = useCallback(
    (id: string, command: string) => {
      const parsed = parseCiteCommand(command);
      if (parsed?.keys && parsed.keys.length > 0) pristine?.markDirty(id);
      update((prev) => ({
        ...prev,
        citations: prev.citations.map((c) =>
          c.id === id ? { ...c, command, keys: parsed?.keys || c.keys } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const deleteCitation = useCallback(
    (id: string) => {
      pristine?.markDirty(id);
      update((prev) => ({
        ...prev,
        citations: prev.citations.filter((c) => c.id !== id),
      }));
    },
    [update, pristine],
  );

  const setStyle = useCallback(
    (style: string) => {
      update((prev) => ({ ...prev, citationStyle: style }));
    },
    [update],
  );

  const setBibPackage = useCallback(
    (pkg: string) => {
      update((prev) => ({ ...prev, bibPackage: pkg }));
    },
    [update],
  );

  const updateBibEntry = useCallback(
    (key: string, fields: Record<string, string>) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== key) return e;
          const updated = { ...e, fields: { ...e.fields, ...fields } };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
    },
    [persistBib],
  );

  const updateBibKeyAndType = useCallback(
    (oldKey: string, newKey: string, newType: string) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== oldKey) return e;
          const updated = { ...e, key: newKey, type: newType };
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
      // Update citation refs that reference the old key.
      if (oldKey !== newKey) {
        update((prev) => ({
          ...prev,
          citations: prev.citations.map((c) => {
            if (!c.keys.includes(oldKey)) return c;
            const newKeys = c.keys.map((k) => (k === oldKey ? newKey : k));
            const newCommand = c.command.replace(
              new RegExp(`\\b${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
              newKey,
            );
            return { ...c, keys: newKeys, command: newCommand };
          }),
        }));
      }
    },
    [persistBib, update],
  );

  const addBibEntry = useCallback(
    (entry: BibEntry) => {
      setBibEntries((prev) => {
        if (prev.some((e) => e.key === entry.key)) return prev;
        const next = [...prev, entry];
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        void persistBib(newRaw);
        return next;
      });
    },
    [persistBib],
  );

  const getBibEntry = useCallback(
    (key: string): BibEntry | undefined => bibEntries.find((e) => e.key === key),
    [bibEntries],
  );

  const getDisplayText = useCallback(
    (command: string): string =>
      formatInlineCitation(command, bibEntries, stateRef.current.bibPackage),
    [bibEntries, stateRef],
  );

  const getFormattedBib = useCallback(
    (entry: BibEntry): string => formatBibliography(entry, state.citationStyle),
    [state.citationStyle],
  );

  /** Sync anchored citations from the editor while preserving unanchored
   *  panel-only citations. The editor regenerates citation ids on each
   *  parse, so prev anchored ids never match new editor ids — they must
   *  be dropped. Only entries flagged via `isUnanchored` are carried
   *  forward. */
  const syncFromEditor = useCallback(
    (editorCitations: Array<{ citationId: string; command: string }>) => {
      const refs: CitationRef[] = editorCitations.map((ec) => {
        const parsed = parseCiteCommand(ec.command);
        return {
          id: ec.citationId,
          command: ec.command,
          keys: parsed?.keys || [],
          createdAt: new Date().toISOString(),
        };
      });
      update((prev) => {
        const unanchored = prev.citations.filter(isUnanchored);
        return { ...prev, citations: [...refs, ...unanchored] };
      });
    },
    [update],
  );

  return {
    citations: state.citations,
    bibPath: state.bibPath,
    citationStyle: state.citationStyle,
    bibPackage: state.bibPackage || "biblatex",
    bibEntries,
    bibRaw,
    addCitation,
    updateCitation,
    deleteCitation,
    setStyle,
    setBibPackage,
    addBibEntry,
    updateBibEntry,
    updateBibKeyAndType,
    getBibEntry,
    getDisplayText,
    getFormattedBib,
    syncFromEditor,
  };
}
