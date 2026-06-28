"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { readTextFile, ROOT_FILES } from "@library/lib/library-storage";
import { parseBibFile } from "@library/lib/bib-parser";
import { readBibIndex, readBibIndexStamp } from "@library/lib/bib-index";
import { libPerf, libPerfAsync } from "@library/lib/perf";
import type { BibEntry } from "@library/lib/types";
import type { BibAuthState } from "@library/lib/catalog";

const EMPTY_STATES: ReadonlyMap<string, BibAuthState> = new Map();

/**
 * Library bib entries for the BROWSE path (list, search, citation picker).
 *
 * Fast path: read the skill-emitted slim `.virgil/bib-index.json` (stamp-gated
 * via the tiny `.virgil/bib-index.stamp`, so an unchanged reload is a ~0ms
 * file read). This replaces parsing the multi-MB master.bib with citation-js
 * (~2.6s blocking at 34k, ~6s at 100k) on every Library open / first citation.
 *
 * Fallback: libraries that predate the bib-index (no stamp file) parse
 * master.bib exactly as before. The returned entries carry only browse fields
 * (raw=""); edit/format paths fetch the full entry on demand via
 * getFullLibraryBibEntry (bib-entry-full.ts). See MEMO_LIBRARY_SCALE_RESEARCH.md.
 */
export function useMasterBib(handle: FileSystemDirectoryHandle | null) {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  // citekey → bib.state for the whole reference universe (F#4). Populated
  // from the slim bib-index's projected `bs`; empty on the master.bib-parse
  // fallback (old libraries) — readers default missing keys to "none".
  const [bibStateByKey, setBibStateByKey] =
    useState<ReadonlyMap<string, BibAuthState>>(EMPTY_STATES);
  const [error, setError] = useState<Error | null>(null);
  // Change signals that let an unchanged reload short-circuit (keeping the
  // entries array reference stable for downstream identity-keyed memos /
  // the Fuse WeakMap). `lastStampRef` guards the fast path; `lastTextRef`
  // guards the master.bib-parse fallback.
  const lastStampRef = useRef<string | null>(null);
  const lastTextRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!handle) return;
    try {
      const stamp = await readBibIndexStamp(handle);
      if (stamp !== null) {
        // Fast path: slim index present. lastStampRef is only set after a
        // successful setEntries, so an equal stamp means our state is current.
        if (stamp === lastStampRef.current) return;
        const result = await libPerfAsync(
          "bib-index read+map",
          () => readBibIndex(handle),
          (r) => (r ? `${r.entries.length} entries` : "null"),
        );
        if (result) {
          lastStampRef.current = stamp;
          lastTextRef.current = null;
          setEntries(result.entries);
          setBibStateByKey(result.stateByKey);
          setError(null);
          return;
        }
        // Index unreadable/malformed → fall through to master.bib parse.
      }

      // Fallback: parse master.bib (old libraries, or unreadable index).
      const text = await readTextFile(handle, ROOT_FILES.masterBib);
      if (text === undefined) {
        lastTextRef.current = null;
        lastStampRef.current = null;
        setEntries([]);
        setBibStateByKey(EMPTY_STATES);
        return;
      }
      if (text === lastTextRef.current) return;
      lastTextRef.current = text;
      lastStampRef.current = null;
      setEntries(libPerf("master.bib citation-js parse", () => parseBibFile(text), (e) => `${e.length} entries`));
      // The citation-js fallback drops comments, so no state projection is
      // available here — keep the universe states empty (→ "none").
      setBibStateByKey(EMPTY_STATES);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    // Intentional mount-load + focus-refresh; reload() is stamp-gated so an
    // unchanged poll is a ~0ms no-op and never churns state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [handle, reload]);

  return { entries, bibStateByKey, error, reload };
}
