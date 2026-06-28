"use client";

import { useEffect, useMemo, useState } from "react";
import type { BibAuthState, CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { getFullLibraryBibEntry } from "@library/lib/bib-entry-full";
import { withSynthesizedRaw } from "@library/lib/reconstruct-bibtex";
import RightDetail from "./RightDetail";

interface Props {
  handle: FileSystemDirectoryHandle;
  citekey: string | null;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  /** F#4: authoritative reference-universe states (bib-index projection).
   *  Optional — the outer-tab mount has none, so a fileless synthesized
   *  entry defaults to "none" there. */
  bibStateByKey?: ReadonlyMap<string, BibAuthState>;
  onBibChanged?: () => void;
  /** View-session scope + panel — threaded into the Reader scroll key. */
  scope: string;
  panel: PanelKey;
}

/**
 * Body of a "paper file" tab — wraps RightDetail with a fall-back path
 * that synthesizes a minimal CatalogEntry from master.bib when the
 * citekey isn't (yet) in the catalog. Used by both the inner library
 * pod (paper-kind tab) and the outer Virgil-bar paper view.
 */
export default function PaperFileBody({
  handle,
  citekey,
  entries,
  bibByKey,
  bibStateByKey,
  onBibChanged,
  scope,
  panel,
}: Props) {
  const entry = useMemo<CatalogEntry | null>(() => {
    if (!citekey) return null;
    const found = entries.find((e) => e.citekey === citekey);
    if (found) return found;
    const bib = bibByKey.get(citekey);
    return {
      citekey,
      title: bib?.fields.title,
      authors: bib?.fields.author ? [bib.fields.author] : undefined,
      year: bib?.fields.year ? Number(bib.fields.year) : undefined,
      doi: bib?.fields.doi,
      addedAt: "",
      updatedAt: "",
      pdf: { present: false },
      indexed: { state: "none" },
      // F#4: real projected state for the fileless reference, default "none".
      bib: { state: bibStateByKey?.get(citekey) ?? "none" },
    };
  }, [citekey, entries, bibByKey, bibStateByKey]);

  // bibByKey carries only slim browse fields (raw="", partial fields). The
  // detail surface (PaperHeader's formatted bibliography, BibEditModal,
  // copy-BibTeX) needs the FULL entry, so fetch it on demand for the selected
  // citekey — parses just that one master.bib block (~1ms + a ~30ms read),
  // not the whole 34k-entry file. Falls back to the slim entry while loading.
  const slimBib = citekey ? bibByKey.get(citekey) : undefined;
  // Key the fetched full entry result to its citekey so a stale result is never
  // shown after the selection changes — and so we avoid a synchronous reset
  // setState in the effect (the only setState is the async resolve below).
  // `entry: null` records a SETTLED-but-not-found fetch (master.bib unreadable or
  // citekey unmatched) so we can distinguish "still loading" from "failed" — the
  // former shows edit disabled/"Loading…", the latter hides it.
  const [fullBibState, setFullBibState] = useState<{ citekey: string; entry: BibEntry | null } | null>(null);
  useEffect(() => {
    if (!citekey) return;
    let cancelled = false;
    void getFullLibraryBibEntry(handle, citekey).then((full) => {
      if (!cancelled) setFullBibState({ citekey, entry: full });
    });
    return () => {
      cancelled = true;
    };
  }, [handle, citekey]);
  const fetchSettled = fullBibState?.citekey === citekey;
  const fullBib = fetchSettled ? (fullBibState?.entry ?? undefined) : undefined;
  // Prefer the freshly-fetched FULL entry (authoritative raw); fall back to the
  // slim browse record while it loads — or permanently if the on-demand fetch is
  // slow / fails on a real 10 MB master.bib in production. The slim record carries
  // raw="", so we synthesize a raw (TAGGED synthesized) from its type+key+fields
  // for DISPLAY (the bib card formatted entry / copy-BibTeX). EDIT is NOT enabled
  // on a synthesized entry — RightDetail's `canEdit` gates on a real full entry —
  // because the slim record is `type:"misc"` + browse fields only and saving it
  // would overwrite the real master.bib block (data loss). The real full entry,
  // when present, carries its own raw and passes through untouched (edit-enabled).
  const bib = withSynthesizedRaw(fullBib ?? slimBib);
  // Pending = a citekey is selected but the full-entry fetch hasn't settled yet.
  // Lets RightDetail show edit as visible-but-disabled ("Loading bibliography…")
  // while pending, then hide it if the fetch settled without a real full entry.
  const editPending = !!citekey && !fetchSettled;

  return (
    <RightDetail
      handle={handle}
      entry={entry}
      bib={bib}
      onBibChanged={onBibChanged}
      editPending={editPending}
      scope={scope}
      panel={panel}
    />
  );
}
