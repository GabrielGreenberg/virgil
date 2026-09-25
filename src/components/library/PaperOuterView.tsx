"use client";

import { useMemo } from "react";
import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import { useCatalogItems, refreshCatalogStore } from "@library/lib/catalog-store";
import { useMasterBib } from "@library/hooks/useMasterBib";
import LibraryFolderGate from "@library/components/LibraryFolderGate";
import PaperFileBody from "@library/components/PaperFileBody";
import type { BibEntry } from "@library/lib/types";
import { paperReaderScope } from "@/components/editor-layout/reader-host";
import { libraryPaperDocId } from "@/lib/host-writability";
import { useCardStoreLease } from "@/links/_shared/anchored-card-store";

interface Props {
  /** Citekey backing this outer tab. */
  citekey: string;
}

/**
 * Outer Virgil-bar paper viewer. Renders the paper full-width across
 * the manila canvas. The icon strips pin to the outer edges of the
 * canonical `EditorPane`'s row, and the panel/editor boundary uses
 * the same `PanelColumn` drag-gap as the main editor — Reader
 * inherits the unified affordance.
 */
export default function PaperOuterView({ citekey }: Props) {
  const lib = useLibraryHandle();

  // The shared gate renders every non-ready state — including pickerError
  // and the refresh-failure state this surface used to drop (task 764).
  return (
    <LibraryFolderGate lib={lib}>
      {(handle) => <ReadyView handle={handle} citekey={citekey} />}
    </LibraryFolderGate>
  );
}

function ReadyView({
  handle,
  citekey,
}: {
  handle: FileSystemDirectoryHandle;
  citekey: string;
}) {
  // This tab mounts the SAME docId (`library-paper:<citekey>`) the Library
  // Reader's LRU may also hold, so it takes its own lease on the paper's card
  // store — the Reader evicting its slot can't dispose it from under this tab,
  // and this tab closing releases what it held (task 765).
  useCardStoreLease(libraryPaperDocId(citekey));
  // Shared catalog poll (catalog-store) rather than a second per-view loop.
  const { entries: catalogEntries } = useCatalogItems();
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);

  const bibByKey = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of bibEntries) m.set(e.key, e);
    return m;
  }, [bibEntries]);

  return (
    <div
      className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <PaperFileBody
        handle={handle}
        citekey={citekey}
        entries={catalogEntries}
        bibByKey={bibByKey}
        onBibChanged={() => {
          void reloadBib();
          void refreshCatalogStore();
        }}
        // Standalone outer paper tab — no LibraryView panel context. Give
        // it its own isolated view-session scope so its reader scroll
        // persists independently of any inline-Library paper view. Minted
        // through the scope grammar SSOT so `readerHostKind` reads back the
        // `popped-paper` host (and its opening layout) by construction.
        scope={paperReaderScope(citekey)}
        panel="left"
      />
    </div>
  );
}
