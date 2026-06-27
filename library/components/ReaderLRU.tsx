"use client";

// L3 — keep the last N Library reader papers mounted-but-hidden so switching
// between inner paper tabs is instant (no cold re-read + re-parse + editor
// rebuild). Reuses the SAME keep-alive primitive as L2's main-doc bounce:
// KeepAliveSlot (display:none toggle + visibility context that the EditorPane
// measurement followers read to go inert while hidden) + useKeepAliveLRU.
//
// DEDUP / dual-pipeline guard: the LRU id is the canonical docId
// `library-paper:${citekey}` — exactly the id PaperRender hands to
// <DocPipeline key={docId}> — so a given paper appears AT MOST once in the
// list and two pipelines can never fight over the same docId.
//
// Eviction = a true React unmount of the dropped tail → DocPipeline cleanup →
// the reader's note autosave (the only thing a read-only reader persists) is
// flushed by usePersistentState's unmount flushPending before the pipeline ends.

import { useEffect, type ReactNode } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { useKeepAliveLRU } from "@/lib/keep-alive/useKeepAliveLRU";
import { KeepAliveSlot } from "@/lib/keep-alive/KeepAliveSlot";
import { disposeCardStore } from "@/links/_shared/anchored-card-store";
import PaperFileBody from "./PaperFileBody";

/**
 * KeepAliveSlot + a true-unmount hook that drops THIS reader paper's per-doc
 * interaction store (the canonical <EditorPane> it mounts resolves
 * `getCardStore(docId)`). Mirrors the main app's DocKeepAliveSlot →
 * disposeCardStore: on LRU tail eviction (a real unmount, NOT a display:none
 * hide) the store leaves the registry, so a re-opened paper gets a fresh store
 * (no stale selection/expansion halo) and the registry doesn't grow unbounded.
 * The cleanup is keyed on the stable `docId` (= the React key), so a
 * display:none visibility flip never fires it.
 */
function ReaderKeepAliveSlot({
  docId,
  isVisible,
  children,
}: {
  docId: string;
  isVisible: boolean;
  children: ReactNode;
}) {
  useEffect(() => () => disposeCardStore(docId), [docId]);
  return <KeepAliveSlot isVisible={isVisible}>{children}</KeepAliveSlot>;
}

/** 1 visible + 3 hidden. Tune down to 2 (1 visible + 1 hidden — enough to make
 *  a back-and-forth between two papers instant) if heap profiling is tight. */
export const READER_LRU_CAPACITY = 4;

/** MUST match the docId PaperRender derives (PaperRender.tsx). */
const LIBRARY_PAPER_PREFIX = "library-paper:";

interface Props {
  handle: FileSystemDirectoryHandle;
  activeCitekey: string | null;
  entries: CatalogEntry[];
  bibByKey: Map<string, BibEntry>;
  onBibChanged?: () => void;
  scope: string;
  panel: PanelKey;
}

export default function ReaderLRU({
  handle,
  activeCitekey,
  entries,
  bibByKey,
  onBibChanged,
  scope,
  panel,
}: Props) {
  const activeId = activeCitekey ? LIBRARY_PAPER_PREFIX + activeCitekey : null;
  const lru = useKeepAliveLRU(activeId, READER_LRU_CAPACITY);

  return (
    <>
      {lru.map((entry) => {
        const citekey = entry.id.slice(LIBRARY_PAPER_PREFIX.length);
        return (
          <ReaderKeepAliveSlot key={entry.id} docId={entry.id} isVisible={entry.isVisible}>
            <PaperFileBody
              handle={handle}
              citekey={citekey}
              entries={entries}
              bibByKey={bibByKey}
              onBibChanged={onBibChanged}
              scope={scope}
              panel={panel}
            />
          </ReaderKeepAliveSlot>
        );
      })}
    </>
  );
}
