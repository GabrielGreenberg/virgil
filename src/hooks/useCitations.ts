"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { generateShortId } from "@/lib/uuid";
import { readBib, writeBib } from "@/lib/storage";
import { DOC_BIB_CHANGED_EVENT } from "@/lib/project-bib";
import { isUnanchored } from "@/links/links";
import type { CitationsState, CitationRef, BibEntry } from "@/lib/types";
import {
  parseBibFile,
  serializeBibFile,
  parseCiteCommand,
  citationCommandOrNull,
  formatInlineCitation,
  formatBibliography,
} from "@/lib/bib-parser";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { usePersistentState } from "./usePersistentState";
import type { PristineKindApi } from "./usePristineCardManager";
import { isIdentityCascadeOn } from "@/lib/identity/identity-flag";
import {
  IdentityCascade,
  renameCitekeyChange,
} from "@/lib/identity/identity-cascade";
import { wholeWordPatternFor } from "@/lib/whole-word";
import { mintBibUid } from "@/lib/bib-uid";

const EMPTY: CitationsState = {
  citations: [],
  bibPath: "",
  citationStyle: "apa",
  bibPackage: "biblatex",
};

export type CitationsHook = ReturnType<typeof useCitations>;

/** No-op hook value for paneState-routed consumers (EditorLayout reads
 *  citationsHook back from EditorPane via `paneState.citationsHook`).
 *  Safe default while the pane hasn't bubbled state yet — matches the
 *  COLLAB_INERT precedent. Every action is a no-op; getters return
 *  sensible empties. */
const _emptyArr: never[] = [];
export const CITATIONS_INERT: CitationsHook = {
  citations: _emptyArr,
  bibPath: "",
  citationStyle: "apa",
  bibPackage: "biblatex",
  bibEntries: _emptyArr,
  bibRaw: "",
  addCitation: (command: string) => ({
    id: "",
    command,
    keys: [],
    createdAt: new Date(0).toISOString(),
  }),
  updateCitation: () => {},
  deleteCitation: () => {},
  cloneCitation: () => null,
  setStyle: () => {},
  setBibPackage: () => {},
  addBibEntry: () => {},
  updateBibEntry: () => {},
  updateBibKeyAndType: () => {},
  getBibEntry: () => undefined,
  getDisplayText: (command: string) => command,
  getFormattedBib: () => "",
  commandFor: () => null,
  syncFromEditor: () => {},
  identityCascade: new IdentityCascade(),
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

  // The IdentityCascade — the single writer for identity-changing ops, owned
  // here (one per doc, NOT a module singleton — D1.4 / T1 §3.2c). A stable
  // instance across renders (lazy `useState` initializer) so external surfaces
  // (the editor `\cite{}` doc-rewrite, future citekey-keyed sidecars) can
  // register migrators against it once. Gated behind `virgil:identity-cascade`:
  // when the flag is OFF the cascade is never invoked, so the legacy
  // `updateBibKeyAndType` path is the only writer and behavior is byte-identical
  // to today.
  const [identityCascade] = useState(() => new IdentityCascade());

  // Pin the bib write handle to docId's currently-active pipeline.
  // Stale handles (from a doc switch) are rejected by writeBib.
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  const refreshBib = useCallback((id: string) => {
    readBib(id)
      .then((data) => {
        if (docRef.current !== id) return;
        setBibRaw(data.bibText || "");
        if (data.bibText) {
          try {
            setBibEntries(parseBibFile(data.bibText));
          } catch {
            setBibEntries([]);
          }
        } else {
          setBibEntries([]);
        }
        // Auto-set bib package from tex preamble detection.
        if (data.detectedPackage) {
          setState((prev) => ({ ...prev, bibPackage: data.detectedPackage }));
        }
      })
      .catch((e) => {
        console.warn(`readBib failed for ${id}:`, e);
      });
  }, [setState]);

  useEffect(() => {
    docRef.current = docId;
    if (!docId) {
      setBibEntries([]);
      setBibRaw("");
      return;
    }
    refreshBib(docId);
  }, [docId, refreshBib]);

  // Out-of-band writes to references.bib (e.g. dropping an entry onto a
  // Project library tab) dispatch DOC_BIB_CHANGED_EVENT — re-read so the
  // doc's citation UI reflects the new entry without a manual refresh.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ docId?: string }>).detail;
      const id = docRef.current;
      if (!id) return;
      if (detail?.docId && detail.docId !== id) return;
      refreshBib(id);
    };
    window.addEventListener(DOC_BIB_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DOC_BIB_CHANGED_EVENT, handler);
  }, [refreshBib]);

  const persistBib = useCallback(
    async (text: string) => {
      if (!handle) return;
      try {
        await writeBib(handle, text);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save bib:", err);
      }
    },
    [handle],
  );

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

  /** Deep-copy a citation sidecar entry with a fresh id. Returns the new
   *  id, or null if the source id wasn't found. The cite command + keys
   *  (which reference shared .bib entries) are copied verbatim. */
  const cloneCitation = useCallback(
    (sourceId: string): string | null => {
      const source = stateRef.current.citations.find((c) => c.id === sourceId);
      if (!source) return null;
      const newRef: CitationRef = {
        id: generateShortId(),
        command: source.command,
        keys: [...source.keys],
        createdAt: new Date().toISOString(),
      };
      update((prev) => ({
        ...prev,
        citations: [...prev.citations, newRef],
      }));
      return newRef.id;
    },
    [update, stateRef],
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

  /** Apply the `.bib`-side `key`+`type` mutation for the entry currently
   *  carrying `oldKey` (legacy path) OR the entry with `uid` (cascade path).
   *  Reconstructs the entry's `raw` block + reserializes + persists. Shared by
   *  both flag paths so the on-disk write is identical. */
  const applyBibKeyType = useCallback(
    (match: (e: BibEntry) => boolean, newKey: string, newType: string) => {
      setBibEntries((prev) => {
        const next = prev.map((e) => {
          if (!match(e)) return e;
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
    },
    [persistBib],
  );

  /** Rewrite the citation SIDECAR refs that reference `oldKey` → `newKey`.
   *  Uses the boundary-class matcher (W0a) so a punctuation citekey rewrites
   *  as a whole token and `foo` doesn't clobber `foobar`. */
  const rewriteCitationRefs = useCallback(
    (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      const re = new RegExp(wholeWordPatternFor(oldKey), "g");
      update((prev) => ({
        ...prev,
        citations: prev.citations.map((c) => {
          if (!c.keys.includes(oldKey)) return c;
          const newKeys = c.keys.map((k) => (k === oldKey ? newKey : k));
          return { ...c, keys: newKeys, command: c.command.replace(re, newKey) };
        }),
      }));
    },
    [update],
  );

  const updateBibKeyAndType = useCallback(
    (oldKey: string, newKey: string, newType: string) => {
      if (isIdentityCascadeOn()) {
        // CASCADE PATH (flag ON): the IdentityCascade is the single writer.
        // Resolve the durable uid so the rename targets the entry by identity
        // (not by the about-to-change key), then fan out atomically.
        const entry = bibEntries.find((e) => e.key === oldKey);
        const uid = entry?.uid;
        // 1. `.bib` key+type mutation (by uid when available, else by old key).
        applyBibKeyType(
          uid ? (e) => e.uid === uid : (e) => e.key === oldKey,
          newKey,
          newType,
        );
        // 2. citation-refs sidecar rewrite (boundary-safe).
        if (oldKey !== newKey) rewriteCitationRefs(oldKey, newKey);
        // 3. fan out to every registered migrator (the editor `\cite{}`
        //    doc-rewrite, future citekey-keyed sidecars). annotations/bib-review
        //    are uid-keyed → their migrator (if registered) is a no-op on a
        //    pure rename. A rename with no migrators is a well-formed no-op.
        if (uid) {
          void identityCascade.runIdentityChange(
            renameCitekeyChange({ uid, oldKey, newKey, newType }),
          );
        }
        return;
      }

      // LEGACY PATH (flag OFF) — byte-identical to pre-cascade behavior,
      // including the original bare-`\b` ref rewrite, so the existing suite is
      // green. Do NOT route this through the boundary matcher: that's the
      // flag-ON behavior change.
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
    [persistBib, update, bibEntries, applyBibKeyType, rewriteCitationRefs, identityCascade],
  );

  const addBibEntry = useCallback(
    (entry: BibEntry) => {
      setBibEntries((prev) => {
        if (prev.some((e) => e.key === entry.key)) return prev;
        // SSOT uid-mint point: any new entry that arrives without a durable uid
        // (e.g. /editor/find-citation, a library drop, a hand-built BibEntry)
        // gets one minted here, avoiding collisions with the entries already in
        // state, so the identity spine (annotations/bib-review keying, the
        // rename cascade) has a stable id to anchor to from the entry's first
        // moment. An entry that already carries a uid (round-tripped from a
        // `\vbid` marker) keeps it. Under the flag this guarantees `entry.uid`
        // is always present; flag-off it is harmless extra metadata.
        const withUid: BibEntry = entry.uid
          ? entry
          : { ...entry, uid: mintBibUid(new Set(prev.map((e) => e.uid).filter(Boolean) as string[])) };
        const next = [...prev, withUid];
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

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  const getDisplayText = useCallback(
    (command: string): string =>
      formatInlineCitation(command, bibEntries, stateRef.current.bibPackage, bibEntryMap),
    [bibEntries, bibEntryMap, stateRef],
  );

  /** The citation card's serialized `\cite{…}` command, read for the drop
   *  spec's "anchor the unanchored" create branch (`ctx.citations.commandFor`).
   *  An unanchored card has no `\cite{}` atom in any editor, so the atom
   *  builder reads the command from here — the SAME `CitationRef.command`
   *  field the code-edit / drag-anchor paths already serialize and round-trip
   *  (no second serializer). Returns null for an empty / keyless DRAFT (no
   *  parseable citekey): anchoring it would plant a `\cite{}` that can never
   *  serialize, so the create branch declines — matching the upstream
   *  disabled drop button. Reads `stateRef` for a stable identity (the live
   *  citations array would re-create this callback on every keystroke-adjacent
   *  edit). */
  const commandFor = useCallback(
    (id: string): string | null => {
      const cit = stateRef.current.citations.find((c) => c.id === id);
      if (!cit) return null;
      // SSOT keyless-citation predicate — same one the upstream disabled drop
      // button (`CitationCard.dropDisabled`) and the downstream spec decline
      // (`citationDropSpec.createAtom`) consume, so all three agree.
      return citationCommandOrNull(cit.command);
    },
    [stateRef],
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

  // Memoize the returned hook so EditorLayout (which now reads it via
  // `paneState.citationsHook`) can hand a stable reference into deps
  // without triggering a re-render every render. Without this, every
  // EditorPane render produced a fresh hook object → onPaneStateChange
  // fires → EditorLayout re-renders → EditorPane re-renders inside it
  // → fresh hook again → infinite "Maximum update depth" loop. Same
  // pattern as the COLLAB hook precedent in useCollab.ts.
  return useMemo(
    () => ({
      citations: state.citations,
      bibPath: state.bibPath,
      citationStyle: state.citationStyle,
      bibPackage: state.bibPackage || "biblatex",
      bibEntries,
      bibRaw,
      addCitation,
      updateCitation,
      deleteCitation,
      cloneCitation,
      setStyle,
      setBibPackage,
      addBibEntry,
      updateBibEntry,
      updateBibKeyAndType,
      getBibEntry,
      getDisplayText,
      getFormattedBib,
      commandFor,
      syncFromEditor,
      identityCascade,
    }),
    [
      state.citations,
      state.bibPath,
      state.citationStyle,
      state.bibPackage,
      bibEntries,
      bibRaw,
      addCitation,
      updateCitation,
      deleteCitation,
      cloneCitation,
      setStyle,
      setBibPackage,
      addBibEntry,
      updateBibEntry,
      updateBibKeyAndType,
      getBibEntry,
      getDisplayText,
      getFormattedBib,
      commandFor,
      syncFromEditor,
      identityCascade,
    ],
  );
}
