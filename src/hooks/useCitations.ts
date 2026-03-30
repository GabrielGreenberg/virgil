"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  serializeBibFile,
  parseNatbibCommand,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";

const EMPTY: CitationsState = { citations: [], bibPath: "", citationStyle: "apa" };

export function useCitations(docId: string | null) {
  const [state, setState] = useState<CitationsState>(EMPTY);
  const [bibEntries, setBibEntries] = useState<BibEntry[]>([]);
  const [bibRaw, setBibRaw] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const docRef = useRef(docId);

  // Load citations state
  useEffect(() => {
    docRef.current = docId;
    if (!docId) {
      setState(EMPTY);
      setBibEntries([]);
      setBibRaw("");
      return;
    }
    fetch(`/api/citations?docId=${docId}`)
      .then((r) => r.json())
      .then((data: CitationsState) => {
        if (docRef.current === docId && data.citations) setState(data);
      })
      .catch(() => {});
  }, [docId]);

  // Load .bib file
  useEffect(() => {
    if (!docId) return;
    fetch(`/api/bib?docId=${docId}`)
      .then((r) => r.json())
      .then((data: { bibText: string }) => {
        if (docRef.current === docId) {
          setBibRaw(data.bibText || "");
          if (data.bibText) {
            try {
              setBibEntries(parseBibFile(data.bibText));
            } catch {
              setBibEntries([]);
            }
          }
        }
      })
      .catch(() => {});
  }, [docId]);

  const persistState = useCallback(async (s: CitationsState) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await fetch(`/api/citations?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
    } catch (err) {
      console.error("Failed to save citations:", err);
    }
  }, []);

  const persistBib = useCallback(async (text: string) => {
    const id = docRef.current;
    if (!id) return;
    try {
      await fetch(`/api/bib?docId=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibText: text }),
      });
    } catch (err) {
      console.error("Failed to save bib:", err);
    }
  }, []);

  const addCitation = useCallback(
    (command: string, existingId?: string): CitationRef => {
      const parsed = parseNatbibCommand(command);
      const ref: CitationRef = {
        id: existingId || uuid(),
        command,
        keys: parsed?.keys || [],
        createdAt: new Date().toISOString(),
      };
      setState((prev) => {
        // Don't add if already exists
        if (prev.citations.some((c) => c.id === ref.id)) return prev;
        const next = { ...prev, citations: [...prev.citations, ref] };
        persistState(next);
        return next;
      });
      return ref;
    },
    [persistState]
  );

  const updateCitation = useCallback(
    (id: string, command: string) => {
      const parsed = parseNatbibCommand(command);
      setState((prev) => {
        const next = {
          ...prev,
          citations: prev.citations.map((c) =>
            c.id === id ? { ...c, command, keys: parsed?.keys || c.keys } : c
          ),
        };
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const deleteCitation = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { ...prev, citations: prev.citations.filter((c) => c.id !== id) };
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const setStyle = useCallback(
    (style: string) => {
      setState((prev) => {
        const next = { ...prev, citationStyle: style };
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const updateBibEntry = useCallback(
    (key: string, fields: Record<string, string>) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (e.key !== key) return e;
          const updated = { ...e, fields: { ...e.fields, ...fields } };
          // Rebuild raw from fields
          const lines = Object.entries(updated.fields)
            .map(([k, v]) => `  ${k} = {${v}}`)
            .join(",\n");
          updated.raw = `@${updated.type}{${updated.key},\n${lines}\n}`;
          return updated;
        });
        // Persist to .bib file
        const newRaw = serializeBibFile(next);
        setBibRaw(newRaw);
        persistBib(newRaw);
        return next;
      });
    },
    [persistBib]
  );

  const getBibEntry = useCallback(
    (key: string): BibEntry | undefined => {
      return bibEntries.find((e) => e.key === key);
    },
    [bibEntries]
  );

  const getDisplayText = useCallback(
    (command: string): string => {
      return formatInlineCitation(command, bibEntries);
    },
    [bibEntries]
  );

  const getFormattedBib = useCallback(
    (entry: BibEntry): string => {
      return formatBibliography(entry, state.citationStyle);
    },
    [state.citationStyle]
  );

  /** Replace all citations from editor state (source of truth on load) */
  const syncFromEditor = useCallback(
    (editorCitations: Array<{ citationId: string; command: string }>) => {
      const refs: CitationRef[] = editorCitations.map((ec) => {
        const parsed = parseNatbibCommand(ec.command);
        return {
          id: ec.citationId,
          command: ec.command,
          keys: parsed?.keys || [],
          createdAt: new Date().toISOString(),
        };
      });
      setState((prev) => {
        const next = { ...prev, citations: refs };
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  return {
    citations: state.citations,
    bibPath: state.bibPath,
    citationStyle: state.citationStyle,
    bibEntries,
    bibRaw,
    addCitation,
    updateCitation,
    deleteCitation,
    setStyle,
    updateBibEntry,
    getBibEntry,
    getDisplayText,
    getFormattedBib,
    syncFromEditor,
  };
}
