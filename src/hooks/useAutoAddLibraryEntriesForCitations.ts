"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";

/**
 * Auto-enrich a paper's `references.bib` from the central Virgil Library.
 *
 * When a citekey BECOMES referenced by a citation in the paper, and the key
 * is present in the library's master.bib but missing from the paper's local
 * bib, silently append the library entry. Idempotent — `addBibEntry`
 * dedupes by key against the file on disk.
 *
 * EDGE, NOT LEVEL (task 944). This hook acts on a key's TRANSITION into the
 * referenced set, never on the standing condition "a cited key is missing
 * from the bib". The level form re-appended master.bib's copy the moment a
 * still-cited key left the paper bib — silently undoing the Library's
 * "Remove from references.bib…", a hand edit in the code pane, an agent's
 * write, an external editor (and, where the paper's copy carried local
 * edits, replacing it with the MASTER version). A key that leaves the bib
 * while still cited is now left alone: the card's "not in your
 * bibliography" warning is the correct feedback.
 *
 * A newly-referenced key stays PENDING until it is settled — it is seen in
 * the paper bib, or the library entry is requested — so the late arrivals
 * (the paper bib's async read, master.bib parsed only once the doc has a
 * citation) still resolve it. A pending key that stops being referenced is
 * dropped; citing it again is a fresh transition.
 *
 * Open-time fill (kept deliberately): the citations sidecar loads from an
 * empty pre-load state, so every key cited on open is a transition and gets
 * filled — this keeps a `\cite` typed outside Virgil enriched. The accepted
 * residual: a key removed from the bib while the doc was CLOSED is filled
 * again on the next open, because this per-session hook cannot tell that
 * removal from a never-added key.
 *
 * Covers:
 *   - picker pick (the picker's own onPick also calls addBibEntry, but
 *     this catches the case where the picker fires before the citation
 *     has been written to state)
 *   - typed `\cite{libkey}` directly in the editor
 *   - drag-to-card merges
 *   - pasted citation commands
 *
 * Leaves alone: citekeys that exist in neither bib (the card surfaces a
 * "not in your bibliography" warning, which is correct), and cited keys
 * removed from the paper bib after they were settled.
 */
export function useAutoAddLibraryEntriesForCitations(args: {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  libraryEntries: BibEntry[];
  addBibEntry: (entry: BibEntry) => void;
}) {
  const { citations, bibEntries, libraryEntries, addBibEntry } = args;

  // Refs let the effect read the freshest data without putting it in the
  // dep array, so we don't re-fire on every reference change.
  const libraryEntriesRef = useRef(libraryEntries);
  libraryEntriesRef.current = libraryEntries;
  const addBibEntryRef = useRef(addBibEntry);
  addBibEntryRef.current = addBibEntry;

  // Stringified set of referenced keys — a stable primitive we can put in
  // the effect's dep array. Avoids the Set-by-reference instability that
  // would otherwise re-fire the effect on every render.
  const referencedKeysJoined = useMemo(() => {
    const out = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) if (k) out.add(k);
    }
    return Array.from(out).sort().join("|");
  }, [citations]);

  // Same trick for library coverage — we only care WHICH keys are
  // available in the library, not the full entry data.
  const libraryKeysJoined = useMemo(
    () => libraryEntries.map((e) => e.key).sort().join("|"),
    [libraryEntries],
  );

  // And for the paper bib — when a key appears here, the effect should
  // re-evaluate (in case it can now skip an earlier candidate).
  const paperKeysJoined = useMemo(
    () => bibEntries.map((e) => e.key).sort().join("|"),
    [bibEntries],
  );

  // Keys referenced as of the previous run — the edge detector's memory.
  const prevReferencedRef = useRef<Set<string>>(new Set());
  // Newly-referenced keys not yet settled (seen in the paper bib, or the
  // library entry requested). Survives across runs so a late paper-bib read
  // or a late master.bib parse can still settle them.
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const refKeys = new Set(
      referencedKeysJoined ? referencedKeysJoined.split("|") : [],
    );
    const pending = pendingRef.current;
    for (const key of refKeys) {
      if (!prevReferencedRef.current.has(key)) pending.add(key);
    }
    for (const key of pending) if (!refKeys.has(key)) pending.delete(key);
    prevReferencedRef.current = refKeys;
    if (pending.size === 0) return;

    const paperKeys = new Set(paperKeysJoined.split("|").filter(Boolean));
    const libByKey = new Map<string, BibEntry>();
    for (const e of libraryEntriesRef.current) libByKey.set(e.key, e);
    for (const key of Array.from(pending)) {
      if (paperKeys.has(key)) {
        pending.delete(key);
        continue;
      }
      const lib = libByKey.get(key);
      if (!lib) continue;
      pending.delete(key);
      addBibEntryRef.current(lib);
    }
  }, [referencedKeysJoined, libraryKeysJoined, paperKeysJoined]);
}
