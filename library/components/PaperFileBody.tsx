"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { getFullLibraryBibEntry } from "@library/lib/bib-entry-full";
import RightDetail from "./RightDetail";

interface Props {
  handle: FileSystemDirectoryHandle;
  citekey: string | null;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
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
      bib: { state: bib ? "unverified" : "none" },
    };
  }, [citekey, entries, bibByKey]);

  // bibByKey carries only slim browse fields (raw="", partial fields). The
  // detail surface (PaperHeader's formatted bibliography, BibEditModal,
  // copy-BibTeX) needs the FULL entry, so fetch it on demand for the selected
  // citekey — parses just that one master.bib block (~1ms + a ~30ms read),
  // not the whole 34k-entry file. Falls back to the slim entry while loading.
  const slimBib = citekey ? bibByKey.get(citekey) : undefined;
  // Key the fetched full entry to its citekey so a stale result is never shown
  // after the selection changes — and so we avoid a synchronous reset setState
  // in the effect (the only setState is the async resolve below).
  const [fullBibState, setFullBibState] = useState<{ citekey: string; entry: BibEntry } | null>(null);
  useEffect(() => {
    if (!citekey) return;
    let cancelled = false;
    void getFullLibraryBibEntry(handle, citekey).then((full) => {
      if (!cancelled && full) setFullBibState({ citekey, entry: full });
    });
    return () => {
      cancelled = true;
    };
  }, [handle, citekey]);
  const fullBib = fullBibState?.citekey === citekey ? fullBibState.entry : undefined;
  const bib = fullBib ?? slimBib;

  return (
    <RightDetail
      handle={handle}
      entry={entry}
      bib={bib}
      onBibChanged={onBibChanged}
      scope={scope}
      panel={panel}
    />
  );
}
