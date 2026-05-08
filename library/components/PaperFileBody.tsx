"use client";

import { useMemo } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import RightDetail from "./RightDetail";

interface Props {
  handle: FileSystemDirectoryHandle;
  citekey: string | null;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  onBibChanged?: () => void;
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
  const bib = citekey ? bibByKey.get(citekey) : undefined;
  return (
    <RightDetail
      handle={handle}
      entry={entry}
      bib={bib}
      onBibChanged={onBibChanged}
    />
  );
}
