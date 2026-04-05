"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  serializeBibFile,
  parseCiteCommand,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";

const EMPTY: CitationsState = { citations: [], bibPath: "", citationStyle: "apa", bibPackage: "biblatex" };

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
      .then((data: { bibText: string; detectedPackage?: string }) => {
        if (docRef.current === docId) {
          setBibRaw(data.bibText || "");
          if (data.bibText) {
            try {
              setBibEntries(parseBibFile(data.bibText));
            } catch {
              setBibEntries([]);
            }
          }
          // Auto-set bib package from tex preamble detection
          if (data.detectedPackage) {
            setState((prev) => ({ ...prev, bibPackage: data.detectedPackage! }));
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
      const parsed = parseCiteCommand(command);
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
      const parsed = parseCiteCommand(command);
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

  const setBibPackage = useCallback(
    (pkg: string) => {
      setState((prev) => {
        const next = { ...prev, bibPackage: pkg };
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
        persistBib(newRaw);
        return next;
      });
      // Update citation refs that reference the old key
      if (oldKey !== newKey) {
        setState((prev) => {
          const next = {
            ...prev,
            citations: prev.citations.map((c) => {
              if (!c.keys.includes(oldKey)) return c;
              const newKeys = c.keys.map((k) => (k === oldKey ? newKey : k));
              // Replace the old key in the command string
              const newCommand = c.command.replace(
                new RegExp(`\\b${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
                newKey
              );
              return { ...c, keys: newKeys, command: newCommand };
            }),
          };
          persistState(next);
          return next;
        });
      }
    },
    [persistBib, persistState]
  );

  const addBibEntry = useCallback(
    (entry: BibEntry) => {
      setBibEntries((prev) => {
        if (prev.some((e) => e.key === entry.key)) return prev;
        const next = [...prev, entry];
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
      return formatInlineCitation(command, bibEntries, stateRef.current.bibPackage);
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
        const parsed = parseCiteCommand(ec.command);
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
